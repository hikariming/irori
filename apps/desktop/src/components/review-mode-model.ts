// 工具调用的「审核模式」：决定危险操作（改文件、跑命令等）发生时由谁来放行。
//
// 三种模式在底层都让安全闸保持 confirm 判定，只是「谁回答这个确认」不同：
//   default — 弹给用户手动审核（现状）
//   auto    — 交给大模型自己审查、自动放行/拒绝，不打扰用户
//   all     — 全部自动通过（有风险，跳过一切审核）
// 真正的分流在 sidecar 里按本字段选择 onConfirm 解析器。
export type ReviewMode = "default" | "auto" | "all";

export const DEFAULT_REVIEW_MODE: ReviewMode = "default";

export type ReviewModeOption = {
  id: ReviewMode;
  label: string;
  // 选择器收起时显示的短名。
  short: string;
  description: string;
  // 风险提示：all 模式标红用。
  risky: boolean;
};

export const reviewModeOptions: ReviewModeOption[] = [
  {
    id: "default",
    label: "手动审核",
    short: "手动审核",
    description: "危险操作（改文件、跑命令等）会暂停，等你点允许或取消。",
    risky: false
  },
  {
    id: "auto",
    label: "大模型审查",
    short: "大模型审查",
    description: "由大模型自动审查每次危险操作并放行或拒绝，不打扰你。",
    risky: false
  },
  {
    id: "all",
    label: "全部通过",
    short: "全部通过",
    description: "跳过一切审核，所有操作直接执行。有风险，请谨慎使用。",
    risky: true
  }
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
