import { Button, Chip, Tabs } from "@heroui/react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { CharacterCardSettings } from "./CharacterCardSettings";
import { LanguageSelect } from "./LanguageSelect";
import { desktopBackend } from "./desktop-backend";
import { defaultAdvancedSettings, type AdvancedSettings } from "./advanced-settings-model";
import { formatUnknownError } from "./error-message";
import {
  buildMemoryDashboardViewModel,
  type MemoryDebugEvent,
  type MemoryRunSnapshot,
  type MemoryStatus
} from "./memory-status-model";
import {
  buildDraftModelProfile,
  buildInitialModelSettings,
  buildProfileFromPreset,
  detectPresetProvider,
  formatOpenAiCompatibleRequestPreview,
  getActiveModelProfile,
  getPresetProvidersByGroup,
  getTokenReadyModelProfiles,
  normalizeOpenAiCompatibleSettings,
  shouldMakeSavedProfileActive,
  type ModelSettingsState,
  type PresetProvider,
  type SavedModelProfile
} from "./model-settings-controller";
import { buildSettingsTabs } from "./settings-model";
import type { CharacterCard } from "./character-cards";
import type { CharacterPreference, CharacterPreferences } from "./character-preferences";
import { getCharacterState, listStoredMemories, type CharacterStates } from "./character-state";
import {
  buildToolPolicySettingsViewModel,
  defaultToolPolicySettings,
  toggleToolPolicyItem,
  type ToolId,
  type ToolPolicySettings,
  type ToolPolicyToggleGroup
} from "./tool-policy-model";
import {
  buildDefaultWebAccessSettings,
  buildWebAccessSettingsViewModel,
  type WebAccessProvider,
  type WebAccessProviderId,
  type WebAccessSettingsState,
  type WebAccessWorkflow
} from "./web-access-settings";

type SystemSettingsPanelProps = {
  activeCharacterId?: string;
  cards?: CharacterCard[];
  characterPreferences?: CharacterPreferences;
  characterStates?: CharacterStates;
  onCharacterPreferenceChange?: (characterId: string, patch: Partial<CharacterPreference>) => void;
  isOpen: boolean;
  latestMemoryRun?: MemoryRunSnapshot | null;
  memoryDebugEvents?: MemoryDebugEvent[];
  onClose: () => void;
  onModelSettingsChange?: (settings: ModelSettingsState) => void;
};

