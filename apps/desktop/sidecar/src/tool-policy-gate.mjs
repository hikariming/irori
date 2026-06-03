import { evaluateToolCall } from "../../../../packages/safety/src/runtime.mjs";

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
 * Pi extension factory that enforces the Cockapoo tool-policy fence inside the
 * native tool_call hook. Returns { block, reason } to stop a call, or undefined
 * to let it run. Every decision is mirrored to onToolEvent so the desktop can
 * show what the companion did or was stopped from doing.
 *
 * onConfirm (optional): async ({ toolName, input, reason }) => boolean. When
 * provided, "confirm" decisions round-trip to it (the interactive approve flow).
 * Without it, confirmFallback decides: "block" (default, safe) or "allow".
 */
export function createToolPolicyGateExtension(options = {}) {
  const {
    gatePolicy,
    mode = "confirm",
    onToolEvent,
    onConfirm,
    confirmFallback = "block"
  } = options;

  return (pi) => {
    pi.on("tool_call", async (event) => {
      const { toolName, input } = event;
      const result = evaluateToolCall({ toolName, input, policy: gatePolicy, mode });
      const target = toolTargetSummary(toolName, input);
      const emit = (status, reason) => {
        onToolEvent?.({ toolName, target, status, reason: reason ?? result.reason });
      };

      if (result.decision === "allow") {
        emit("allowed");
        return undefined;
      }

      if (result.decision === "block") {
        emit("blocked");
        return { block: true, reason: result.reason };
      }

      if (typeof onConfirm === "function") {
        let approved = false;
        try {
          approved = (await onConfirm({ toolName, input, reason: result.reason })) === true;
        } catch {
          approved = false;
        }

        emit(approved ? "confirmed" : "rejected");
        return approved ? undefined : { block: true, reason: result.reason || "用户取消了该操作。" };
      }

      emit("needs_confirmation");

      if (confirmFallback === "allow") {
        return undefined;
      }

      return {
        block: true,
        reason: `${result.reason || "此操作需要确认"}（确认面板尚未开启，已暂时拦截）`
      };
    });
  };
}
