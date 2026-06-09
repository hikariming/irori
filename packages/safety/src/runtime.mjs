export const readOnlyBuiltinTools = ["read", "grep", "find", "ls"];
export const writeBuiltinTools = ["bash", "edit", "write"];

export const defaultProtectedPaths = [
  ".env",
  ".env.*",
  "secrets.*",
  "credentials.*",
  ".ssh",
  ".aws",
  ".gnupg",
  "node_modules"
];

function toggles(enabledTools) {
  return Object.fromEntries(enabledTools.map((tool) => [tool, true]));
}

function enabledTools(toolOrder, map = {}) {
  return toolOrder.filter((tool) => map[tool] === true);
}

export const defaultToolPolicySettings = {
  builtinTools: toggles([...readOnlyBuiltinTools, ...writeBuiltinTools]),
  customTools: toggles([
    "memory.read",
    "memory.write",
    "web.fetch",
    "web.search",
    "browser.view",
    "browser.action"
  ]),
  confirmTools: toggles(["bash", "edit", "write", "memory.write", "browser.action"]),
  protectedPaths: defaultProtectedPaths
};

// Tools a skill is allowed to force-enable for a session via its `allowed-tools`
// frontmatter. Deliberately excludes bash/edit/write and the read-only file
// tools: a user-authored skill must never silently grant shell or filesystem
// mutation. Everything here is still subject to the gate (confirm/protected
// paths) once enabled.
export const skillGrantableToolIds = [
  "web.search",
  "web.fetch",
  "browser.view",
  "memory.read",
  "memory.write"
];

export function resolveToolPolicy({ settings = defaultToolPolicySettings } = {}) {
  const builtinTools = enabledTools(
    [...readOnlyBuiltinTools, ...writeBuiltinTools],
    settings.builtinTools
  );
  const customTools = enabledTools(
    ["memory.read", "memory.write", "web.fetch", "web.search", "browser.view", "browser.action"],
    settings.customTools
  );
  const alwaysConfirm = enabledTools(
    [
      ...readOnlyBuiltinTools,
      ...writeBuiltinTools,
      "memory.read",
      "memory.write",
      "web.fetch",
      "web.search",
      "browser.view",
      "browser.action"
    ],
    settings.confirmTools
  );

  return {
    builtinTools,
    customTools,
    allowedTools: [...builtinTools, ...customTools],
    protectedPaths: [...settings.protectedPaths],
    alwaysConfirm
  };
}

// Pi tool names (as seen by the tool_call hook) that only observe, never mutate
// the workspace or external world.
export const readOnlyGateTools = new Set([
  "read",
  "grep",
  "find",
  "ls",
  "memory_read",
  "web_search",
  "fetch_content",
  "get_search_content",
  "browser_view"
]);

// Writes that a git checkpoint can fully undo, so higher autonomy modes may run
// them without a per-call confirmation.
export const reversibleGateTools = new Set(["edit", "write", "memory_write"]);

// High-risk shell patterns that always require explicit confirmation regardless
// of autonomy mode. Kept conservative on purpose: false positives only cost a prompt.
export const dangerousBashPatterns = [
  /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|--recursive\b|-[a-z]*r\b)/i,
  /\bsudo\b/i,
  /\b(chmod|chown)\b[^\n]*\b777\b/i,
  /\bmkfs\b/i,
  /\bdd\b[^\n]*\bof=/i,
  /\bgit\b[^\n]*\bpush\b[^\n]*(--force\b|-f\b)/i,
  /\b(shutdown|reboot|halt)\b/i,
  /:\s*\(\s*\)\s*\{[^}]*\}\s*;\s*:/
];

export const gateAutonomyModes = ["readonly", "confirm", "auto", "managed"];

function toSet(value) {
  if (value instanceof Set) {
    return value;
  }

  return new Set(Array.isArray(value) ? value : []);
}

