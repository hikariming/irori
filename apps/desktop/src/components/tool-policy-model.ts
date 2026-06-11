import {
  defaultToolPolicySettings,
  resolveToolPolicy,
  type IroriTool,
  type ToolId,
  type ToolPolicySettings
} from "../../../../packages/safety/src/index.ts";

export { defaultToolPolicySettings };
export type { IroriTool, ToolId, ToolPolicySettings };

export type ToolPolicyToggleGroup = "builtinTools" | "customTools" | "confirmTools";

// 文案（label/description）已抽到 i18n 的 settings:tools.<id>.*；
// 这里只保留稳定的 id 与启用态，文本在组件里按 id 用 t() 渲染。
export type ToolPolicyToggle = {
  id: ToolId;
  enabled: boolean;
};

const toolOrder: ToolId[] = [
  "read",
  "grep",
  "find",
  "ls",
  "bash",
  "edit",
  "write",
  "memory.read",
  "memory.write",
  "web.fetch",
  "web.search",
  "browser.view",
  "browser.action"
];

function toolToggle(id: ToolId, enabled: boolean): ToolPolicyToggle {
  return { id, enabled };
}

export function buildToolPolicySettingsViewModel(settings: ToolPolicySettings) {
  const resolved = resolveToolPolicy({ settings });

  return {
    enabledTools: resolved.allowedTools.map((tool) => toolToggle(tool, true)),
    confirmTools: resolved.alwaysConfirm.map((tool) => toolToggle(tool, true)),
    protectedPathsPreview: settings.protectedPaths.join(" / "),
    toolOrder: toolOrder.map((tool) => toolToggle(tool, false))
  };
}

export function toggleToolPolicyItem({
  settings,
  group,
  toolId
}: {
  settings: ToolPolicySettings;
  group: ToolPolicyToggleGroup;
  toolId: ToolId;
}): ToolPolicySettings {
  const groupSettings = settings[group] as Partial<Record<ToolId, boolean>>;
  const current = groupSettings[toolId] === true;

  return {
    ...settings,
    [group]: {
      ...groupSettings,
      [toolId]: !current
    }
  };
}
