import {
  defaultOpenAiCompatibleSettings,
  formatOpenAiCompatibleRoute,
  openAiCompatibleProviderId,
  resolvePiModel
} from "./model-provider-resolver.mjs";
import { createChatHistoryMemoryBackend } from "./chat-history-memory-backend.mjs";
import { resolveConfiguredMemoryBackend } from "./configured-memory-backend.mjs";
import { buildPromptWithMemory, captureMemoryTurn } from "./memory-bridge.mjs";
import { createCockapooPiSession } from "./pi-session-adapter.mjs";
import { buildToolRuntime } from "./tool-policy-runtime.mjs";
import { toolGateConfigEnvVar, writeToolGateConfig as writeToolGateConfigToDisk } from "./tool-gate-config.mjs";
import { writePiWebAccessConfig } from "./web-access-config.mjs";

export const defaultPromptTimeoutMs = 120000;

function promptTimeoutError(timeoutMs) {
  const seconds = Math.ceil(timeoutMs / 1000);

  return new Error(`模型响应超时（超过 ${seconds} 秒）。请检查模型服务是否仍在响应，或稍后重试。`);
}

async function withPromptTimeout(promise, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  let timeoutId;

  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(promptTimeoutError(timeoutMs));
        }, timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
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

export async function runCockapooPiPrompt({
  cwd,
  modelSettings = defaultOpenAiCompatibleSettings,
  prompt,
  runtimeToken,
  authPath,
  dryRun = false,
  createSession = createCockapooPiSession,
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
  enableSubagents = false,
  // Subagent `context: fork` needs a persisted parent session; callers enabling
  // delegation should pass "persistent". Defaults to in-memory (zero regression).
  sessionMode = "memory",
  toolGateMode = "confirm",
  resolveMemoryBackend = resolveConfiguredMemoryBackend,
  promptTimeoutMs = defaultPromptTimeoutMs,
  modelWaitHeartbeatMs = 3000,
  runId,
  onProgressEvent,
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
      : undefined
  });

  emitRunStatus(onProgressEvent, runId, "上下文已整理，正在启动本地 Pi 会话");
  if (webAccessSettings !== undefined) {
    await writeWebAccessConfig({ settings: webAccessSettings });
  }

  // Opt-in: when a config path is given, persist the resolved fence so subagent
  // child processes can inherit the SAME policy via the cockapoo-tool-gate
  // extension, and point them at it through the environment.
  if (toolGateConfigPath) {
    await writeToolGateConfig({
      gatePolicy: toolRuntime.gatePolicy,
      mode: toolGateMode,
      configPath: toolGateConfigPath
    });
    process.env[toolGateConfigEnvVar] = toolGateConfigPath;
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
    onToolEvent,
    onConfirm
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

    await withPromptTimeout(session.prompt(memoryPrompt.prompt), promptTimeoutMs);
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
  }
}
