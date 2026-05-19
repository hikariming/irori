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
  resolveMemoryBackend = resolveConfiguredMemoryBackend
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

  const configuredMemoryBackend = memoryBackend
    ? null
    : await resolveMemoryBackend({ config: memoryBackendConfig });
  const effectiveMemoryBackend =
    memoryBackend ?? configuredMemoryBackend ?? (chatHistoryMemory ? createChatHistoryMemoryBackend(chatHistoryMemory) : null);
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

  const { session } = await createSession({
    cwd,
    modelSettings,
    runtimeToken,
    authPath,
    sessionMode: "memory"
  });

  const events = [];
  const unsubscribe = session.subscribe((event) => {
    events.push(event);
  });

  try {
    await session.prompt(memoryPrompt.prompt);
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
      recalledMemories: memoryPrompt.memories
    };
  } finally {
    unsubscribe();
    session.dispose();
  }
}
