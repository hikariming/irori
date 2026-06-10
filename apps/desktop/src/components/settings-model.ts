export type SettingsTab = {
  id: "model-provider" | "character-card" | "memory" | "web-access" | "safety" | "advanced";
  label: string;
  description: string;
};

export function buildSettingsTabs(): SettingsTab[] {
  return [
    {
      id: "model-provider",
      label: "模型接入",
      description: "保存多模型配置档案，并选择当前聊天使用的模型。"
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
      id: "web-access",
      label: "联网",
      description: "配置 Exa、Perplexity、Gemini 搜索 provider 与 API Key。"
    },
    {
      id: "safety",
      label: "权限",
      description: "配置读写文件、shell、网络请求和确认流程。"
    },
    {
      id: "advanced",
      label: "高级",
      description: "影响编程 / Agent 能力的复杂开关，如子代理委派。默认关闭，谨慎开启。"
    }
  ];
}
