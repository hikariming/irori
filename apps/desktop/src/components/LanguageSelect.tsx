import { Button } from "@heroui/react";
import { useTranslation } from "react-i18next";

import { getCurrentLanguage } from "../i18n";
import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES, type AppLanguage } from "../i18n/languages";

type LanguageSelectProps = {
  /** "chips" 用于引导页的并排选择，"dropdown" 用于设置页的紧凑下拉。 */
  variant?: "chips" | "dropdown";
};

// 统一的语言切换控件：改语言即 i18next.changeLanguage，detector 的 localStorage 缓存
// 会自动持久化，<html lang> 由 i18n 初始化里的 languageChanged 监听同步。
export function LanguageSelect({ variant = "dropdown" }: LanguageSelectProps) {
  const { t, i18n } = useTranslation("common");
  const current = getCurrentLanguage();

  function select(language: AppLanguage) {
    if (language !== current) {
      void i18n.changeLanguage(language);
    }
  }

  if (variant === "chips") {
    return (
      <div className="language-chips" role="group" aria-label={t("language.label")}>
        {SUPPORTED_LANGUAGES.map((language) => (
          <Button
            key={language}
            type="button"
            aria-pressed={current === language}
            className={`language-chip ${current === language ? "active" : ""}`}
            onPress={() => select(language)}
          >
            {LANGUAGE_LABELS[language]}
          </Button>
        ))}
      </div>
    );
  }

  return (
    <label className="settings-input">
      <span>{t("language.label")}</span>
      <select
        aria-label={t("language.label")}
        value={current}
        onChange={(event) => select(event.target.value as AppLanguage)}
      >
        {SUPPORTED_LANGUAGES.map((language) => (
          <option key={language} value={language}>
            {LANGUAGE_LABELS[language]}
          </option>
        ))}
      </select>
    </label>
  );
}
