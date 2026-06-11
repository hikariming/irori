// 工具调用的「审核模式」：决定危险操作（改文件、跑命令等）发生时由谁来放行。
//
// 三种模式在底层都让安全闸保持 confirm 判定，只是「谁回答这个确认」不同：
//   default — 弹给用户手动审核（现状）
//   auto    — 交给大模型自己审查、自动放行/拒绝，不打扰用户
//   all     — 全部自动通过（有风险，跳过一切审核）
// 真正的分流在 sidecar 里按本字段选择 onConfirm 解析器。
export type ReviewMode = "default" | "auto" | "all";

export const DEFAULT_REVIEW_MODE: ReviewMode = "default";

// 文案（label/short/description）已抽到 i18n 的 companion:reviewMode.<id>.*，
// 这里只保留稳定的 id 与风险标记，文本在组件里按 id 用 t() 渲染。
export type ReviewModeOption = {
  id: ReviewMode;
  // 风险提示：all 模式标红用。
  risky: boolean;
};

export const reviewModeOptions: ReviewModeOption[] = [
  { id: "default", risky: false },
  { id: "auto", risky: false },
  { id: "all", risky: true }
];

const REVIEW_MODE_IDS = new Set<ReviewMode>(reviewModeOptions.map((option) => option.id));

export function isReviewMode(value: unknown): value is ReviewMode {
  return typeof value === "string" && REVIEW_MODE_IDS.has(value as ReviewMode);
}

// 容错：把任意输入归一成合法模式，非法一律回落到默认（最安全）。
export function sanitizeReviewMode(value: unknown): ReviewMode {
  return isReviewMode(value) ? value : DEFAULT_REVIEW_MODE;
}

export function reviewModeOption(mode: ReviewMode): ReviewModeOption {
  return reviewModeOptions.find((option) => option.id === mode) ?? reviewModeOptions[0];
}
