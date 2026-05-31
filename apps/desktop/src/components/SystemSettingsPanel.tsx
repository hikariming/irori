import { Button, Chip, Tabs } from "@heroui/react";
import { useEffect, useRef, useState } from "react";

import { CharacterCardSettings } from "./CharacterCardSettings";
import { desktopBackend } from "./desktop-backend";
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
  normalizeOpenAiCompatibleSettings,
  presetProviders,
  shouldMakeSavedProfileActive,
  type ModelSettingsState,
  type PresetProvider,
  type SavedModelProfile
} from "./model-settings-controller";
import { buildSettingsTabs } from "./settings-model";
import type { CharacterCard } from "./character-cards";
import type { CharacterPreference, CharacterPreferences } from "./character-preferences";
import type { CharacterStates } from "./character-state";
import {
  buildToolPolicySettingsViewModel,
  defaultToolPolicySettings,
  toggleToolPolicyItem,
  type ToolId,
  type ToolPolicySettings,
  type ToolPolicyToggleGroup
} from "./tool-policy-model";

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
  const tabs = buildSettingsTabs();
  const modelProviderTab = tabs[0];
  const memoryTab = tabs.find((tab) => tab.id === "memory");
  const safetyTab = tabs.find((tab) => tab.id === "safety");
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
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [testState, setTestState] = useState<"idle" | "testing" | "passed" | "error">("idle");
  const [testMessage, setTestMessage] = useState("");
  const [showPresetPicker, setShowPresetPicker] = useState(false);
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
        setMemoryStatusError(formatUnknownError(error, "记忆状态加载失败。"));
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
        setToolPolicyError(formatUnknownError(error, "权限设置加载失败。"));
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
    selectedCharacterId: selectedMemoryCharacterId
  });
  const toolPolicyView = buildToolPolicySettingsViewModel(toolPolicySettings);
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

  function addModelProfile() {
    if (!canChangeModelProfile) {
      return;
    }

    const id = `profile-${Date.now()}`;
    const draft = buildDraftModelProfile(id);

    modelOperationIdRef.current += 1;
    setSelectedProfileId(id);
    setDraftProfile(draft);
    syncPresetSelectionForProfile(draft);
    setToken("");
    setSaveState("idle");
    setTestState("idle");
    setTestMessage("");
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

  function openPresetPicker() {
    if (!canChangeModelProfile) {
      return;
    }

    setSelectedPreset(null);
    setSelectedModelSuggestion("");
    setShowPresetPicker(true);
  }

  function closePresetPicker() {
    setShowPresetPicker(false);
    setSelectedPreset(null);
    setSelectedModelSuggestion("");
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
    applyPresetSelection(preset);
  }

  function selectPresetModel(modelValue: string) {
    if (!selectedPreset) {
      return;
    }

    applyPresetSelection(selectedPreset, modelValue);
  }

  function confirmPresetSelection() {
    if (!selectedPreset) {
      return;
    }

    const profile = buildProfileFromPreset(
      selectedPreset,
      selectedModelSuggestion || undefined,
      draftProfile.id,
      savedProfileForPresetDraft(draftProfile.id)
    );

    modelOperationIdRef.current += 1;
    setSelectedProfileId(profile.id);
    setDraftProfile(profile);
    setToken("");
    setSaveState("idle");
    setTestState("idle");
    setTestMessage("");
    if (showPresetPicker) {
      closePresetPicker();
    }
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
        setTestMessage(`模型测试通过：${result.text}`);
      }
    } catch (error) {
      if (modelOperationIdRef.current === testOperationId) {
        setTestState("error");
        setTestMessage(formatUnknownError(error, "模型测试失败。"));
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
      setToolPolicyError(formatUnknownError(error, "权限设置保存失败。"));
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
                <strong>{tool.label}</strong>
                <small>{tool.description}</small>
              </span>
            </label>
          ))}
        </div>
      </div>
    );
  }

  return (
    <aside className="system-settings-panel" aria-label="系统设置">
      <div className="settings-page-inner">
      <div className="settings-panel-header">
        <Button aria-label="返回主界面" className="settings-back" isDisabled={isModelActionBusy} onPress={onClose} type="button">
          <span className="settings-back-arrow" aria-hidden="true">←</span>
          返回
        </Button>
        <div className="settings-header-titles">
          <span>系统设置</span>
          <h2>角色与本地模型</h2>
        </div>
      </div>

      <Tabs className="settings-tabs" defaultSelectedKey={modelProviderTab.id}>
        <Tabs.List className="settings-tab-list">
          {tabs.map((tab) => (
            <Tabs.Tab className="settings-tab" id={tab.id} key={tab.id}>
              {tab.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>

        <Tabs.Panel className="settings-tab-panel" id="model-provider">
          <section>
            <header className="settings-section-header">
              <div>
                <h3>{modelProviderTab.label}</h3>
                <p>{modelProviderTab.description}</p>
              </div>
              <Chip className="provider-status" size="sm" variant="soft">
                {activeProfile ? `当前：${activeProfile.name}` : "未选择模型"}
              </Chip>
            </header>

            <div className="preset-provider-section">
              <h4>官方 API 直连</h4>
              <div className="preset-provider-grid">
                {presetProviders.filter((p) => p.group === "official").map((preset) => (
                  <button
                    className={`preset-provider-card ${selectedPreset?.id === preset.id ? "selected" : ""}`}
                    disabled={isModelActionBusy}
                    key={preset.id}
                    onClick={() => selectPreset(preset)}
                    type="button"
                  >
                    <span className="preset-provider-icon" style={{ background: preset.accentColor }}>
                      {preset.iconLabel}
                    </span>
                    <span className="preset-provider-name">{preset.name}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="preset-provider-section">
              <h4>编码套餐 Coding Plan</h4>
              <div className="preset-provider-grid">
                {presetProviders.filter((p) => p.group === "coding-plan").map((preset) => (
                  <button
                    className={`preset-provider-card coding-plan ${selectedPreset?.id === preset.id ? "selected" : ""}`}
                    disabled={isModelActionBusy}
                    key={preset.id}
                    onClick={() => selectPreset(preset)}
                    type="button"
                  >
                    <span className="preset-provider-icon" style={{ background: preset.accentColor }}>
                      {preset.iconLabel}
                    </span>
                    <span className="preset-provider-name">{preset.name}</span>
                  </button>
                ))}
              </div>
            </div>

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
                    <span>推荐模型</span>
                    <div className="preset-model-chips">
                      {selectedPreset.modelSuggestions.map((model) => (
                        <button
                          className={`preset-model-chip ${selectedModelSuggestion === model.value ? "selected" : ""}`}
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
                <div className="preset-quick-setup-actions">
                  <Button className="settings-secondary-action" onPress={confirmPresetSelection} type="button">
                    使用此配置
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="model-profile-layout">
              <div className="model-profile-list" aria-label="模型配置档案">
                <h4 className="profile-list-title">已保存配置</h4>
                {modelSettings.profiles.map((profile) => {
                  const profilePreset = detectPresetProvider(profile);
                  return (
                    <button
                      className={`model-profile-item ${selectedProfileId === profile.id ? "selected" : ""}`}
                      disabled={isModelActionBusy || (hasUnsavedModelDraft && selectedProfileId !== profile.id)}
                      key={profile.id}
                      onClick={() => selectModelProfile(profile.id)}
                      type="button"
                    >
                      <div className="model-profile-item-header">
                        {profilePreset ? (
                          <span className="model-profile-icon" style={{ background: profilePreset.accentColor }}>
                            {profilePreset.iconLabel}
                          </span>
                        ) : (
                          <span className="model-profile-icon custom">
                            {profile.name.charAt(0).toUpperCase()}
                          </span>
                        )}
                        <div className="model-profile-item-info">
                          <span>{profile.name}</span>
                          <small>{profile.modelName || "未填写模型名"}</small>
                        </div>
                        {modelSettings.activeModelId === profile.id ? (
                          <Chip className="provider-status" size="sm" variant="soft">当前</Chip>
                        ) : null}
                      </div>
                      <div className="model-profile-item-meta">
                        <span className={`token-status ${profile.hasToken ? "has-token" : ""}`}>
                          {profile.hasToken ? `🔑 ${profile.tokenHint ?? "已保存"}` : "⚠️ 未配置 Token"}
                        </span>
                      </div>
                    </button>
                  );
                })}
                <Button className="settings-secondary-action add-profile-button" isDisabled={!canChangeModelProfile} onPress={openPresetPicker} type="button">
                  + 新增模型
                </Button>
              </div>

              <div className="openai-compatible-form">
                <div className="form-section-header">
                  <h4>配置详情</h4>
                  {detectedPreset ? (
                    <Chip className="provider-status" size="sm" variant="soft">
                      {detectedPreset.name}
                    </Chip>
                  ) : null}
                </div>

                <label className="settings-input">
                  <span>配置名称</span>
                  <input
                    aria-label="模型配置名称"
                    disabled={isModelActionBusy}
                    onChange={(event) => updateDraftProfile({ name: event.target.value })}
                    placeholder="例如：OpenAI GPT-4o / 智谱 GLM-4"
                    value={draftProfile.name}
                  />
                </label>
                <label className="settings-input">
                  <span>Base URL</span>
                  <input
                    aria-label="OpenAI 兼容接口 Base URL"
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
                      aria-label="OpenAI 兼容接口 Token"
                      disabled={isModelActionBusy}
                      onChange={(event) => updateToken(event.target.value)}
                      placeholder={draftProfile.hasToken ? "留空则继续使用已保存 Token" : (detectedPreset?.tokenPlaceholder ?? "sk-...")}
                      type="password"
                      value={token}
                    />
                    {draftProfile.hasToken ? (
                      <span className="token-saved-badge">✓ 已保存</span>
                    ) : null}
                  </div>
                </label>
                <label className="settings-input">
                  <span>模型名</span>
                  <input
                    aria-label="OpenAI 兼容接口模型名"
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
                    {testState === "testing" ? "测试中…" : "测试连接"}
                  </Button>
                  <Button
                    className="settings-secondary-action"
                    isDisabled={!canUseDraft || isModelActionBusy || modelSettings.activeModelId === draftProfile.id}
                    onPress={() => saveModelSettings({ makeActive: true })}
                    type="button"
                  >
                    设为当前
                  </Button>
                  <Button
                    className="settings-primary-action"
                    isDisabled={!canUseDraft || isModelActionBusy}
                    onPress={() => saveModelSettings({ makeActive: shouldMakeSavedProfileActive(modelSettings, draftProfile) })}
                    type="button"
                  >
                    {saveState === "saving" ? "保存中…" : "保存配置"}
                  </Button>
                </div>
                <div className="provider-actions secondary">
                  <Button
                    className="settings-secondary-action danger"
                    isDisabled={isModelActionBusy || (!isUnsavedProfileDraft && modelSettings.profiles.length <= 1)}
                    onPress={deleteSelectedProfile}
                    type="button"
                  >
                    {isUnsavedProfileDraft ? "放弃新增" : "删除配置"}
                  </Button>
                </div>

                {saveState === "saved" ? <p className="settings-save-note">✓ 已保存，下一次发送会使用当前模型配置。</p> : null}
                {saveState === "error" ? <p className="settings-save-note error">保存失败，请稍后再试。</p> : null}
                {testState === "passed" ? <p className="settings-save-note">✓ {testMessage}</p> : null}
                {testState === "error" ? <p className="settings-save-note error">{testMessage}</p> : null}
                {hasUnsavedModelDraft && !isModelActionBusy ? (
                  <p className="settings-save-note">
                    {isUnsavedProfileDraft ? "请先保存这个新模型，或放弃新增后再切换。" : "请先保存配置后再切换或新增模型。"}
                  </p>
                ) : null}
                {didNormalizeBaseUrl ? (
                  <p className="settings-save-note">
                    已识别到 Base URL 里带了模型名或 /chat/completions，保存/测试时会自动改为 {normalizedDraft.baseUrl}。
                  </p>
                ) : null}
              </div>
            </div>
          </section>

          {showPresetPicker ? (
            <div className="preset-picker-overlay" onClick={closePresetPicker} role="presentation">
              <div className="preset-picker-dialog" onClick={(event) => event.stopPropagation()} role="dialog" aria-label="选择模型供应商">
                <div className="preset-picker-header">
                  <h3>选择模型供应商</h3>
                  <button className="preset-picker-close" onClick={closePresetPicker} type="button">×</button>
                </div>
                <div className="preset-picker-section">
                  <h4>官方 API 直连</h4>
                  <div className="preset-picker-grid">
                    {presetProviders.filter((p) => p.group === "official").map((preset) => (
                      <button
                        className={`preset-picker-item ${selectedPreset?.id === preset.id ? "selected" : ""}`}
                        key={preset.id}
                        onClick={() => selectPreset(preset)}
                        type="button"
                      >
                        <span className="preset-provider-icon" style={{ background: preset.accentColor }}>
                          {preset.iconLabel}
                        </span>
                        <div>
                          <strong>{preset.name}</strong>
                          <small>{preset.description}</small>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="preset-picker-section">
                  <h4>编码套餐 Coding Plan</h4>
                  <div className="preset-picker-grid">
                    {presetProviders.filter((p) => p.group === "coding-plan").map((preset) => (
                      <button
                        className={`preset-picker-item ${selectedPreset?.id === preset.id ? "selected" : ""}`}
                        key={preset.id}
                        onClick={() => selectPreset(preset)}
                        type="button"
                      >
                        <span className="preset-provider-icon" style={{ background: preset.accentColor }}>
                          {preset.iconLabel}
                        </span>
                        <div>
                          <strong>{preset.name}</strong>
                          <small>{preset.description}</small>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                {selectedPreset ? (
                  <div className="preset-picker-footer">
                    {selectedPreset.modelSuggestions.length > 0 ? (
                      <label className="settings-input">
                        <span>选择模型</span>
                        <div className="preset-model-chips">
                          {selectedPreset.modelSuggestions.map((model) => (
                            <button
                              className={`preset-model-chip ${selectedModelSuggestion === model.value ? "selected" : ""}`}
                              key={model.value}
                              onClick={() => selectPresetModel(model.value)}
                              type="button"
                            >
                              {model.label}
                            </button>
                          ))}
                        </div>
                      </label>
                    ) : null}
                    <Button className="settings-primary-action" onPress={confirmPresetSelection} type="button">
                      确认添加
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
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
                <h3>{memoryTab?.label ?? "记忆"}</h3>
                <p>{memoryTab?.description}</p>
              </div>
              <Chip className="provider-status" size="sm" variant="soft">
                {memoryView.latestSourceLabel}
              </Chip>
            </header>

            <div className="memory-dashboard">
              <div className="memory-summary-grid">
                <div className="memory-summary-item">
                  <span>配置后端</span>
                  <strong>{memoryView.backendLabel}</strong>
                </div>
                <div className="memory-summary-item">
                  <span>本轮来源</span>
                  <strong>{memoryView.latestSourceLabel}</strong>
                </div>
              <div className="memory-summary-item">
                  <span>{memoryView.selectedCharacterLabel}可见</span>
                  <strong>{memoryView.recalledCount}/{memoryView.totalRecalledCount}</strong>
                </div>
              </div>

              {memoryStatusError ? <p className="settings-save-note error">{memoryStatusError}</p> : null}

              <div className="memory-character-switcher" aria-label="按角色查看记忆">
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
                <h4>{memoryView.selectedCharacterLabel}可见记忆</h4>
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
                  <p className="memory-empty-state">还没有召回记录。</p>
                )}
              </div>

              <div className="memory-debug-log">
                <h4>调试日志</h4>
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
                  <p className="memory-empty-state">还没有记忆事件。</p>
                )}
              </div>
            </div>
          </section>
        </Tabs.Panel>

        {safetyTab ? (
          <Tabs.Panel className="settings-tab-panel" id={safetyTab.id}>
            <section>
              <header className="settings-section-header">
                <div>
                  <h3>{safetyTab.label}</h3>
                  <p>{safetyTab.description}</p>
                </div>
                <Button
                  className="settings-primary-action"
                  isDisabled={toolPolicySaveState === "saving"}
                  onPress={saveToolPolicySettings}
                  type="button"
                >
                  {toolPolicySaveState === "saving" ? "保存中" : "保存权限"}
                </Button>
              </header>

              <div className="tool-policy-dashboard">
                <div className="tool-policy-protected">
                  <span>保护路径</span>
                  <code>{toolPolicyView.protectedPathsPreview}</code>
                </div>

                {toolPolicyError ? <p className="settings-save-note error">{toolPolicyError}</p> : null}
                {toolPolicySaveState === "saved" ? <p className="settings-save-note">权限设置已保存。</p> : null}
                {toolPolicySaveState === "error" ? <p className="settings-save-note error">权限设置保存失败。</p> : null}

                <article className="tool-policy-mode-card">
                  <header>
                    <div>
                      <h4>全局工具权限</h4>
                      <p>默认让工具都可用，写入、Shell 和浏览器操作保留确认。</p>
                    </div>
                    <Chip className="provider-status" size="sm" variant="soft">
                      {toolPolicyView.enabledTools.length} 项启用
                    </Chip>
                  </header>

                  {renderToolGroup("builtinTools", "Pi 内置工具", toolPolicyView.toolOrder.filter((tool) => !tool.id.includes(".")))}
                  {renderToolGroup("customTools", "Cockapoo 工具", toolPolicyView.toolOrder.filter((tool) => tool.id.includes(".")))}
                  {renderToolGroup("confirmTools", "需要确认", toolPolicyView.toolOrder)}
                </article>
              </div>
            </section>
          </Tabs.Panel>
        ) : null}
      </Tabs>
      </div>
    </aside>
  );
}
