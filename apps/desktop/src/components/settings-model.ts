// 文案（label/description）已抽到 i18n 的 settings:tabs.<id>.*；
// 这里只保留稳定的 id 与顺序，文本在组件里按 id 用 t() 渲染。
export type SettingsTabId = "model-provider" | "language" | "character-card" | "memory" | "web-access" | "safety" | "advanced";

export type SettingsTab = {
  id: SettingsTabId;
};

export function buildSettingsTabs(): SettingsTab[] {
  return [
    { id: "model-provider" },
    { id: "language" },
    { id: "character-card" },
    { id: "memory" },
    { id: "web-access" },
    { id: "safety" },
    { id: "advanced" }
  ];
}
