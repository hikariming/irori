import { Button } from "@heroui/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { desktopBackend } from "./desktop-backend";
import { LanguageSelect } from "./LanguageSelect";
import { PresetProviderSections, PresetQuickSetup } from "./ModelPresetPicker";
import {
  buildProfileFromPreset,
  detectPresetProvider,
  getActiveModelProfile,
  isModelConfigured,
  normalizeOpenAiCompatibleSettings,
  type ModelSettingsState,
  type PresetProvider
} from "./model-settings-controller";
import { genderOptions, type UserProfile } from "./user-profile";

type OnboardingFlowProps = {
  appName: string;
  profile: UserProfile;
  onProfileChange: (patch: Partial<UserProfile>) => void;
  modelSettings: ModelSettingsState;
  onModelSettingsChange: (settings: ModelSettingsState) => void;
  onFinish: () => void;
  onSkip: () => void;
};

const FEATURE_KEYS = ["companion", "life", "circle", "memory"] as const;
const STEP_KEYS = ["welcome", "identity", "model", "done"] as const;
const TOTAL_STEPS = STEP_KEYS.length;
const BASE_URL_PLACEHOLDER = "https://api.example.com/v1";

// 首次使用引导：四步——欢迎 → 我是谁 → 模型供应商 → 完成。
// 在「我」与模型设置都为空时出现，引导用户把基础信息和模型配好。
export function OnboardingFlow({
  appName,
  profile,
  onProfileChange,
  modelSettings,
  onModelSettingsChange,
  onFinish,
  onSkip
}: OnboardingFlowProps) {
  const { t } = useTranslation(["onboarding", "common", "settings"]);
  const [step, setStep] = useState(0);

  const activeProfile = getActiveModelProfile(modelSettings);
  const initialPreset = detectPresetProvider(activeProfile) ?? null;
  const [modelDraft, setModelDraft] = useState({
    name: activeProfile.name,
    baseUrl: activeProfile.baseUrl,
    modelName: activeProfile.modelName,
    token: ""
  });
  const [selectedPreset, setSelectedPreset] = useState<PresetProvider | null>(initialPreset);
  const [selectedModelSuggestion, setSelectedModelSuggestion] = useState(
    initialPreset?.modelSuggestions.some((model) => model.value === activeProfile.modelName)
      ? activeProfile.modelName
      : ""
  );
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const modelConfigured = isModelConfigured(modelSettings);

  function patchModel(patch: Partial<typeof modelDraft>) {
    setModelDraft((current) => ({ ...current, ...patch }));
    setSaveState("idle");
  }

  function applyPresetSelection(preset: PresetProvider, modelValue = preset.modelSuggestions[0]?.value ?? "") {
    const profile = buildProfileFromPreset(preset, modelValue, activeProfile.id);

    setSelectedPreset(preset);
    setSelectedModelSuggestion(modelValue);
    setModelDraft((current) => ({
      ...current,
      name: profile.name,
      baseUrl: profile.baseUrl,
      modelName: profile.modelName
    }));
    setSaveState("idle");
  }

  function selectPresetModel(modelValue: string) {
    if (!selectedPreset) {
      return;
    }

    applyPresetSelection(selectedPreset, modelValue);
  }

  async function saveModel() {
    if (saveState === "saving") {
      return;
    }
    setSaveState("saving");
    try {
      const normalized = normalizeOpenAiCompatibleSettings({
        baseUrl: modelDraft.baseUrl,
        modelName: modelDraft.modelName
      });
      const settings = await desktopBackend.saveModelSettings({
        profileId: activeProfile.id,
        name: modelDraft.name.trim() || activeProfile.name,
        baseUrl: normalized.baseUrl,
        modelName: normalized.modelName,
        token: modelDraft.token.trim() || undefined,
        makeActive: true
      });
      onModelSettingsChange(settings);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  const isLast = step === TOTAL_STEPS - 1;

  return (
    <aside className="onboarding-overlay" aria-label={t("ariaTitle", { app: appName })}>
      <div className="onboarding-card">
        <div className="onboarding-progress" role="progressbar" aria-valuemin={1} aria-valuemax={TOTAL_STEPS} aria-valuenow={step + 1}>
          {STEP_KEYS.map((key, index) => (
            <span
              key={key}
              className={`onboarding-progress-dot ${index === step ? "active" : ""} ${index < step ? "done" : ""}`}
              aria-label={t("stepAria", { index: index + 1, title: t(`steps.${key}`) })}
            />
          ))}
        </div>

        <div className="onboarding-body">
          {step === 0 ? (
            <section className="onboarding-step onboarding-step--welcome">
              <figure className="onboarding-welcome-art">
                <img src="/assets/onboarding-welcome-characters-v2.png" alt={t("welcome.imageAlt")} />
              </figure>
              <p className="onboarding-eyebrow">{t("welcome.eyebrow")}</p>
              <h2 className="onboarding-title">{appName}</h2>
              <p className="onboarding-lead">{t("welcome.lead")}</p>
              <LanguageSelect variant="chips" />
              <ul className="onboarding-features">
                {FEATURE_KEYS.map((key) => (
                  <li key={key}>
                    <strong>{t(`welcome.features.${key}.title`)}</strong>
                    <span>{t(`welcome.features.${key}.desc`)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {step === 1 ? (
            <section className="onboarding-step onboarding-step--with-art">
              <div className="onboarding-step-head">
                <div>
                  <p className="onboarding-eyebrow">{t("identity.eyebrow")}</p>
                  <h2 className="onboarding-title">{t("identity.title")}</h2>
                  <p className="onboarding-lead">{t("identity.lead")}</p>
                </div>
                <figure className="onboarding-step-art onboarding-step-art--single">
                  <img src="/assets/onboarding-identity-shili.png" alt="示璃第一次与你见面" />
                </figure>
              </div>

              <label className="settings-input">
                <span>{t("identity.nameLabel")}</span>
                <input
                  aria-label={t("identity.nameAria")}
                  placeholder={t("identity.namePlaceholder")}
                  value={profile.name}
                  maxLength={40}
                  onChange={(event) => onProfileChange({ name: event.target.value })}
                />
              </label>

              <div className="profile-field" role="group" aria-label={t("identity.genderLabel")}>
                <span className="profile-field-label">{t("identity.genderLabel")}</span>
                <div className="profile-gender-options">
                  {genderOptions.map((gender) => (
                    <Button
                      key={gender}
                      type="button"
                      aria-pressed={profile.gender === gender}
                      className={`profile-gender-chip ${profile.gender === gender ? "active" : ""}`}
                      onPress={() => onProfileChange({ gender })}
                    >
                      {t(`common:gender.${gender}`)}
                    </Button>
                  ))}
                </div>
              </div>

              <label className="settings-input">
                <span>{t("identity.cityLabel")}</span>
                <input
                  aria-label={t("identity.cityAria")}
                  placeholder={t("identity.cityPlaceholder")}
                  value={profile.city}
                  maxLength={40}
                  onChange={(event) => onProfileChange({ city: event.target.value })}
                />
              </label>

              <label className="profile-field">
                <span className="profile-field-label">{t("identity.introLabel")}</span>
                <textarea
                  className="profile-textarea"
                  aria-label={t("identity.introAria")}
                  placeholder={t("identity.introPlaceholder")}
                  value={profile.selfIntroduction}
                  maxLength={600}
                  rows={3}
                  onChange={(event) => onProfileChange({ selfIntroduction: event.target.value })}
                />
              </label>
            </section>
          ) : null}

          {step === 2 ? (
            <section className="onboarding-step onboarding-step--with-art">
              <div className="onboarding-step-head">
                <div>
                  <p className="onboarding-eyebrow">{t("model.eyebrow")}</p>
                  <h2 className="onboarding-title">{t("model.title")}</h2>
                  <p className="onboarding-lead">{t("model.lead")}</p>
                </div>
                <figure className="onboarding-step-art onboarding-step-art--duo">
                  <img src="/assets/onboarding-model-tangyuan-cenji.png" alt="唐愿和岑霁陪你连接模型供应商" />
                </figure>
              </div>

              <div className="onboarding-preset-picker">
                {selectedPreset ? (
                  <PresetQuickSetup
                    disabled={saveState === "saving"}
                    modelLabel={t("settings:model.selectModel")}
                    onModelSelect={selectPresetModel}
                    preset={selectedPreset}
                    selectedModelValue={selectedModelSuggestion}
                  />
                ) : null}
                <PresetProviderSections
                  disabled={saveState === "saving"}
                  officialTitle={t("settings:model.officialApi")}
                  onSelect={applyPresetSelection}
                  selectedPresetId={selectedPreset?.id}
                />
              </div>

              <label className="settings-input">
                <span>{t("model.nameLabel")}</span>
                <input
                  aria-label={t("model.nameAria")}
                  placeholder={t("model.namePlaceholder")}
                  value={modelDraft.name}
                  onChange={(event) => patchModel({ name: event.target.value })}
                />
              </label>
              <label className="settings-input">
                <span>{t("model.baseUrlLabel")}</span>
                <input
                  aria-label={t("model.baseUrlAria")}
                  placeholder={BASE_URL_PLACEHOLDER}
                  value={modelDraft.baseUrl}
                  onChange={(event) => patchModel({ baseUrl: event.target.value })}
                />
              </label>
              <label className="settings-input">
                <span>{t("model.modelNameLabel")}</span>
                <input
                  aria-label={t("model.modelNameAria")}
                  placeholder={t("model.modelNamePlaceholder")}
                  value={modelDraft.modelName}
                  onChange={(event) => patchModel({ modelName: event.target.value })}
                />
              </label>
              <label className="settings-input">
                <span>{t("model.tokenLabel")}</span>
                <input
                  aria-label={t("model.tokenAria")}
                  type="password"
                  placeholder={activeProfile.hasToken ? t("model.tokenPlaceholderSaved") : (selectedPreset?.tokenPlaceholder ?? t("model.tokenPlaceholderNew"))}
                  value={modelDraft.token}
                  onChange={(event) => patchModel({ token: event.target.value })}
                />
              </label>

              <div className="onboarding-model-actions">
                <Button
                  type="button"
                  className="settings-primary-action"
                  isDisabled={saveState === "saving"}
                  onPress={saveModel}
                >
                  {saveState === "saving" ? t("model.saving") : t("model.save")}
                </Button>
                {saveState === "saved" || modelConfigured ? (
                  <span className="settings-save-note">{t("model.saved")}</span>
                ) : null}
                {saveState === "error" ? <span className="settings-save-note error">{t("model.error")}</span> : null}
              </div>
            </section>
          ) : null}

          {step === 3 ? (
            <section className="onboarding-step onboarding-step--center">
              <div className="onboarding-done-badge" aria-hidden="true">✓</div>
              <h2 className="onboarding-title">
                {profile.name ? t("done.titleNamed", { name: profile.name }) : t("done.title")}
              </h2>
              <p className="onboarding-lead">
                {modelConfigured ? t("done.leadConfigured") : t("done.leadUnconfigured")}
              </p>
            </section>
          ) : null}
        </div>

        <footer className="onboarding-footer">
          <div className="onboarding-footer-left">
            {step > 0 ? (
              <Button type="button" className="onboarding-ghost" onPress={() => setStep((current) => current - 1)}>
                {t("footer.back")}
              </Button>
            ) : (
              <Button type="button" className="onboarding-ghost" onPress={onSkip}>
                {t("footer.skip")}
              </Button>
            )}
          </div>
          <div className="onboarding-footer-right">
            {isLast ? (
              <Button type="button" className="settings-primary-action" onPress={onFinish}>
                {t("footer.start")}
              </Button>
            ) : (
              <Button type="button" className="settings-primary-action" onPress={() => setStep((current) => current + 1)}>
                {t("footer.next")}
              </Button>
            )}
          </div>
        </footer>
      </div>
    </aside>
  );
}
