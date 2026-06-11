// 受支持的界面语言。zh-CN 是源语言（所有文案的母本），缺译时按回退链补齐。
export const SUPPORTED_LANGUAGES = ["zh-CN", "en", "ja", "ko"] as const;

export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: AppLanguage = "zh-CN";

// 语言选择器里展示的名字，一律用该语言自己的写法（endonym），不翻译。
export const LANGUAGE_LABELS: Record<AppLanguage, string> = {
  "zh-CN": "简体中文",
  en: "English",
  ja: "日本語",
  ko: "한국어"
};

// localStorage 持久化的 key，也是 i18next detector 的 lookup key。
export const LANGUAGE_STORAGE_KEY = "irori-language";

export function isAppLanguage(value: unknown): value is AppLanguage {
  return typeof value === "string" && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

// 把浏览器/系统给出的 BCP-47 标签（zh-CN、ja-JP、ko-KR、en-US…）收敛到我们支持的四种。
// 任何 zh-* 都归到 zh-CN（含 zh-TW/zh-HK，先保证有中文兜底）。
export function normalizeLanguage(raw: string | null | undefined): AppLanguage {
  if (!raw) {
    return DEFAULT_LANGUAGE;
  }
  const lower = raw.toLowerCase();
  if (lower.startsWith("zh")) {
    return "zh-CN";
  }
  if (lower.startsWith("ja")) {
    return "ja";
  }
  if (lower.startsWith("ko")) {
    return "ko";
  }
  if (lower.startsWith("en")) {
    return "en";
  }
  return DEFAULT_LANGUAGE;
}
