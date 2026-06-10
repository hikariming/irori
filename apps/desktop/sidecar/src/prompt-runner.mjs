import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";

import {
  defaultOpenAiCompatibleSettings,
  formatOpenAiCompatibleRoute,
  openAiCompatibleProviderId,
  resolvePiModel
} from "./model-provider-resolver.mjs";
import { createChatHistoryMemoryBackend } from "./chat-history-memory-backend.mjs";
import { resolveConfiguredMemoryBackend } from "./configured-memory-backend.mjs";
import { buildPromptWithMemory, captureMemoryTurn } from "./memory-bridge.mjs";
import { createIroriPiSession } from "./pi-session-adapter.mjs";
import { buildToolRuntime } from "./tool-policy-runtime.mjs";
import { toolGateConfigEnvVar, writeToolGateConfig as writeToolGateConfigToDisk } from "./tool-gate-config.mjs";
import { writePiWebAccessConfig } from "./web-access-config.mjs";

// promptTimeoutMs 的语义是“空闲超时”窗口：一次多轮 agent run 没有总时长上限，
// 只有连续 N 毫秒收不到任何会话事件才算卡死。流式 delta、思考、工具进度都会
// 重置计时；工具执行期间（含子代理委派，可能要跑好几分钟）和等待用户在确认
// 面板点按钮期间会整体暂停计时。
export const defaultPromptTimeoutMs = 120000;

function promptIdleTimeoutError(timeoutMs) {
  const seconds = Math.ceil(timeoutMs / 1000);

  return new Error(`等待模型活动超时（连续 ${seconds} 秒没有收到任何模型或工具事件）。请检查模型服务是否仍在响应，或稍后重试。`);
}

// Idle watchdog for a multi-turn agent run. Unlike a total deadline it only
// fires after `timeoutMs` with NO session activity: every event re-arms it via
// touch(), and pause()/resume() (re-entrant, counted) stop the clock entirely
// while a tool executes or a confirmation waits on the user — both can
// legitimately take far longer than any reasonable model-stall window.
export function createPromptIdleWatchdog(timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return {
      touch() {},
      pause() {},
      resume() {},
      race: (promise) => promise
    };
  }

  let timer = null;
  let pauseDepth = 0;
  let fireTimeout = () => {};
  const expired = new Promise((_, reject) => {
    fireTimeout = () => reject(promptIdleTimeoutError(timeoutMs));
  });

  const disarm = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const arm = () => {
    disarm();
    timer = setTimeout(fireTimeout, timeoutMs);
  };

  return {
    touch() {
      if (pauseDepth === 0) {
        arm();
      }
    },
    pause() {
      pauseDepth += 1;
      disarm();
    },
    resume() {
      pauseDepth = Math.max(0, pauseDepth - 1);
      if (pauseDepth === 0) {
        arm();
      }
    },
    async race(promise) {
      // The promise may already have paused the clock synchronously (e.g. a
      // tool started before the race begins), so arm through the same guard.
      if (pauseDepth === 0) {
        arm();
      }
      try {
        return await Promise.race([promise, expired]);
      } finally {
        disarm();
      }
    }
  };
}

export function collectAssistantText(events) {
  const deltas = [];
  let textEndContent = "";
  let assistantError = "";

  for (const event of events) {
    if (
      (event.type === "message_end" || event.type === "turn_end") &&
      event.message?.role === "assistant" &&
      event.message.stopReason === "error"
    ) {
      assistantError = event.message.errorMessage || "模型调用失败。";
    }

    if (event.type !== "message_update") {
      continue;
    }

    const assistantEvent = event.assistantMessageEvent;

    if (assistantEvent?.type === "text_delta") {
      deltas.push(assistantEvent.delta);
    }

    if (assistantEvent?.type === "text_end" && typeof assistantEvent.content === "string") {
      textEndContent = assistantEvent.content;
    }
  }

  const text = (textEndContent || deltas.join("")).trim();

  if (!text && assistantError) {
    throw new Error(assistantError);
  }

  if (!text) {
    throw new Error("模型没有返回文本。请检查模型名是否支持聊天补全、Base URL 是否是 OpenAI 兼容 /v1 接口，以及服务端是否返回了空响应。");
  }

  return text;
}

