export type SidecarEvent =
  | { type: "assistant_text_delta"; sessionId: string; delta: string }
  | { type: "thinking_delta"; sessionId: string; delta: string }
  | { type: "tool_started"; sessionId: string; toolCallId: string; name: string; summary: string }
  | { type: "tool_confirmation_required"; sessionId: string; toolCallId: string; request: unknown }
  | { type: "tool_finished"; sessionId: string; toolCallId: string; success: boolean; summary: string }
  | { type: "run_finished"; sessionId: string; traceId?: string }
  | { type: "error"; sessionId?: string; message: string };
