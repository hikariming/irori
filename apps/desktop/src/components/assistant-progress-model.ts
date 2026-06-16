import type { ChatMessage } from "./chat-model";

export type AssistantProgressPhase = "queued" | "thinking" | "answering" | "tool" | "browser";

export type ToolGateStatus =
  | "allowed"
  | "blocked"
  | "needs_confirmation"
  | "confirmed"
  | "rejected";

export type ToolProgressInfo = {
  name: string;
  status: ToolGateStatus;
  target?: string;
  reason?: string;
};

export type BrowserProgressInfo = {
  action: "open";
  url: string;
  title?: string;
  reason?: string;
  source: "agent";
};

export type PiToolConfirmRequest = {
  confirmId: string;
  runId: string;
  tool: {
    name: string;
    target?: string;
    reason?: string;
  };
};

export type ProgressStatusParams = Record<string, string | number>;

export type PiPromptProgressEvent = {
  runId: string;
  phase: AssistantProgressPhase;
  delta?: string;
  status?: string;
  // sidecar 发来的「状态码 + 插值参数」，由前端按界面语言翻译（取代旧的中文 status 文案）。
  statusCode?: string;
  statusParams?: ProgressStatusParams;
  text?: string;
  tool?: ToolProgressInfo;
  browser?: BrowserProgressInfo;
};

export type AssistantProgress = {
  runId: string;
  phase: AssistantProgressPhase;
  reasoningText: string;
  answerText: string;
  statusText: string;
  statusCode: string;
  statusParams?: ProgressStatusParams;
  toolEvents: ToolProgressInfo[];
};

// 进度文案改用 i18n：模型层只产出「翻译 key + 插值参数」，由组件 t(key, params) 渲染，
// 这样状态在英/日/韩界面下也跟随界面语言，而不是写死中文。
export type ProgressLabel = {
  key: string;
  params?: ProgressStatusParams;
};

export function createAssistantProgress(runId: string): AssistantProgress {
  return {
    runId,
    phase: "queued",
    reasoningText: "",
    answerText: "",
    statusText: "",
    statusCode: "",
    statusParams: undefined,
    toolEvents: []
  };
}

export function mergeAssistantStreamFragment(current: string, fragment: string | undefined): string {
  if (!fragment) {
    return current;
  }

  if (fragment.startsWith(current)) {
    return fragment;
  }

  if (current.endsWith(fragment)) {
    return current;
  }

  return `${current}${fragment}`;
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
      reasoningText: event.text ?? mergeAssistantStreamFragment(current.reasoningText, event.delta),
      statusText: event.status ?? "",
      statusCode: "",
      statusParams: undefined
    };
  }

  if (event.phase === "answering") {
    return {
      ...current,
      phase: "answering",
      answerText: event.text ?? mergeAssistantStreamFragment(current.answerText, event.delta),
      statusText: event.status ?? "",
      statusCode: "",
      statusParams: undefined
    };
  }

  if (event.phase === "tool") {
    // Keep the streaming answer phase intact: tool decisions interleave with
    // generation and should not reset the visible reasoning/answer text.
    return {
      ...current,
      statusText: event.status ?? current.statusText,
      toolEvents: event.tool ? [...current.toolEvents, event.tool] : current.toolEvents
    };
  }

  if (event.phase === "browser") {
    return {
      ...current,
      statusText: event.status ?? current.statusText
    };
  }

  return {
    ...current,
    phase: event.phase,
    statusText: event.status ?? current.statusText,
    statusCode: event.statusCode ?? current.statusCode,
    statusParams: event.statusCode ? event.statusParams : current.statusParams
  };
}

// 标题行的相位标签（准备中 / 推理中 / 生成回复）。返回 companion 命名空间下的 i18n key。
export function assistantProgressStatusLabel(phase: AssistantProgressPhase): ProgressLabel {
  switch (phase) {
    case "thinking":
      return { key: "chat.progress.statusLabel.thinking" };
    case "answering":
      return { key: "chat.progress.statusLabel.answering" };
    case "queued":
    default:
      return { key: "chat.progress.statusLabel.queued" };
  }
}

// 进度主文案。排队阶段优先用 sidecar 发来的状态码（如「请求已发送…」），否则回退到通用「准备中」。
export function assistantProgressPrimaryText(progress: AssistantProgress | null | undefined): ProgressLabel {
  switch (progress?.phase) {
    case "thinking":
      return { key: "chat.progress.primary.thinking" };
    case "answering":
      return { key: "chat.progress.primary.answering" };
    case "queued":
    default:
      if (progress?.statusCode) {
        return { key: `chat.progress.status.${progress.statusCode}`, params: progress.statusParams };
      }
      return { key: "chat.progress.primary.queued" };
  }
}

// 是否展示「思考中」推理标签：有推理文本、或正处于 thinking 相位时为 true。具体文案由组件翻译。
export function assistantReasoningActive(progress: AssistantProgress | null | undefined): boolean {
  const reasoningText = progress?.reasoningText.trim() ?? "";

  if (reasoningText) {
    return true;
  }

  return progress?.phase === "thinking";
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
