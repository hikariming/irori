import {
  defaultToolGateConfigPath,
  readToolGateConfigSync,
  toolGateConfigEnvVar
} from "../tool-gate-config.mjs";
import { createToolPolicyGateExtension } from "../tool-policy-gate.mjs";

// Process-global marker the parent sidecar sets before loading extensions. The
// parent already runs the closure gate (which owns the desktop confirm channel),
// so the loadable package gate must NOT double-gate there. A subagent child is a
// fresh OS process (flag unset) → it enforces.
export const closureGateActiveFlag = "__iroriToolGateClosureActive";

// A subagent child has no desktop confirm channel, so a confirm decision fails
// closed. Instead of a dead-end block we tell the model to escalate over
// intercom — pi-subagents injects contact_supervisor into children — so the
// dangerous action routes back to the supervisor (the character) for approval.
function formatChildConfirmBlockReason(reason) {
  return `${reason || "此操作需要确认"}：子代理无法直接确认，请用 contact_supervisor（reason: "need_decision"）把这个操作回送主会话，由主人确认后再继续。`;
}

// Core child-side fence: reads the policy the sidecar wrote and shares the exact
// decision logic via createToolPolicyGateExtension. Eager read at construction is
// fine — a child is spawned per run, after the parent has written the config.
export function createInheritedToolGateExtension({
  configPath,
  readConfig = readToolGateConfigSync,
  confirmFallback = "block",
  formatConfirmBlockReason = formatChildConfirmBlockReason,
  onToolEvent
} = {}) {
  const resolvedPath =
    configPath || process.env[toolGateConfigEnvVar] || defaultToolGateConfigPath;
  const { gatePolicy, mode } = readConfig(resolvedPath);

  return createToolPolicyGateExtension({
    gatePolicy,
    mode,
    confirmFallback,
    formatConfirmBlockReason,
    onToolEvent
  });
}

// Loadable variant: no-ops in the parent (closure gate already active), enforces
// in subagent children. This is what the irori-tool-gate extension package
// re-exports as its default.
export function createSubagentToolGateExtension(options = {}) {
  return (pi) => {
    if (globalThis[closureGateActiveFlag]) {
      return;
    }
    createInheritedToolGateExtension(options)(pi);
  };
}

// Default export is the shape a pi resource loader invokes: (pi) => void.
export default createSubagentToolGateExtension();
