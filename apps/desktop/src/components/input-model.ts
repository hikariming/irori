export type ComposerMode = "companion" | "task" | "agent";

export type ComposerState = {
  draft: string;
  mode: ComposerMode;
  disabled: boolean;
};

export const defaultComposerState: ComposerState = {
  draft: "",
  mode: "companion",
  disabled: false
};

export function canSendMessage(state: ComposerState) {
  return !state.disabled && state.draft.trim().length > 0;
}

export const composerModes: Array<{ id: ComposerMode; label: string; hint: string }> = [
  { id: "companion", label: "陪伴", hint: "更像日常对话" },
  { id: "task", label: "协作", hint: "帮你拆任务" },
  { id: "agent", label: "执行", hint: "交给本地 agent" }
];
