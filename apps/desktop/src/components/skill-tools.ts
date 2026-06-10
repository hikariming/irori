// 技能可授予的工具（与 packages/safety/src/runtime.mjs 的 skillGrantableToolIds
// 保持一致）。技能只能放开这些「安全」能力，绝不含 bash/edit/write；放开后仍受
// 工具审核围栏管控。改这里时记得同步那边。

export type SkillToolOption = {
  id: string;
  label: string;
  hint: string;
};

export const skillToolOptions: SkillToolOption[] = [
  { id: "web.search", label: "联网搜索", hint: "让角色用搜索引擎查资料" },
  { id: "web.fetch", label: "抓取网页", hint: "读取指定网页的正文内容" },
  { id: "browser.view", label: "打开网页", hint: "在右侧浏览器面板里展示页面" },
  { id: "memory.read", label: "读取记忆", hint: "检索长期 / 会话记忆" },
  { id: "memory.write", label: "写入记忆", hint: "保存用户认可的长期记忆" }
];

const labelById = new Map(skillToolOptions.map((option) => [option.id, option.label]));

export function skillToolLabel(id: string): string {
  return labelById.get(id) ?? id;
}
