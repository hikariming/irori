import type { ChatMessage } from "./chat-model";

export type AssistantProgressPhase = "queued" | "thinking" | "answering";

export type PiPromptProgressEvent = {
  runId: string;
  phase: AssistantProgressPhase;
  delta?: string;
  status?: string;
  text?: string;
};

export type AssistantProgress = {
  runId: string;
  phase: AssistantProgressPhase;
  reasoningText: string;
  answerText: string;
  statusText: string;
};

export function createAssistantProgress(runId: string): AssistantProgress {
  return {
    runId,
    phase: "queued",
    reasoningText: "",
    answerText: "",
    statusText: ""
  };
}

export function reduceAssistantProgress(
  current: AssistantProgress,
  event: PiPromptProgressEvent
): AssistantProgress {
  if (event.runId !== current.runId) {
    return current;
  }

  if (event.phase === "thinking") {
    return {
      ...current,
      phase: "thinking",
      reasoningText: event.text ?? `${current.reasoningText}${event.delta ?? ""}`,
      statusText: event.status ?? ""
    };
  }

  if (event.phase === "answering") {
    return {
      ...current,
      phase: "answering",
      answerText: event.text ?? `${current.answerText}${event.delta ?? ""}`,
      statusText: event.status ?? ""
    };
  }

  return {
    ...current,
    phase: event.phase,
    statusText: event.status ?? current.statusText
  };
}

export function assistantProgressStatusLabel(phase: AssistantProgressPhase) {
  switch (phase) {
    case "thinking":
      return "推理中";
    case "answering":
      return "生成回复";
    case "queued":
    default:
      return "准备中";
  }
}

export function assistantProgressPrimaryText(progress: AssistantProgress | null | undefined) {
  switch (progress?.phase) {
    case "thinking":
      return "思考中";
    case "answering":
      return "生成中";
    case "queued":
    default:
      return progress?.statusText.trim() || "准备中";
  }
}

export function assistantReasoningDisplayText(progress: AssistantProgress | null | undefined) {
  const reasoningText = progress?.reasoningText.trim() ?? "";

  if (reasoningText) {
    return reasoningText;
  }

  if (progress?.phase === "thinking") {
    return "正在思考...";
  }

  return "";
}

export function upsertAssistantStreamMessage(
  messages: ChatMessage[],
  message: {
    id: string;
    author: string;
    text: string;
    time: string;
  }
): ChatMessage[] {
  const streamMessage: ChatMessage = {
    id: message.id,
    speaker: "character",
    author: message.author,
    text: message.text,
    time: message.time
  };
  const existingIndex = messages.findIndex((item) => item.id === message.id);

  if (existingIndex === -1) {
    return [...messages, streamMessage];
  }

  return messages.map((item, index) => index === existingIndex ? streamMessage : item);
}

export function replaceAssistantStreamMessage(
  messages: ChatMessage[],
  streamMessageId: string | null,
  persistedMessage: ChatMessage
): ChatMessage[] {
  if (!streamMessageId) {
    return [...messages, persistedMessage];
  }

  const existingIndex = messages.findIndex((item) => item.id === streamMessageId);

  if (existingIndex === -1) {
    return [...messages, persistedMessage];
  }

  return messages.map((item, index) => index === existingIndex ? persistedMessage : item);
}

export function removeAssistantStreamMessage(
  messages: ChatMessage[],
  streamMessageId: string | null
): ChatMessage[] {
  if (!streamMessageId) {
    return messages;
  }

  return messages.filter((item) => item.id !== streamMessageId);
}

export function typewriterStepForText(text: string): number {
  return Math.max(1, Math.ceil(text.length / 180));
}

export function nextTypewriterText(current: string, target: string, step = typewriterStepForText(target)): string {
  if (!target.startsWith(current)) {
    return target;
  }

  if (current.length >= target.length) {
    return target;
  }

  return target.slice(0, Math.min(target.length, current.length + step));
}
