// 技能可授予的工具（与 packages/safety/src/runtime.mjs 的 skillGrantableToolIds
// 保持一致）。技能只能放开这些「安全」能力，绝不含 bash/edit/write；放开后仍受
// 工具审核围栏管控。改这里时记得同步那边。

// 文案（label/hint）已抽到 i18n 的 skills:tool.<id>.*；这里只保留稳定的 id，
// 文本在组件里按 id 用 t() 渲染。
export type SkillToolOption = {
  id: string;
};

export const skillToolOptions: SkillToolOption[] = [
  { id: "web.search" },
  { id: "web.fetch" },
  { id: "browser.view" },
  { id: "memory.read" },
  { id: "memory.write" }
];
