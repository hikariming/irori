import {
  defaultToolPolicySettings,
  resolveToolPolicy,
  type CockapooTool,
  type ToolId,
  type ToolPolicySettings
} from "../../../../packages/safety/src/index.ts";

export { defaultToolPolicySettings };
export type { CockapooTool, ToolId, ToolPolicySettings };

export type ToolPolicyToggleGroup = "builtinTools" | "customTools" | "confirmTools";

export type ToolPolicyToggle = {
  id: ToolId;
  label: string;
  description: string;
  enabled: boolean;
};

const toolLabels: Record<ToolId, string> = {
  read: "读文件",
  grep: "搜索文本",
  find: "查找文件",
  ls: "列目录",
  bash: "Shell",
  edit: "编辑文件",
  write: "写文件",
  "memory.read": "读取记忆",
  "memory.write": "写入记忆",
  "web.fetch": "读取网页",
  "web.search": "网页搜索",
  "browser.view": "浏览器查看",
  "browser.action": "浏览器操作"
};

const toolDescriptions: Record<ToolId, string> = {
  read: "读取工作区文件内容。",
  grep: "在工作区里搜索文本。",
  find: "按名称查找文件。",
  ls: "查看目录结构。",
  bash: "运行本地 shell 命令。",
  edit: "修改已有文件。",
  write: "创建或覆盖文件。",
  "memory.read": "召回用户、角色和项目记忆。",
  "memory.write": "把确认后的内容写入记忆。",
  "web.fetch": "读取公开 URL 内容。",
  "web.search": "搜索公开网页结果。",
  "browser.view": "打开页面并读取可见状态。",
  "browser.action": "点击、输入或提交页面操作。"
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
  return {
    id,
    label: toolLabels[id],
    description: toolDescriptions[id],
    enabled
  };
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
