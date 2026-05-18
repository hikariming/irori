export type SettingsTab = {
  id: "model-provider" | "character-card" | "memory" | "safety";
  label: string;
  description: string;
};

export function buildSettingsTabs(): SettingsTab[] {
  return [
    {
      id: "model-provider",
      label: "模型供应商",
      description: "配置一个 OpenAI 兼容接口：Base URL、Token 和模型名。"
    },
    {
      id: "character-card",
      label: "角色卡",
      description: "管理人设、九宫格表情、立绘、背景和默认陪伴策略。"
    },
    {
      id: "memory",
      label: "记忆",
      description: "控制角色能记住什么、哪些内容永不写入记忆。"
    },
    {
      id: "safety",
      label: "权限",
      description: "配置读写文件、shell、网络请求和确认流程。"
    }
  ];
}