export function SystemSettingsPanel({ activeCharacterId = "shili", cards = [], characterPreferences = {}, characterStates = {}, onCharacterPreferenceChange, isOpen, latestMemoryRun, memoryDebugEvents = [], onClose, onModelSettingsChange }: SystemSettingsPanelProps) {
  const { t: tCommon } = useTranslation("common");
  const { t } = useTranslation("settings");
  const tabs = buildSettingsTabs();
  const modelProviderTab = tabs[0];
  const webAccessTab = tabs.find((tab) => tab.id === "web-access");
  const safetyTab = tabs.find((tab) => tab.id === "safety");
  const advancedTab = tabs.find((tab) => tab.id === "advanced");
  const [modelSettings, setModelSettings] = useState<ModelSettingsState>(buildInitialModelSettings);
  const [selectedProfileId, setSelectedProfileId] = useState(getActiveModelProfile(buildInitialModelSettings()).id);
  const [draftProfile, setDraftProfile] = useState<SavedModelProfile>(() => getActiveModelProfile(buildInitialModelSettings()));
  const [token, setToken] = useState("");
  const [selectedMemoryCharacterId, setSelectedMemoryCharacterId] = useState(activeCharacterId);
  const [memoryStatus, setMemoryStatus] = useState<MemoryStatus | null>(null);
  const [memoryStatusError, setMemoryStatusError] = useState("");
  const [toolPolicySettings, setToolPolicySettings] = useState<ToolPolicySettings>(defaultToolPolicySettings);
  const [toolPolicySaveState, setToolPolicySaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [toolPolicyError, setToolPolicyError] = useState("");
  const [webAccessSettings, setWebAccessSettings] = useState<WebAccessSettingsState>(buildDefaultWebAccessSettings);
  const [webAccessKeys, setWebAccessKeys] = useState<Record<WebAccessProviderId, string>>({ exa: "", perplexity: "", gemini: "" });
  const [webAccessSaveState, setWebAccessSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [webAccessError, setWebAccessError] = useState("");
  const [advancedSettings, setAdvancedSettings] = useState<AdvancedSettings>(defaultAdvancedSettings);
  const [advancedSaveState, setAdvancedSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [advancedError, setAdvancedError] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [testState, setTestState] = useState<"idle" | "testing" | "passed" | "error">("idle");
  const [testMessage, setTestMessage] = useState("");
  const [selectedPreset, setSelectedPreset] = useState<PresetProvider | null>(null);
  const [selectedModelSuggestion, setSelectedModelSuggestion] = useState("");
  const modelOperationIdRef = useRef(0);

  function selectDraftProfile(settings: ModelSettingsState, profileId: string) {
    return settings.profiles.find((profile) => profile.id === profileId)
      ?? getActiveModelProfile(settings)
      ?? buildDraftModelProfile(profileId);
  }

  function updateDraftProfile(patch: Partial<SavedModelProfile>) {
    modelOperationIdRef.current += 1;
    setDraftProfile((current) => ({ ...current, ...patch }));
    setSaveState("idle");
    setTestState("idle");
    setTestMessage("");
  }

  function updateToken(value: string) {
    modelOperationIdRef.current += 1;
    setToken(value);
    setSaveState("idle");
    setTestState("idle");
    setTestMessage("");
  }

  function syncPresetSelectionForProfile(profile: SavedModelProfile) {
    const preset = detectPresetProvider(profile) ?? null;
    const modelSuggestion = preset?.modelSuggestions.some((model) => model.value === profile.modelName)
      ? profile.modelName
      : "";

    setSelectedPreset(preset);
    setSelectedModelSuggestion(modelSuggestion);
  }

  useEffect(() => {
    if (!isOpen) {
      modelOperationIdRef.current += 1;
      return;
    }

    setSelectedMemoryCharacterId(activeCharacterId);

    const loadOperationId = modelOperationIdRef.current + 1;
    modelOperationIdRef.current = loadOperationId;

    desktopBackend.loadModelSettings().then((settings) => {
      if (modelOperationIdRef.current !== loadOperationId) {
        return;
      }

      const active = getActiveModelProfile(settings) ?? buildDraftModelProfile("default");

      setModelSettings(settings);
      setSelectedProfileId(active.id);
      setDraftProfile(active);
      syncPresetSelectionForProfile(active);
      setToken("");
      setSaveState("idle");
      onModelSettingsChange?.(settings);
      setTestState("idle");
      setTestMessage("");
    });

    desktopBackend.getMemoryStatus()
      .then((status) => {
        if (!isOpen) {
          return;
        }

        setMemoryStatus(status);
        setMemoryStatusError("");
      })
      .catch((error) => {
        if (!isOpen) {
          return;
        }

        setMemoryStatus(null);
        setMemoryStatusError(formatUnknownError(error, t("errors.memoryLoad")));
      });

    desktopBackend.getToolPolicySettings()
      .then((settings) => {
        if (!isOpen) {
          return;
        }

        setToolPolicySettings(settings);
        setToolPolicySaveState("idle");
        setToolPolicyError("");
      })
      .catch((error) => {
        if (!isOpen) {
          return;
        }

        setToolPolicySettings(defaultToolPolicySettings);
        setToolPolicyError(formatUnknownError(error, t("errors.toolPolicyLoad")));
      });

    desktopBackend.getWebAccessSettings()
      .then((settings) => {
        if (!isOpen) {
          return;
        }

        setWebAccessSettings(settings);
        setWebAccessKeys({ exa: "", perplexity: "", gemini: "" });
        setWebAccessSaveState("idle");
        setWebAccessError("");
      })
      .catch((error) => {
        if (!isOpen) {
          return;
        }

        setWebAccessSettings(buildDefaultWebAccessSettings());
        setWebAccessError(formatUnknownError(error, t("errors.webAccessLoad")));
      });

    desktopBackend.loadAdvancedSettings()
      .then((settings) => {
        if (!isOpen) {
          return;
        }

        setAdvancedSettings(settings);
        setAdvancedSaveState("idle");
        setAdvancedError("");
      })
      .catch((error) => {
        if (!isOpen) {
          return;
        }

        setAdvancedSettings(defaultAdvancedSettings);
        setAdvancedError(formatUnknownError(error, t("errors.advancedLoad")));
      });
  }, [activeCharacterId, isOpen, onModelSettingsChange]);

  if (!isOpen) {
    return null;
  }

  const activeProfile = getActiveModelProfile(modelSettings);
  const selectedSavedProfile = modelSettings.profiles.find((profile) => profile.id === selectedProfileId);
  const isUnsavedProfileDraft = !selectedSavedProfile;
  const normalizedDraft = normalizeOpenAiCompatibleSettings(draftProfile);
  const routePreview = formatOpenAiCompatibleRequestPreview(draftProfile);
  const memoryView = buildMemoryDashboardViewModel({
    debugEvents: memoryDebugEvents,
    status: memoryStatus,
    latestRun: latestMemoryRun,
    selectedCharacterId: selectedMemoryCharacterId,
    t
  });
  // 选中角色「真正长期记住的事」（来自角色状态里的印象），区别于上一轮临时召回的快照。
  const storedMemories = listStoredMemories(getCharacterState(characterStates, selectedMemoryCharacterId));
  const toolPolicyView = buildToolPolicySettingsViewModel(toolPolicySettings);
  const webAccessView = buildWebAccessSettingsViewModel(webAccessSettings);
  // 子代理要真正干活，至少得有一种写能力（写文件或跑命令）启用。默认全开，只有用户
  // 手动在「权限」里关掉时才会缺，这里据此给出内联提示，免得跨标签翻查。
  const subagentCanWork = Boolean(
    toolPolicySettings.builtinTools?.write ||
      toolPolicySettings.builtinTools?.edit ||
      toolPolicySettings.builtinTools?.bash
  );
  const didNormalizeBaseUrl = normalizedDraft.baseUrl !== draftProfile.baseUrl.trim().replace(/\/+$/, "");
  const canUseDraft = Boolean(draftProfile.baseUrl.trim() && draftProfile.modelName.trim() && (draftProfile.hasToken || token.trim()));
  const isModelActionBusy = saveState === "saving" || testState === "testing";
  const hasUnsavedModelDraft = selectedSavedProfile
    ? Boolean(token.trim())
      || selectedSavedProfile.name !== draftProfile.name
      || selectedSavedProfile.baseUrl !== draftProfile.baseUrl
      || selectedSavedProfile.modelName !== draftProfile.modelName
    : true;
  const canChangeModelProfile = !hasUnsavedModelDraft && !isModelActionBusy;
  const detectedPreset = detectPresetProvider(draftProfile);
  const tokenReadyProfiles = getTokenReadyModelProfiles(modelSettings);
  const tokenReadyProfileIds = new Set(tokenReadyProfiles.map((profile) => profile.id));
  const tokenPendingProfiles = modelSettings.profiles.filter((profile) => !tokenReadyProfileIds.has(profile.id));
  const officialPresetProviders = getPresetProvidersByGroup("official");
  const codingPlanProviders = getPresetProvidersByGroup("coding-plan");

  async function saveModelSettings(options: { makeActive?: boolean } = {}) {
    if (isModelActionBusy) {
      return;
    }

    const saveOperationId = modelOperationIdRef.current + 1;
    modelOperationIdRef.current = saveOperationId;
    setSaveState("saving");

    try {
      const settings = await desktopBackend.saveModelSettings({
        baseUrl: normalizedDraft.baseUrl,
        makeActive: options.makeActive,
        modelName: normalizedDraft.modelName,
        name: draftProfile.name,
        profileId: draftProfile.id,
        token: token.trim() || undefined
      });
      if (modelOperationIdRef.current !== saveOperationId) {
        setModelSettings(settings);
        onModelSettingsChange?.(settings);
        return;
      }

      const nextDraft = selectDraftProfile(settings, draftProfile.id);

      setModelSettings(settings);
      setSelectedProfileId(nextDraft.id);
      setDraftProfile(nextDraft);
      syncPresetSelectionForProfile(nextDraft);
      setToken("");
      setSaveState("saved");
      setTestState("idle");
      setTestMessage("");
      onModelSettingsChange?.(settings);
    } catch {
      if (modelOperationIdRef.current !== saveOperationId) {
        return;
      }

      setSaveState("error");
    }
  }

  async function deleteSelectedProfile() {
    if (isModelActionBusy) {
      return;
    }

    if (isUnsavedProfileDraft) {
      const nextDraft = getActiveModelProfile(modelSettings) ?? buildDraftModelProfile("default");

      modelOperationIdRef.current += 1;
      setSelectedProfileId(nextDraft.id);
      setDraftProfile(nextDraft);
      syncPresetSelectionForProfile(nextDraft);
      setToken("");
      setSaveState("idle");
      setTestState("idle");
      setTestMessage("");
      return;
    }

    const deleteOperationId = modelOperationIdRef.current + 1;
    modelOperationIdRef.current = deleteOperationId;
    setSaveState("saving");

    try {
      const settings = await desktopBackend.deleteModelProfile(draftProfile.id);
      if (modelOperationIdRef.current !== deleteOperationId) {
        setModelSettings(settings);
        onModelSettingsChange?.(settings);
        return;
      }

      const nextDraft = getActiveModelProfile(settings) ?? buildDraftModelProfile("default");

      setModelSettings(settings);
      setSelectedProfileId(nextDraft.id);
      setDraftProfile(nextDraft);
      syncPresetSelectionForProfile(nextDraft);
      setToken("");
      setSaveState("saved");
      setTestState("idle");
      setTestMessage("");
      onModelSettingsChange?.(settings);
    } catch {
      if (modelOperationIdRef.current !== deleteOperationId) {
        return;
      }

      setSaveState("error");
    }
  }

  function selectModelProfile(profileId: string) {
    if (!canChangeModelProfile || profileId === selectedProfileId) {
      return;
    }

    const profile = selectDraftProfile(modelSettings, profileId);

    modelOperationIdRef.current += 1;
    setSelectedProfileId(profile.id);
    setDraftProfile(profile);
    syncPresetSelectionForProfile(profile);
    setToken("");
    setSaveState("idle");
    setTestState("idle");
    setTestMessage("");
  }

  function savedProfileForPresetDraft(profileId: string) {
    return modelSettings.profiles.find((profile) => profile.id === profileId)
      ?? (draftProfile.id === profileId ? draftProfile : undefined);
  }

  function applyPresetSelection(preset: PresetProvider, modelValue = preset.modelSuggestions[0]?.value ?? "") {
    const currentPreset = detectPresetProvider(draftProfile);
    const profileId = currentPreset?.id === preset.id ? draftProfile.id : `${preset.id}-${Date.now()}`;
    const profile = buildProfileFromPreset(preset, modelValue, profileId, savedProfileForPresetDraft(profileId));

    setSelectedPreset(preset);
    setSelectedModelSuggestion(modelValue);
    modelOperationIdRef.current += 1;
    setSelectedProfileId(profile.id);
    setDraftProfile(profile);
    setToken("");
    setSaveState("idle");
    setTestState("idle");
    setTestMessage("");
  }

  function selectPreset(preset: PresetProvider) {
    if (!canChangeModelProfile) {
      return;
    }

    applyPresetSelection(preset);
  }

  function selectPresetModel(modelValue: string) {
    if (!selectedPreset) {
      return;
    }

    applyPresetSelection(selectedPreset, modelValue);
  }

  async function testModelConnection() {
    if (isModelActionBusy) {
      return;
    }

    const testOperationId = modelOperationIdRef.current + 1;
    modelOperationIdRef.current = testOperationId;
    setTestState("testing");
    setTestMessage("");

    try {
      const result = await desktopBackend.testModelConnection({
        baseUrl: normalizedDraft.baseUrl,
        name: draftProfile.name,
        modelName: normalizedDraft.modelName,
        profileId: draftProfile.id,
        token: token.trim() || undefined
      });
      if (modelOperationIdRef.current === testOperationId) {
        setTestState("passed");
        setTestMessage(t("model.testPassed", { text: result.text }));
      }
    } catch (error) {
      if (modelOperationIdRef.current === testOperationId) {
        setTestState("error");
        setTestMessage(formatUnknownError(error, t("model.testFailed")));
      }
    }
  }

  function toggleToolPolicy(group: ToolPolicyToggleGroup, toolId: ToolId) {
    setToolPolicySettings((settings) => toggleToolPolicyItem({ settings, group, toolId }));
    setToolPolicySaveState("idle");
  }

  async function saveToolPolicySettings() {
    setToolPolicySaveState("saving");

    try {
      const saved = await desktopBackend.saveToolPolicySettings(toolPolicySettings);
      setToolPolicySettings(saved);
      setToolPolicySaveState("saved");
      setToolPolicyError("");
    } catch (error) {
      setToolPolicySaveState("error");
      setToolPolicyError(formatUnknownError(error, t("errors.toolPolicySave")));
    }
  }

  // Advanced settings save on toggle (no separate save button) — the change is a
  // single boolean and takes effect on the next chat send.
  async function updateAdvancedSettings(patch: Partial<AdvancedSettings>) {
    const next = { ...advancedSettings, ...patch };
    setAdvancedSettings(next);
    setAdvancedSaveState("saving");

    try {
      const saved = await desktopBackend.saveAdvancedSettings(next);
      setAdvancedSettings(saved);
      setAdvancedSaveState("saved");
      setAdvancedError("");
    } catch (error) {
      setAdvancedSaveState("error");
      setAdvancedError(formatUnknownError(error, t("errors.advancedSave")));
    }
  }

  // 一键修复：直接在工具策略里开启写文件 + Shell 并保存，省去用户去「权限」标签翻找。
  async function enableSubagentWriteTools() {
    const next: ToolPolicySettings = {
      ...toolPolicySettings,
      builtinTools: {
        ...toolPolicySettings.builtinTools,
        edit: true,
        write: true,
        bash: true
      }
    };
    setToolPolicySettings(next);
    setToolPolicySaveState("saving");

    try {
      const saved = await desktopBackend.saveToolPolicySettings(next);
      setToolPolicySettings(saved);
      setToolPolicySaveState("saved");
      setToolPolicyError("");
    } catch (error) {
      setToolPolicySaveState("error");
      setToolPolicyError(formatUnknownError(error, t("errors.toolPolicySave")));
    }
  }

  function updateWebAccessSettings(patch: Partial<Pick<WebAccessSettingsState, "provider" | "workflow" | "noKeyFallback" | "allowBrowserCookies">>) {
    setWebAccessSettings((settings) => ({ ...settings, ...patch }));
    setWebAccessSaveState("idle");
    setWebAccessError("");
  }

  function updateWebAccessKey(provider: WebAccessProviderId, value: string) {
    setWebAccessKeys((keys) => ({ ...keys, [provider]: value }));
    setWebAccessSaveState("idle");
    setWebAccessError("");
  }

  async function saveWebAccessSettings() {
    setWebAccessSaveState("saving");

    try {
      const saved = await desktopBackend.saveWebAccessSettings({
        provider: webAccessSettings.provider,
        workflow: webAccessSettings.workflow,
        noKeyFallback: webAccessSettings.noKeyFallback,
        allowBrowserCookies: webAccessSettings.allowBrowserCookies,
        exaApiKey: webAccessKeys.exa,
        perplexityApiKey: webAccessKeys.perplexity,
        geminiApiKey: webAccessKeys.gemini
      });
      setWebAccessSettings(saved);
      setWebAccessKeys({ exa: "", perplexity: "", gemini: "" });
      setWebAccessSaveState("saved");
      setWebAccessError("");
    } catch (error) {
      setWebAccessSaveState("error");
      setWebAccessError(formatUnknownError(error, t("errors.webAccessSave")));
    }
  }

  function isToolEnabled(group: ToolPolicyToggleGroup, toolId: ToolId) {
    const groupSettings = toolPolicySettings[group] as Partial<Record<ToolId, boolean>>;
    return groupSettings[toolId] === true;
  }

  function renderToolGroup(group: ToolPolicyToggleGroup, title: string, tools: typeof toolPolicyView.toolOrder) {
    return (
      <div className="tool-policy-group">
        <h5>{title}</h5>
        <div className="tool-policy-toggle-grid">
          {tools.map((tool) => (
            <label className="tool-policy-toggle" key={`${group}-${tool.id}`}>
              <input checked={isToolEnabled(group, tool.id)} onChange={() => toggleToolPolicy(group, tool.id)} type="checkbox" />
              <span>
                <strong>{t(`tools.${tool.id}.label`)}</strong>
                <small>{t(`tools.${tool.id}.desc`)}</small>
              </span>
            </label>
          ))}
        </div>
      </div>
    );
  }

  function renderProfileSourceButton(profile: SavedModelProfile, tokenReady: boolean) {
    const profilePreset = detectPresetProvider(profile);
    const disabled = isModelActionBusy || (hasUnsavedModelDraft && selectedProfileId !== profile.id);

    return (
      <button
        className={`model-source-item ${selectedProfileId === profile.id ? "selected" : ""}`}
        disabled={disabled}
        key={profile.id}
        onClick={() => selectModelProfile(profile.id)}
        type="button"
      >
        {profilePreset ? (
          <span className="model-profile-icon" style={{ background: profilePreset.accentColor }}>
            {profilePreset.iconLabel}
          </span>
        ) : (
          <span className="model-profile-icon custom">
            {profile.name.charAt(0).toUpperCase()}
          </span>
        )}
        <span className="model-source-item-copy">
          <strong>{profile.name}</strong>
          <small>{profile.modelName || t("model.noModelName")}</small>
          <span className={`token-status ${tokenReady ? "has-token" : ""}`}>
            {tokenReady ? t("model.tokenWith", { hint: profile.tokenHint ?? t("model.tokenSaved") }) : t("model.needToken")}
          </span>
        </span>
        {modelSettings.activeModelId === profile.id ? (
          <Chip className="provider-status model-source-current" size="sm" variant="soft">{t("model.currentBadge")}</Chip>
        ) : null}
      </button>
    );
  }

  function renderPresetSourceButton(preset: PresetProvider) {
    return (
      <button
        className={`model-source-item preset ${preset.group === "coding-plan" ? "coding-plan" : ""} ${selectedPreset?.id === preset.id ? "selected" : ""}`}
        disabled={!canChangeModelProfile}
        key={preset.id}
        onClick={() => selectPreset(preset)}
        type="button"
      >
        <span className="model-profile-icon" style={{ background: preset.accentColor }}>
          {preset.iconLabel}
        </span>
        <span className="model-source-item-copy">
          <strong>{preset.name}</strong>
          <small>{preset.description}</small>
        </span>
      </button>
    );
  }

  function renderWebAccessProviderButton(provider: WebAccessProvider, label: string, description: string) {
    return (
      <button
        className={`web-provider-card ${webAccessSettings.provider === provider ? "selected" : ""}`}
        key={provider}
        onClick={() => updateWebAccessSettings({ provider })}
        type="button"
      >
        <strong>{label}</strong>
        <small>{description}</small>
      </button>
    );
  }

  function renderWebWorkflowButton(workflow: WebAccessWorkflow, label: string) {
    return (
      <button
        className={`segmented-option ${webAccessSettings.workflow === workflow ? "selected" : ""}`}
        key={workflow}
        onClick={() => updateWebAccessSettings({ workflow })}
        type="button"
      >
        {label}
      </button>
    );
  }

  return (
    <aside className="system-settings-panel" aria-label={t("panelAria")}>
      <div className="settings-page-inner">
      <div className="settings-panel-header">
        <Button aria-label={tCommon("nav.backToMain")} className="settings-back" isDisabled={isModelActionBusy} onPress={onClose} type="button">
          <span className="settings-back-arrow" aria-hidden="true">←</span>
          {tCommon("nav.back")}
        </Button>
        <div className="settings-header-titles">
          <span>{t("eyebrow")}</span>
          <h2>{t("title")}</h2>
        </div>
      </div>

      <section className="settings-language-row">
        <LanguageSelect variant="dropdown" />
        <p className="settings-language-hint">{tCommon("language.settingsHint")}</p>
      </section>

      <Tabs className="settings-tabs" defaultSelectedKey={modelProviderTab.id}>
        <Tabs.List className="settings-tab-list">
          {tabs.map((tab) => (
            <Tabs.Tab className="settings-tab" id={tab.id} key={tab.id}>
              {t(`tabs.${tab.id}.label`)}
            </Tabs.Tab>
          ))}
        </Tabs.List>

        <Tabs.Panel className="settings-tab-panel" id="model-provider">
          <section>
            <header className="settings-section-header">
              <div>
                <h3>{t("tabs.model-provider.label")}</h3>
                <p>{t("tabs.model-provider.desc")}</p>
              </div>
              <Chip className="provider-status" size="sm" variant="soft">
                {activeProfile ? t("model.statusCurrent", { name: activeProfile.name }) : t("model.noModelSelected")}
              </Chip>
            </header>

            <div className="model-access-layout">
              <div className="model-config-detail">
                {selectedPreset ? (
                  <div className="preset-quick-setup">
                    <div className="preset-quick-setup-header">
                      <span className="preset-provider-icon small" style={{ background: selectedPreset.accentColor }}>
                        {selectedPreset.iconLabel}
                      </span>
                      <div>
                        <strong>{selectedPreset.name}</strong>
                        <p>{selectedPreset.description}</p>
                      </div>
                    </div>
                    {selectedPreset.modelSuggestions.length > 0 ? (
                      <div className="preset-model-suggestions">
                        <span>{t("model.selectModel")}</span>
                        <div className="preset-model-chips">
                          {selectedPreset.modelSuggestions.map((model) => (
                            <button
                              className={`preset-model-chip ${selectedModelSuggestion === model.value ? "selected" : ""}`}
                              disabled={isModelActionBusy}
                              key={model.value}
                              onClick={() => selectPresetModel(model.value)}
                              type="button"
                            >
                              {model.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="openai-compatible-form">
                  <div className="form-section-header">
                    <h4>{t("model.configDetail")}</h4>
                    {detectedPreset ? (
                      <Chip className="provider-status" size="sm" variant="soft">
                        {detectedPreset.name}
                      </Chip>
                    ) : null}
                  </div>

                  <label className="settings-input">
                    <span>{t("model.configName")}</span>
                    <input
                      aria-label={t("model.configNameAria")}
                      disabled={isModelActionBusy}
                      onChange={(event) => updateDraftProfile({ name: event.target.value })}
                      placeholder={t("model.configNamePlaceholder")}
                      value={draftProfile.name}
                    />
                  </label>
                  <label className="settings-input">
                    <span>Base URL</span>
                    <input
                      aria-label={t("model.baseUrlAria")}
                      disabled={isModelActionBusy}
                      onChange={(event) => updateDraftProfile({ baseUrl: event.target.value })}
                      placeholder="https://api.openai.com/v1"
                      value={draftProfile.baseUrl}
                    />
                  </label>
                  <label className="settings-input">
                    <span>API Key / Token</span>
                    <div className="token-input-row">
                      <input
                        aria-label={t("model.tokenAria")}
                        disabled={isModelActionBusy}
                        onChange={(event) => updateToken(event.target.value)}
                        placeholder={draftProfile.hasToken ? t("model.tokenKeepPlaceholder") : (detectedPreset?.tokenPlaceholder ?? "sk-...")}
                        type="password"
                        value={token}
                      />
                      {draftProfile.hasToken ? (
                        <span className="token-saved-badge">{t("model.tokenSaved")}</span>
                      ) : null}
                    </div>
                  </label>
                  <label className="settings-input">
                    <span>{t("model.modelNameLabel")}</span>
                    <input
                      aria-label={t("model.modelNameAria")}
                      disabled={isModelActionBusy}
                      onChange={(event) => updateDraftProfile({ modelName: event.target.value })}
                      placeholder="gpt-4o / glm-4-plus / qwen-max"
                      value={draftProfile.modelName}
                    />
                  </label>

                  <div className="provider-route-row">
                    <code className="provider-route">{routePreview}</code>
                  </div>

                  <div className="provider-actions">
                    <Button
                      className="settings-secondary-action"
                      isDisabled={!canUseDraft || isModelActionBusy}
                      onPress={testModelConnection}
                      type="button"
                    >
                      {testState === "testing" ? t("model.testing") : t("model.testConnection")}
                    </Button>
                    <Button
                      className="settings-secondary-action"
                      isDisabled={!canUseDraft || isModelActionBusy || modelSettings.activeModelId === draftProfile.id}
                      onPress={() => saveModelSettings({ makeActive: true })}
                      type="button"
                    >
                      {t("model.setCurrent")}
                    </Button>
                    <Button
                      className="settings-primary-action"
                      isDisabled={!canUseDraft || isModelActionBusy}
                      onPress={() => saveModelSettings({ makeActive: shouldMakeSavedProfileActive(modelSettings, draftProfile) })}
                      type="button"
                    >
                      {saveState === "saving" ? t("model.saving") : t("model.saveConfig")}
                    </Button>
                  </div>
                  <div className="provider-actions secondary">
                    <Button
                      className="settings-secondary-action danger"
                      isDisabled={isModelActionBusy || (!isUnsavedProfileDraft && modelSettings.profiles.length <= 1)}
                      onPress={deleteSelectedProfile}
                      type="button"
                    >
                      {isUnsavedProfileDraft ? t("model.discardNew") : t("model.deleteConfig")}
                    </Button>
                  </div>

                  {saveState === "saved" ? <p className="settings-save-note">{t("model.savedNote")}</p> : null}
                  {saveState === "error" ? <p className="settings-save-note error">{t("model.saveFailed")}</p> : null}
                  {testState === "passed" ? <p className="settings-save-note">{testMessage}</p> : null}
                  {testState === "error" ? <p className="settings-save-note error">{testMessage}</p> : null}
                  {hasUnsavedModelDraft && !isModelActionBusy ? (
                    <p className="settings-save-note">
                      {isUnsavedProfileDraft ? t("model.unsavedNew") : t("model.unsaved")}
                    </p>
                  ) : null}
                  {didNormalizeBaseUrl ? (
                    <p className="settings-save-note">
                      {t("model.baseUrlNormalized", { url: normalizedDraft.baseUrl })}
                    </p>
                  ) : null}
                </div>
              </div>

              <aside className="model-source-sidebar" aria-label={t("model.sidebarAria")}>
                <div className="model-source-section">
                  <div className="model-source-section-title">
                    <h4>{t("model.availableConfigs")}</h4>
                    <span>{tokenReadyProfiles.length}</span>
                  </div>
                  <div className="model-source-list">
                    {tokenReadyProfiles.length > 0 ? (
                      tokenReadyProfiles.map((profile) => renderProfileSourceButton(profile, true))
                    ) : (
                      <p className="model-source-empty">{t("model.noSavedToken")}</p>
                    )}
                  </div>
                </div>

                {tokenPendingProfiles.length > 0 ? (
                  <div className="model-source-section compact">
                    <div className="model-source-section-title">
                      <h4>{t("model.pendingConfigs")}</h4>
                      <span>{tokenPendingProfiles.length}</span>
                    </div>
                    <div className="model-source-list">
                      {tokenPendingProfiles.map((profile) => renderProfileSourceButton(profile, false))}
                    </div>
                  </div>
                ) : null}

                <div className="model-source-section">
                  <div className="model-source-section-title">
                    <h4>{t("model.officialApi")}</h4>
                  </div>
                  <div className="model-source-list">
                    {officialPresetProviders.map(renderPresetSourceButton)}
                  </div>
                </div>

                <div className="model-source-section">
                  <div className="model-source-section-title">
                    <h4>Coding Plan</h4>
                  </div>
                  <div className="model-source-list">
                    {codingPlanProviders.map(renderPresetSourceButton)}
                  </div>
                </div>
              </aside>
            </div>
          </section>
        </Tabs.Panel>

        <Tabs.Panel className="settings-tab-panel" id="character-card">
          <CharacterCardSettings
            activeCharacterId={activeCharacterId}
            cards={cards}
            preferences={characterPreferences}
            states={characterStates}
            onPreferenceChange={onCharacterPreferenceChange}
          />
        </Tabs.Panel>

        <Tabs.Panel className="settings-tab-panel" id="memory">
          <section>
            <header className="settings-section-header">
              <div>
                <h3>{t("tabs.memory.label")}</h3>
                <p>{t("tabs.memory.desc")}</p>
              </div>
              <Chip className="provider-status" size="sm" variant="soft">
                {memoryView.latestSourceLabel}
              </Chip>
            </header>

            <div className="memory-dashboard">
              <div className="memory-summary-grid">
                <div className="memory-summary-item">
                  <span>{t("memory.backendField")}</span>
                  <strong>{memoryView.backendLabel}</strong>
                </div>
                <div className="memory-summary-item">
                  <span>{t("memory.thisRoundField")}</span>
                  <strong>{memoryView.latestSourceLabel}</strong>
                </div>
              <div className="memory-summary-item">
                  <span>{t("memory.visibleSuffix", { label: memoryView.selectedCharacterLabel })}</span>
                  <strong>{memoryView.recalledCount}/{memoryView.totalRecalledCount}</strong>
                </div>
              </div>

              {memoryStatusError ? <p className="settings-save-note error">{memoryStatusError}</p> : null}

              <div className="memory-character-switcher" aria-label={t("memory.switcherAria")}>
                {cards.map((character) => (
                  <button
                    className={`memory-character-button ${character.id === selectedMemoryCharacterId ? "selected" : ""}`}
                    key={character.id}
                    onClick={() => setSelectedMemoryCharacterId(character.id)}
                    type="button"
                  >
                    <img alt="" aria-hidden="true" src={character.assets.avatar} />
                    <span>{character.name}</span>
                  </button>
                ))}
              </div>

              <dl className="memory-storage-list">
                {memoryView.storageRows.map((row) => (
                  <div className="memory-storage-row" key={row.label}>
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>

              <div className="memory-recall-list">
                <h4>{t("memory.longTermTitle", { label: memoryView.selectedCharacterLabel })} {storedMemories.length > 0 ? `· ${storedMemories.length}` : ""}</h4>
                {storedMemories.length > 0 ? (
                  storedMemories.map((memory) => (
                    <article className="memory-recall-item" key={memory.id}>
                      <div>
                        <span>{memory.kindLabel}</span>
                      </div>
                      <p>{memory.text}</p>
                    </article>
                  ))
                ) : (
                  <p className="memory-empty-state">{t("memory.longTermEmpty", { label: memoryView.selectedCharacterLabel })}</p>
                )}
              </div>

              <div className="memory-recall-list">
                <h4>{t("memory.recalledTitle")} {memoryView.totalRecalledCount > 0 ? `· ${memoryView.recalledCount}/${memoryView.totalRecalledCount}` : ""}</h4>
                {memoryView.memories.length > 0 ? (
                  memoryView.memories.map((memory) => (
                    <article className="memory-recall-item" key={memory.id}>
                      <div>
                        <span>{memory.kindLabel}</span>
                        <small>{memory.ownerLabel} · {memory.sourceLabel}</small>
                      </div>
                      <p>{memory.text}</p>
                    </article>
                  ))
                ) : (
                  <p className="memory-empty-state">{t("memory.recalledEmpty")}</p>
                )}
              </div>

              <div className="memory-debug-log">
                <h4>{t("memory.debugTitle")}</h4>
                {memoryView.debugEvents.length > 0 ? (
                  <ol>
                    {memoryView.debugEvents.map((event) => (
                      <li className={`memory-debug-item ${event.kind}`} key={event.id}>
                        <time>{event.timeLabel}</time>
                        <span>{event.sourceLabel}</span>
                        <p>{event.summary}</p>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="memory-empty-state">{t("memory.debugEmpty")}</p>
                )}
              </div>
            </div>
          </section>
        </Tabs.Panel>

        {webAccessTab ? (
          <Tabs.Panel className="settings-tab-panel" id={webAccessTab.id}>
            <section>
              <header className="settings-section-header">
                <div>
                  <h3>{t("tabs.web-access.label")}</h3>
                  <p>{t("tabs.web-access.desc")}</p>
                </div>
                <div className="settings-header-actions">
                  <Chip className="provider-status" size="sm" variant="soft">
                    {webAccessView.effectiveProviderLabel}
                  </Chip>
                  <Button
                    className="settings-primary-action"
                    isDisabled={webAccessSaveState === "saving"}
                    onPress={saveWebAccessSettings}
                    type="button"
                  >
                    {webAccessSaveState === "saving" ? t("web.saving") : t("web.save")}
                  </Button>
                </div>
              </header>

              <div className="web-access-dashboard">
                <div className="web-provider-grid" aria-label={t("web.providerGridAria")}>
                  {renderWebAccessProviderButton("auto", "Auto", t("web.providerDesc.auto"))}
                  {renderWebAccessProviderButton("exa", "Exa", t("web.providerDesc.exa"))}
                  {renderWebAccessProviderButton("perplexity", "Perplexity", t("web.providerDesc.perplexity"))}
                  {renderWebAccessProviderButton("gemini", "Gemini", t("web.providerDesc.gemini"))}
                </div>

                <div className="web-access-main">
                  <div className="web-access-form">
                    <div className="form-section-header">
                      <h4>{t("web.runMode")}</h4>
                      <Chip className="provider-status" size="sm" variant="soft">
                        {t(`web.workflow.${webAccessSettings.workflow === "summary-review" ? "summaryReview" : "none"}`)}
                      </Chip>
                    </div>

                    <div className="settings-segmented" aria-label={t("web.workflowAria")}>
                      {renderWebWorkflowButton("none", t("web.workflow.none"))}
                      {renderWebWorkflowButton("summary-review", t("web.workflow.summaryReview"))}
                    </div>

                    <label className="tool-policy-toggle web-access-switch">
                      <input
                        checked={webAccessSettings.noKeyFallback}
                        onChange={(event) => updateWebAccessSettings({ noKeyFallback: event.target.checked })}
                        type="checkbox"
                      />
                      <span>
                        <strong>{t("web.noKeyFallback")}</strong>
                        <small>{webAccessView.willFallbackWithoutKey ? t("web.willFallback") : t("web.canFallback")}</small>
                      </span>
                    </label>

                    <label className="tool-policy-toggle web-access-switch">
                      <input
                        checked={webAccessSettings.allowBrowserCookies}
                        onChange={(event) => updateWebAccessSettings({ allowBrowserCookies: event.target.checked })}
                        type="checkbox"
                      />
                      <span>
                        <strong>{t("web.allowGeminiBrowser")}</strong>
                        <small>{t("web.allowGeminiBrowserDesc")}</small>
                      </span>
                    </label>

                    {webAccessError ? <p className="settings-save-note error">{webAccessError}</p> : null}
                    {webAccessSaveState === "saved" ? <p className="settings-save-note">{t("web.savedNote")}</p> : null}
                    {webAccessSaveState === "error" ? <p className="settings-save-note error">{t("web.saveFailed")}</p> : null}
                  </div>

                  <div className="web-key-form">
                    <div className="form-section-header">
                      <h4>API Keys</h4>
                      <Chip className="provider-status" size="sm" variant="soft">
                        {webAccessView.keyRows.filter((row) => row.hasKey).length}/3
                      </Chip>
                    </div>

                    {webAccessView.keyRows.map((row) => (
                      <label className="settings-input web-key-input" key={row.id}>
                        <span>{row.label}</span>
                        <div className="token-input-row">
                          <input
                            aria-label={`${row.label} API Key`}
                            onChange={(event) => updateWebAccessKey(row.id, event.target.value)}
                            placeholder={row.hasKey ? t("web.keyKeepPlaceholder", { status: row.status }) : row.placeholder}
                            type="password"
                            value={webAccessKeys[row.id]}
                          />
                          {row.hasKey ? <span className="token-saved-badge">{t("web.keySaved")}</span> : null}
                        </div>
                        <small>{t(`web.keyDesc.${row.id}`)}</small>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </Tabs.Panel>
        ) : null}

        {safetyTab ? (
          <Tabs.Panel className="settings-tab-panel" id={safetyTab.id}>
            <section>
              <header className="settings-section-header">
                <div>
                  <h3>{t("tabs.safety.label")}</h3>
                  <p>{t("tabs.safety.desc")}</p>
                </div>
                <Button
                  className="settings-primary-action"
                  isDisabled={toolPolicySaveState === "saving"}
                  onPress={saveToolPolicySettings}
                  type="button"
                >
                  {toolPolicySaveState === "saving" ? t("safety.saving") : t("safety.save")}
                </Button>
              </header>

              <div className="tool-policy-dashboard">
                <div className="tool-policy-protected">
                  <span>{t("safety.protectedPaths")}</span>
                  <code>{toolPolicyView.protectedPathsPreview}</code>
                </div>

                {toolPolicyError ? <p className="settings-save-note error">{toolPolicyError}</p> : null}
                {toolPolicySaveState === "saved" ? <p className="settings-save-note">{t("safety.savedNote")}</p> : null}
                {toolPolicySaveState === "error" ? <p className="settings-save-note error">{t("safety.saveFailed")}</p> : null}

                <article className="tool-policy-mode-card">
                  <header>
                    <div>
                      <h4>{t("safety.globalTitle")}</h4>
                      <p>{t("safety.globalDesc")}</p>
                    </div>
                    <Chip className="provider-status" size="sm" variant="soft">
                      {t("safety.enabledCount", { count: toolPolicyView.enabledTools.length })}
                    </Chip>
                  </header>

                  {renderToolGroup("builtinTools", t("safety.groupBuiltin"), toolPolicyView.toolOrder.filter((tool) => !tool.id.includes(".")))}
                  {renderToolGroup("customTools", t("safety.groupCustom"), toolPolicyView.toolOrder.filter((tool) => tool.id.includes(".")))}
                  {renderToolGroup("confirmTools", t("safety.groupConfirm"), toolPolicyView.toolOrder)}
                </article>
              </div>
            </section>
          </Tabs.Panel>
        ) : null}

        {advancedTab ? (
          <Tabs.Panel className="settings-tab-panel" id={advancedTab.id}>
            <section>
              <header className="settings-section-header">
                <div>
                  <h3>{t("tabs.advanced.label")}</h3>
                  <p>{t("tabs.advanced.desc")}</p>
                </div>
              </header>

              <article className="tool-policy-mode-card">
                <header>
                  <div>
                    <h4>{t("advanced.subagentTitle")}</h4>
                    <p>{t("advanced.subagentDesc")}</p>
                  </div>
                  <Chip className="provider-status" size="sm" variant="soft">
                    {advancedSettings.enableSubagents ? t("advanced.on") : t("advanced.off")}
                  </Chip>
                </header>

                <label className="tool-policy-toggle web-access-switch">
                  <input
                    checked={advancedSettings.enableSubagents}
                    onChange={(event) => updateAdvancedSettings({ enableSubagents: event.target.checked })}
                    type="checkbox"
                  />
                  <span>
                    <strong>{t("advanced.enableSubagents")}</strong>
                    <small>{t("advanced.enableSubagentsDesc")}</small>
                  </span>
                </label>

                <p className="settings-save-note">
                  {t("advanced.subagentHint")}
                </p>
                {advancedSettings.enableSubagents && !subagentCanWork ? (
                  <div className="settings-inline-fix">
                    <p className="settings-save-note error">
                      {t("advanced.subagentBlocked")}
                    </p>
                    <Button
                      className="settings-secondary-action"
                      isDisabled={toolPolicySaveState === "saving"}
                      onPress={enableSubagentWriteTools}
                      type="button"
                    >
                      {toolPolicySaveState === "saving" ? t("advanced.enabling") : t("advanced.enableWriteShell")}
                    </Button>
                  </div>
                ) : null}
                {advancedError ? <p className="settings-save-note error">{advancedError}</p> : null}
                {advancedSaveState === "saved" ? <p className="settings-save-note">{t("advanced.savedNote")}</p> : null}
                {advancedSaveState === "error" ? <p className="settings-save-note error">{t("advanced.saveFailed")}</p> : null}
              </article>
            </section>
          </Tabs.Panel>
        ) : null}
      </Tabs>
      </div>
    </aside>
  );
}
