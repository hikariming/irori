export type ComposerState = {
  draft: string;
  disabled: boolean;
};

export const defaultComposerState: ComposerState = {
  draft: "",
  disabled: false
};

export function canSendMessage(state: ComposerState) {
  return !state.disabled && state.draft.trim().length > 0;
}
