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