export function toPiPromptProgressEvent(event, runId) {
  if (!runId || event?.type !== "message_update") {
    return null;
  }

  const assistantEvent = event.assistantMessageEvent;

  if (assistantEvent?.type === "thinking_start") {
    return {
      runId,
      phase: "thinking"
    };
  }

  if (assistantEvent?.type === "thinking_delta" && typeof assistantEvent.delta === "string") {
    return {
      runId,
      phase: "thinking",
      delta: assistantEvent.delta
    };
  }

  if (assistantEvent?.type === "thinking_end" && typeof assistantEvent.content === "string") {
    return {
      runId,
      phase: "thinking",
      text: assistantEvent.content
    };
  }

  if (assistantEvent?.type === "text_delta" && typeof assistantEvent.delta === "string") {
    return {
      runId,
      phase: "answering",
      delta: assistantEvent.delta
    };
  }

  if (assistantEvent?.type === "text_end" && typeof assistantEvent.content === "string") {
    return {
      runId,
      phase: "answering",
      text: assistantEvent.content
    };
  }

  return null;
}

function toolGateStatusText(toolEvent = {}) {
  const target = toolEvent.target ? `：${toolEvent.target}` : "";

  switch (toolEvent.status) {
    case "allowed":
      return `执行工具 ${toolEvent.toolName}${target}`;
    case "blocked":
      return `已拦截 ${toolEvent.toolName}${target}`;
    case "needs_confirmation":
      return `${toolEvent.toolName} 需要确认${target}`;
    case "confirmed":
      return `已确认 ${toolEvent.toolName}${target}`;
    case "rejected":
      return `已取消 ${toolEvent.toolName}${target}`;
    default:
      return `工具 ${toolEvent.toolName}`;
  }
}

function emitRunStatus(onProgressEvent, runId, status) {
  if (!runId || !status) {
    return;
  }

  onProgressEvent?.({
    runId,
    phase: "queued",
    status
  });
}

function modelWaitHeartbeatStatus(startedAt) {
  const elapsedSeconds = Math.max(1, Math.ceil((Date.now() - startedAt) / 1000));

  return `等待模型首个输出（${elapsedSeconds}s）`;
}

// Each run writes its OWN gate file derived from the caller's base path, so
// concurrent runs (a chat and a scheduled task each spawn their own pi-prompt
// process) can't overwrite each other's fence: a run's subagent children find
// exactly this run's file via the env pointer, never another run's allowlist.
export function perRunToolGateConfigPath(basePath, { pid = process.pid, token = randomUUID() } = {}) {
  const suffix = `.${pid}-${token}.json`;

  return basePath.endsWith(".json") ? `${basePath.slice(0, -".json".length)}${suffix}` : `${basePath}${suffix}`;
}

