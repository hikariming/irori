export type CompanionMode = "companion" | "read" | "action" | "focus";

export type SafetyPolicy = {
  allowedTools: string[];
  protectedPaths: string[];
  alwaysConfirm: string[];
};

export type BuiltinPiTool = "read" | "grep" | "find" | "ls" | "bash" | "edit" | "write";

export type IroriTool =
  | "memory.read"
  | "memory.write"
  | "web.fetch"
  | "web.search"
  | "browser.view"
  | "browser.action";

export type ToolId = BuiltinPiTool | IroriTool;

export type ToolToggleMap<TTool extends string> = Partial<Record<TTool, boolean>>;

export type ToolPolicySettings = {
  builtinTools: ToolToggleMap<BuiltinPiTool>;
  customTools: ToolToggleMap<IroriTool>;
  confirmTools: ToolToggleMap<ToolId>;
  protectedPaths: string[];
};

export type ResolvedToolPolicy = Omit<SafetyPolicy, "allowedTools" | "alwaysConfirm"> & {
  builtinTools: BuiltinPiTool[];
  customTools: IroriTool[];
  allowedTools: ToolId[];
  alwaysConfirm: ToolId[];
};

export const readOnlyBuiltinTools: BuiltinPiTool[] = ["read", "grep", "find", "ls"];
export const writeBuiltinTools: BuiltinPiTool[] = ["bash", "edit", "write"];

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

function toggles<TTool extends string>(enabledTools: TTool[]): ToolToggleMap<TTool> {
  return Object.fromEntries(enabledTools.map((tool) => [tool, true])) as ToolToggleMap<TTool>;
}

function enabledTools<TTool extends string>(toolOrder: TTool[], map: ToolToggleMap<TTool> = {}): TTool[] {
  return toolOrder.filter((tool) => map[tool] === true);
}

export const defaultToolPolicySettings: ToolPolicySettings = {
  builtinTools: toggles<BuiltinPiTool>([...readOnlyBuiltinTools, ...writeBuiltinTools]),
  customTools: toggles<IroriTool>([
    "memory.read",
    "memory.write",
    "web.fetch",
    "web.search",
    "browser.view",
    "browser.action"
  ]),
  confirmTools: toggles<ToolId>(["bash", "edit", "write", "memory.write", "browser.action"]),
  protectedPaths: defaultProtectedPaths
};

export function resolveToolPolicy({
  settings = defaultToolPolicySettings
}: {
  settings?: ToolPolicySettings;
}): ResolvedToolPolicy {
  const builtinTools = enabledTools<BuiltinPiTool>(
    [...readOnlyBuiltinTools, ...writeBuiltinTools],
    settings.builtinTools
  );
  const customTools = enabledTools<IroriTool>(
    ["memory.read", "memory.write", "web.fetch", "web.search", "browser.view", "browser.action"],
    settings.customTools
  );
  const alwaysConfirm = enabledTools<ToolId>(
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
