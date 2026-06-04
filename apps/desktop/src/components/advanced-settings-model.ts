// 「高级设置」：影响编程 / Agent 能力的复杂开关，与普通角色/外观设置分开，降低误触。
// 目前只有一项：子代理委派（scout/worker/reviewer 等）。默认关闭——它会启动独立的
// pi 子进程、需要持久化会话，且子进程的工具调用走同一套安全围栏（evaluateToolCall）。
export type AdvancedSettings = {
  // 是否允许角色把任务委派给子代理（pi-subagents）。
  enableSubagents: boolean;
};

export const defaultAdvancedSettings: AdvancedSettings = {
  enableSubagents: false
};

// 容错：把任意输入归一成合法的高级设置，缺失/非法字段回落到默认（最安全）。
export function sanitizeAdvancedSettings(value: unknown): AdvancedSettings {
  if (!value || typeof value !== "object") {
    return { ...defaultAdvancedSettings };
  }

  const record = value as Record<string, unknown>;
  return {
    enableSubagents: record.enableSubagents === true
  };
}