export async function runIroriPiPrompt({
  cwd,
  modelSettings = defaultOpenAiCompatibleSettings,
  prompt,
  runtimeToken,
  authPath,
  dryRun = false,
  createSession = createIroriPiSession,
  memoryBackend,
  memoryBackendConfig,
  memoryRecallRequest,
  memoryCaptureTurn,
  chatHistoryMemory,
  toolPolicySettings,
  webAccessSettings,
  browserSnapshot,
  writeWebAccessConfig = writePiWebAccessConfig,
  toolGateConfigPath,
  writeToolGateConfig = writeToolGateConfigToDisk,
  removeToolGateConfig = (path) => rm(path, { force: true }),
  enableSubagents = false,
  // Subagent `context: fork` needs a persisted parent session; callers enabling
  // delegation should pass "persistent". Defaults to in-memory (zero regression).
  sessionMode = "memory",
  toolGateMode = "confirm",
  resolveMemoryBackend = resolveConfiguredMemoryBackend,
  // 空闲超时窗口（毫秒）：连续这么久没有任何会话事件才超时，见 defaultPromptTimeoutMs。
  promptTimeoutMs = defaultPromptTimeoutMs,
  modelWaitHeartbeatMs = 3000,
  skillsRootPath,
  allowedSkillNames,
  skillRequiredTools,
  runId,
  scheduledTasks = [],
  onProgressEvent,
  onScheduleUpsert,
  onScheduleCancel,
  onConfirm
}) {
  const model = resolvePiModel(modelSettings);
  const modelRoute = formatOpenAiCompatibleRoute(modelSettings);

  if (dryRun) {
    return {
      providerId: openAiCompatibleProviderId,
      modelRoute,
      text: `Pi session ready for ${modelRoute}. Prompt was accepted in dry-run mode.`
    };
  }

  if (!runtimeToken) {
    throw new Error("OpenAI-compatible token is required before sending a Pi prompt.");
  }

  emitRunStatus(onProgressEvent, runId, "正在整理上下文");

  const configuredMemoryBackend = memoryBackend
    ? null
    : await resolveMemoryBackend({ config: memoryBackendConfig });
  const effectiveMemoryBackend =
    memoryBackend ?? configuredMemoryBackend ?? (chatHistoryMemory ? createChatHistoryMemoryBackend(chatHistoryMemory) : null);
  const memoryBackendSource = memoryBackend
    ? "explicit"
    : configuredMemoryBackend
      ? "tencentdb"
      : chatHistoryMemory
        ? "chat-history"
        : "none";
  const effectiveRecallRequest = memoryRecallRequest ?? (
    chatHistoryMemory
      ? {
          userId: chatHistoryMemory.userId ?? "local-user",
          characterId: chatHistoryMemory.characterId,
          projectId: chatHistoryMemory.projectId,
          sessionId: chatHistoryMemory.sessionId,
          query: chatHistoryMemory.query ?? prompt,
          mode: chatHistoryMemory.mode ?? "companion",
          maxResults: chatHistoryMemory.maxResults
        }
      : null
  );
  const effectiveCaptureTurn = memoryCaptureTurn ?? (
    chatHistoryMemory
      ? {
          userId: chatHistoryMemory.userId ?? "local-user",
          characterId: chatHistoryMemory.characterId,
          projectId: chatHistoryMemory.projectId,
          sessionId: chatHistoryMemory.sessionId,
          userText: chatHistoryMemory.userText ?? chatHistoryMemory.query ?? prompt
        }
      : null
  );

  const memoryPrompt = await buildPromptWithMemory({
    prompt,
    memoryBackend: effectiveMemoryBackend,
    recallRequest: effectiveRecallRequest
  });
  const toolRuntime = buildToolRuntime({
    settings: toolPolicySettings,
    memoryBackend: effectiveMemoryBackend,
    memoryRecallRequest: effectiveRecallRequest,
    enableSubagents,
    skillRequiredTools,
    browserSnapshot,
    onBrowserEvent: runId && onProgressEvent
      ? (browserEvent) => {
          onProgressEvent({
            runId,
            phase: "browser",
            status: browserEvent?.url ? `打开右侧浏览器：${browserEvent.url}` : "更新右侧浏览器",
            browser: browserEvent
          });
        }
      : undefined,
    // 只有真实聊天（有 runId + 回写通道）才放开定时任务工具；无人值守的定时执行不放开。
    onScheduleUpsert: runId && onScheduleUpsert ? onScheduleUpsert : undefined,
    onScheduleCancel: runId && onScheduleCancel ? onScheduleCancel : undefined,
    scheduledTasks,
    scheduleNow: new Date().toString()
  });

  emitRunStatus(onProgressEvent, runId, "上下文已整理，正在启动本地 Pi 会话");
  if (webAccessSettings !== undefined) {
    await writeWebAccessConfig({ settings: webAccessSettings });
  }

  // Opt-in: when a config path is given, persist the resolved fence so subagent
  // child processes can inherit the SAME policy via the irori-tool-gate
  // extension, and point them at it through the environment. The file is
  // per-run (derived from the base path) and removed in the finally below.
  let runToolGateConfigPath;
  if (toolGateConfigPath) {
    runToolGateConfigPath = perRunToolGateConfigPath(toolGateConfigPath);
    await writeToolGateConfig({
      gatePolicy: toolRuntime.gatePolicy,
      mode: toolGateMode,
      configPath: runToolGateConfigPath
    });
    process.env[toolGateConfigEnvVar] = runToolGateConfigPath;
  }

  const onToolEvent = runId && onProgressEvent
    ? (toolEvent) => {
        onProgressEvent({
          runId,
          phase: "tool",
          status: toolGateStatusText(toolEvent),
          tool: {
            name: toolEvent.toolName,
            status: toolEvent.status,
            target: toolEvent.target,
            reason: toolEvent.reason
          }
        });
      }
    : undefined;

  const idleWatchdog = createPromptIdleWatchdog(promptTimeoutMs);
  // 用户在确认面板上想多久都可以，不算模型空闲。
  const guardedOnConfirm = typeof onConfirm === "function"
    ? async (confirmRequest) => {
        idleWatchdog.pause();
        try {
          return await onConfirm(confirmRequest);
        } finally {
          idleWatchdog.resume();
        }
      }
    : onConfirm;

  const { session } = await createSession({
    cwd,
    modelSettings,
    runtimeToken,
    authPath,
    sessionMode,
    tools: toolRuntime.tools,
    customTools: toolRuntime.customTools,
    toolPolicy: toolRuntime.toolPolicy,
    gatePolicy: toolRuntime.gatePolicy,
    gateMode: toolGateMode,
    enableSubagents,
    skillsRootPath,
    allowedSkillNames,
    onToolEvent,
    onConfirm: guardedOnConfirm
  });

  const events = [];
  let sawModelOutput = false;
  let heartbeatTimer = null;
  const stopHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };
  const unsubscribe = session.subscribe((event) => {
    // Any session event proves the run is alive. Tool execution — including
    // subagent delegation, which can run for minutes with no parent-side
    // events — pauses the idle clock entirely until the tool returns.
    idleWatchdog.touch();
    if (event.type === "tool_execution_start") {
      idleWatchdog.pause();
    } else if (event.type === "tool_execution_end") {
      idleWatchdog.resume();
    }

    const progressEvent = toPiPromptProgressEvent(event, runId);
    if (progressEvent) {
      if (progressEvent.phase === "thinking" || progressEvent.phase === "answering") {
        sawModelOutput = true;
        stopHeartbeat();
      }
      onProgressEvent?.(progressEvent);
    }
    events.push(event);
  });

  try {
    emitRunStatus(onProgressEvent, runId, "请求已发送，等待模型首个输出");
    if (runId && onProgressEvent && Number.isFinite(modelWaitHeartbeatMs) && modelWaitHeartbeatMs > 0) {
      const waitStartedAt = Date.now();
      heartbeatTimer = setInterval(() => {
        if (!sawModelOutput) {
          emitRunStatus(onProgressEvent, runId, modelWaitHeartbeatStatus(waitStartedAt));
        }
      }, modelWaitHeartbeatMs);
    }

    await idleWatchdog.race(session.prompt(memoryPrompt.prompt));
    const text = collectAssistantText(events);

    await captureMemoryTurn({
      memoryBackend: effectiveMemoryBackend,
      turn: effectiveCaptureTurn
        ? {
            ...effectiveCaptureTurn,
            assistantText: text,
            createdAt: effectiveCaptureTurn.createdAt ?? new Date().toISOString()
          }
        : null
    });

    return {
      providerId: openAiCompatibleProviderId,
      modelRoute,
      text,
      memoryBackendSource,
      recalledMemories: memoryPrompt.memories,
      toolPolicy: toolRuntime.summary
    };
  } finally {
    stopHeartbeat();
    unsubscribe();
    session.dispose();
    if (runToolGateConfigPath) {
      // Best-effort: a leftover per-run file is unreachable (no env points at
      // it), so failing to delete must never mask the run's real outcome.
      try {
        await removeToolGateConfig(runToolGateConfigPath);
      } catch {
        // ignore
      }
    }
  }
}