function patternToRegExp(pattern) {
  const escaped = pattern
    .trim()
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");

  return new RegExp(`^${escaped}$`, "i");
}

function pathSegments(value) {
  return String(value)
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

// A path is protected when the whole value or any of its segments matches a
// protected pattern (so ".ssh" matches "~/.ssh/id_rsa" and ".env.*" matches ".env.local").
export function isProtectedPath(value, protectedPaths = []) {
  if (typeof value !== "string" || !value.trim()) {
    return false;
  }

  const normalized = value.trim();
  const segments = pathSegments(normalized);

  return protectedPaths.some((pattern) => {
    const regExp = patternToRegExp(pattern);
    return regExp.test(normalized) || segments.some((segment) => regExp.test(segment));
  });
}

// Heuristic: does a bash command reference a protected path token? Command
// parsing is unreliable, so we scan whitespace/operator-delimited tokens.
export function commandTouchesProtectedPath(command, protectedPaths = []) {
  if (typeof command !== "string" || !command.trim()) {
    return false;
  }

  const tokens = command.split(/[\s;|&><()'"=]+/).filter(Boolean);

  return tokens.some((token) => isProtectedPath(token, protectedPaths));
}

// File-path arguments a tool call will act on. Bash is handled separately via
// command scanning because its targets are not structured arguments.
export function toolTargetPaths(toolName, input = {}) {
  if (!input || typeof input !== "object" || toolName === "bash") {
    return [];
  }

  return typeof input.path === "string" && input.path.trim() ? [input.path.trim()] : [];
}

function resolveConfirmDecision({ mode, toolName, reason, dangerous }) {
  if (dangerous) {
    return { decision: "confirm", reason };
  }

  if (mode === "managed") {
    return { decision: "allow" };
  }

  if (mode === "auto" && toolName && reversibleGateTools.has(toolName)) {
    return { decision: "allow" };
  }

  return { decision: "confirm", reason };
}

/**
 * Decide what should happen to a single concrete tool call. Pure: no IO, no Pi
 * types. The Pi tool_call extension translates the decision into block/allow.
 *
 * policy: { allowedToolNames, confirmToolNames, protectedPaths }
 * mode: one of gateAutonomyModes — moves the fence along the autonomy spectrum.
 */
export function evaluateToolCall({ toolName, input = {}, policy = {}, mode = "confirm" } = {}) {
  const allowed = toSet(policy.allowedToolNames);
  const confirm = toSet(policy.confirmToolNames);
  const protectedPaths = Array.isArray(policy.protectedPaths) ? policy.protectedPaths : [];

  if (!allowed.has(toolName)) {
    return { decision: "block", reason: `工具「${toolName}」未在当前策略中启用。` };
  }

  const readOnly = readOnlyGateTools.has(toolName);

  if (mode === "readonly" && !readOnly) {
    return { decision: "block", reason: "只读模式下不允许执行写操作或 shell 命令。" };
  }

  for (const target of toolTargetPaths(toolName, input)) {
    const matched = protectedPaths.find((pattern) => isProtectedPath(target, [pattern]));
    if (matched) {
      return { decision: "block", reason: `目标路径「${target}」命中受保护路径（${matched}），已拦截。` };
    }
  }

  if (toolName === "bash") {
    const command = typeof input.command === "string" ? input.command : "";
    const matched = protectedPaths.find((pattern) => commandTouchesProtectedPath(command, [pattern]));
    if (matched) {
      return { decision: "block", reason: `命令疑似触及受保护路径（${matched}），已拦截。` };
    }

    if (dangerousBashPatterns.some((expression) => expression.test(command))) {
      return resolveConfirmDecision({ mode, toolName, reason: "检测到高风险 shell 命令，需要你确认后才能执行。", dangerous: true });
    }
  }

  if (confirm.has(toolName)) {
    return resolveConfirmDecision({ mode, toolName, reason: `操作「${toolName}」按当前策略需要确认。`, dangerous: false });
  }

  return { decision: "allow" };
}
