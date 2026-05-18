import { Button, Chip, Tabs } from "@heroui/react";
import { useEffect, useState } from "react";

import { CharacterCardSettings } from "./CharacterCardSettings";
import { desktopBackend } from "./desktop-backend";
import { formatUnknownError } from "./error-message";
import {
  buildInitialModelSettings,
  formatOpenAiCompatibleRequestPreview,
  normalizeOpenAiCompatibleSettings,
  type ModelSettingsState
} from "./model-settings-controller";
import { buildSettingsTabs } from "./settings-model";

type SystemSettingsPanelProps = {
  isOpen: boolean;
  onClose: () => void;
  onModelSettingsChange?: (settings: ModelSettingsState) => void;
};

export function SystemSettingsPanel({ isOpen, onClose, onModelSettingsChange }: SystemSettingsPanelProps) {
  const tabs = buildSettingsTabs();
  const modelProviderTab = tabs[0];
  const [baseUrl, setBaseUrl] = useState(buildInitialModelSettings().baseUrl);
  const [modelName, setModelName] = useState(buildInitialModelSettings().modelName);
  const [token, setToken] = useState("");
  const [tokenHint, setTokenHint] = useState<string | undefined>();
  const [hasToken, setHasToken] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [testState, setTestState] = useState<"idle" | "testing" | "passed" | "error">("idle");
  const [testMessage, setTestMessage] = useState("");

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    desktopBackend.loadModelSettings().then((settings) => {
      setBaseUrl(settings.baseUrl);
      setModelName(settings.modelName);
      setTokenHint(settings.tokenHint);
      setHasToken(settings.hasToken);
      onModelSettingsChange?.(settings);
      setTestState("idle");
      setTestMessage("");
    });
  }, [isOpen, onModelSettingsChange]);

  if (!isOpen) {
    return null;
  }

  const normalizedDraft = normalizeOpenAiCompatibleSettings({
    baseUrl,
    modelName
  });
  const routePreview = formatOpenAiCompatibleRequestPreview({
    baseUrl,
    hasToken,
    modelName,
    tokenHint
  });
  const didNormalizeBaseUrl = normalizedDraft.baseUrl !== baseUrl.trim().replace(/\/+$/, "");

  async function saveModelSettings() {
    setSaveState("saving");

    try {
      const settings = await desktopBackend.saveModelSettings({
        baseUrl: normalizedDraft.baseUrl,
        modelName: normalizedDraft.modelName,
        token: token.trim() || undefined
      });
      setBaseUrl(settings.baseUrl);
      setModelName(settings.modelName);
      setTokenHint(settings.tokenHint);
      setHasToken(settings.hasToken);
      setToken("");
      setSaveState("saved");
      setTestState("idle");
      setTestMessage("");
      onModelSettingsChange?.(settings);
    } catch {
      setSaveState("error");
    }
  }

  async function testModelConnection() {
    setTestState("testing");
    setTestMessage("");

    try {
      const settings = await desktopBackend.saveModelSettings({
        baseUrl: normalizedDraft.baseUrl,
        modelName: normalizedDraft.modelName,
        token: token.trim() || undefined
      });
      setBaseUrl(settings.baseUrl);
      setModelName(settings.modelName);
      setTokenHint(settings.tokenHint);
      setHasToken(settings.hasToken);
      setToken("");
      onModelSettingsChange?.(settings);

      const result = await desktopBackend.testModelConnection();
      setTestState("passed");
      setTestMessage(`模型测试通过：${result.text}`);
    } catch (error) {
      setTestState("error");
      setTestMessage(formatUnknownError(error, "模型测试失败。"));
    }
  }

  return (
    <aside className="system-settings-panel" aria-label="系统设置">
      <div className="settings-panel-header">
        <div>
          <span>系统设置</span>
          <h2>角色与本地模型</h2>
        </div>
        <Button aria-label="关闭系统设置" className="settings-close" onPress={onClose} type="button">
          ×
        </Button>
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
                {hasToken ? `Token ${tokenHint ?? "已保存"}` : "未保存 Token"}
              </Chip>
            </header>

            <div className="openai-compatible-form">
              <label className="settings-input">
                <span>Base URL</span>
                <input
                  aria-label="OpenAI 兼容接口 Base URL"
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="https://open.bigmodel.cn/api/coding/paas/v4"
                  value={baseUrl}
                />
              </label>
              <label className="settings-input">
                <span>Token</span>
                <input
                  aria-label="OpenAI 兼容接口 Token"
                  onChange={(event) => setToken(event.target.value)}
                  placeholder={hasToken ? "留空则继续使用已保存 Token" : "sk-..."}
                  type="password"
                  value={token}
                />
              </label>
              <label className="settings-input">
                <span>模型名</span>
                <input
                  aria-label="OpenAI 兼容接口模型名"
                  onChange={(event) => setModelName(event.target.value)}
                  placeholder="glm-5.1 / gpt-5.2 / qwen3-coder"
                  value={modelName}
                />
              </label>

              <div className="provider-route-row">
                <code className="provider-route">{routePreview}</code>
                <div className="provider-actions">
                  <Button
                    className="settings-secondary-action"
                    isDisabled={!baseUrl.trim() || !modelName.trim() || (!hasToken && !token.trim()) || testState === "testing" || saveState === "saving"}
                    onPress={testModelConnection}
                    type="button"
                  >
                    {testState === "testing" ? "测试中" : "测试模型"}
                  </Button>
                  <Button
                    className="settings-primary-action"
                    isDisabled={!baseUrl.trim() || !modelName.trim() || (!hasToken && !token.trim()) || saveState === "saving"}
                    onPress={saveModelSettings}
                    type="button"
                  >
                    {saveState === "saving" ? "保存中" : "保存配置"}
                  </Button>
                </div>
              </div>
              {saveState === "saved" ? <p className="settings-save-note">已保存，下一次发送会使用这组接口。</p> : null}
              {saveState === "error" ? <p className="settings-save-note error">保存失败，稍后再试。</p> : null}
              {testState === "passed" ? <p className="settings-save-note">{testMessage}</p> : null}
              {testState === "error" ? <p className="settings-save-note error">{testMessage}</p> : null}
              {didNormalizeBaseUrl ? (
                <p className="settings-save-note">
                  已识别到 Base URL 里带了模型名或 /chat/completions，保存/测试时会自动改为 {normalizedDraft.baseUrl}。
                </p>
              ) : null}
            </div>
          </section>
        </Tabs.Panel>

        <Tabs.Panel className="settings-tab-panel" id="character-card">
          <CharacterCardSettings />
        </Tabs.Panel>

        {tabs.slice(2).map((tab) => (
          <Tabs.Panel className="settings-tab-panel" id={tab.id} key={tab.id}>
            <section className="settings-placeholder">
              <h3>{tab.label}</h3>
              <p>{tab.description}</p>
            </section>
          </Tabs.Panel>
        ))}
      </Tabs>
    </aside>
  );
}
