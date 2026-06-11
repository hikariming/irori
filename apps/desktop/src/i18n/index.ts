import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  isAppLanguage,
  normalizeLanguage,
  type AppLanguage
} from "./languages";

import commonZh from "./locales/zh-CN/common.json";
import onboardingZh from "./locales/zh-CN/onboarding.json";
import companionZh from "./locales/zh-CN/companion.json";
import workspaceZh from "./locales/zh-CN/workspace.json";
import profileZh from "./locales/zh-CN/profile.json";
import settingsZh from "./locales/zh-CN/settings.json";
import skillsZh from "./locales/zh-CN/skills.json";
import characterCardZh from "./locales/zh-CN/characterCard.json";
import commonEn from "./locales/en/common.json";
import onboardingEn from "./locales/en/onboarding.json";
import companionEn from "./locales/en/companion.json";
import workspaceEn from "./locales/en/workspace.json";
import profileEn from "./locales/en/profile.json";
import settingsEn from "./locales/en/settings.json";
import skillsEn from "./locales/en/skills.json";
import characterCardEn from "./locales/en/characterCard.json";
import commonJa from "./locales/ja/common.json";
import onboardingJa from "./locales/ja/onboarding.json";
import companionJa from "./locales/ja/companion.json";
import workspaceJa from "./locales/ja/workspace.json";
import profileJa from "./locales/ja/profile.json";
import settingsJa from "./locales/ja/settings.json";
import skillsJa from "./locales/ja/skills.json";
import characterCardJa from "./locales/ja/characterCard.json";
import commonKo from "./locales/ko/common.json";
import onboardingKo from "./locales/ko/onboarding.json";
import companionKo from "./locales/ko/companion.json";
import workspaceKo from "./locales/ko/workspace.json";
import profileKo from "./locales/ko/profile.json";
import settingsKo from "./locales/ko/settings.json";
import skillsKo from "./locales/ko/skills.json";
import characterCardKo from "./locales/ko/characterCard.json";

export const I18N_NAMESPACES = ["common", "onboarding", "companion", "workspace", "profile", "settings", "skills", "characterCard"] as const;
export const DEFAULT_NAMESPACE = "common";

const resources = {
  "zh-CN": { common: commonZh, onboarding: onboardingZh, companion: companionZh, workspace: workspaceZh, profile: profileZh, settings: settingsZh, skills: skillsZh, characterCard: characterCardZh },
  en: { common: commonEn, onboarding: onboardingEn, companion: companionEn, workspace: workspaceEn, profile: profileEn, settings: settingsEn, skills: skillsEn, characterCard: characterCardEn },
  ja: { common: commonJa, onboarding: onboardingJa, companion: companionJa, workspace: workspaceJa, profile: profileJa, settings: settingsJa, skills: skillsJa, characterCard: characterCardJa },
  ko: { common: commonKo, onboarding: onboardingKo, companion: companionKo, workspace: workspaceKo, profile: profileKo, settings: settingsKo, skills: skillsKo, characterCard: characterCardKo }
} as const;

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    // 韩日用户读不懂中文，缺译时优先回退英文，再退到源语言中文兜底。
    fallbackLng: {
      ja: ["en", "zh-CN"],
      ko: ["en", "zh-CN"],
      en: ["zh-CN"],
      default: ["en", "zh-CN"]
    },
    supportedLngs: [...Object.keys(resources)],
    ns: [...I18N_NAMESPACES],
    defaultNS: DEFAULT_NAMESPACE,
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      // 把 zh-TW / ja-JP / ko-KR 这类系统标签归一到我们支持的四种。
      convertDetectedLanguage: (lng: string) => normalizeLanguage(lng)
    },
    interpolation: {
      escapeValue: false // React 自带 XSS 转义。
    },
    returnNull: false
  });

// 把 <html lang> 同步成当前语言：CJK 字体栈、断行规则、无障碍朗读都依赖它。
function syncDocumentLanguage(language: string) {
  if (typeof document !== "undefined") {
    document.documentElement.lang = language;
  }
}

syncDocumentLanguage(i18n.resolvedLanguage ?? DEFAULT_LANGUAGE);
i18n.on("languageChanged", syncDocumentLanguage);

export function getCurrentLanguage(): AppLanguage {
  const current = i18n.resolvedLanguage ?? i18n.language;
  return isAppLanguage(current) ? current : DEFAULT_LANGUAGE;
}

export async function changeLanguage(language: AppLanguage): Promise<void> {
  await i18n.changeLanguage(language);
}

export default i18n;
