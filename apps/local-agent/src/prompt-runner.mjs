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

  const text = (deltas.join("") || textEndContent).trim();

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
  resolveMemoryBackend = resolveConfiguredMemoryBackend,
  promptTimeoutMs = defaultPromptTimeoutMs,
  modelWaitHeartbeatMs = 3000,
  runId,
  onProgressEvent
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
    memoryRecallRequest: effectiveRecallRequest
  });

  emitRunStatus(onProgressEvent, runId, "上下文已整理，正在启动本地 Pi 会话");

  const { session } = await createSession({
    cwd,
    modelSettings,
    runtimeToken,
    authPath,
    sessionMode: "memory",
    tools: toolRuntime.tools,
    customTools: toolRuntime.customTools,
    toolPolicy: toolRuntime.toolPolicy
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
