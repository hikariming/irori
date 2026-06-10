function toolTargetSummary(toolName, input = {}) {
  if (!input || typeof input !== "object") {
    return "";
  }

  if (toolName === "bash") {
    return typeof input.command === "string" ? input.command.slice(0, 200) : "";
  }

  return typeof input.path === "string" ? input.path : "";
}

/**
 * Bidirectional confirm bridge over the stdio transport. The agent emits a
 * confirm_request line to the host (Rust → desktop UI) and awaits a matching
 * confirm_response line on stdin. This is what turns a "needs_confirmation"
 * decision into a real interactive approve/reject round-trip.
 *
 * write(message): serialise one JSONL line to stdout.
 * handleLine(line): feed each stdin line; confirm_response lines resolve the
 *   matching pending request, everything else is ignored.
 * requestConfirm({ toolName, input, reason }): returns Promise<boolean>.
 */
export function createStdinConfirmBridge({ runId, write }) {
  const pending = new Map();
  let counter = 0;

  function handleLine(line) {
    const trimmed = typeof line === "string" ? line.trim() : "";
    if (!trimmed) {
      return;
    }

    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      return;
    }

    if (message?.type !== "confirm_response" || typeof message.confirmId !== "string") {
      return;
    }

    const resolve = pending.get(message.confirmId);
    if (!resolve) {
      return;
    }

    pending.delete(message.confirmId);
    resolve(message.approved === true);
  }

  function requestConfirm({ toolName, input, reason }) {
    counter += 1;
    const confirmId = `${runId}-confirm-${counter}`;

    return new Promise((resolve) => {
      pending.set(confirmId, resolve);
      write({
        type: "confirm_request",
        confirmId,
        runId,
        tool: {
          name: toolName,
          target: toolTargetSummary(toolName, input),
          reason: reason ?? ""
        }
      });
    });
  }

  return { handleLine, requestConfirm };
}
