import { Button, Chip, Tabs } from "@heroui/react";
import { useEffect, useState } from "react";

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
  buildInitialModelSettings,
  formatOpenAiCompatibleRequestPreview,
  normalizeOpenAiCompatibleSettings,
  type ModelSettingsState
} from "./model-settings-controller";
import { buildSettingsTabs } from "./settings-model";

type SystemSettingsPanelProps = {
  isOpen: boolean;
  latestMemoryRun?: MemoryRunSnapshot | null;
  memoryDebugEvents?: MemoryDebugEvent[];
  onClose: () => void;
  onModelSettingsChange?: (settings: ModelSettingsState) => void;
};

export function SystemSettingsPanel({ isOpen, latestMemoryRun, memoryDebugEvents = [], onClose, onModelSettingsChange }: SystemSettingsPanelProps) {
  const tabs = buildSettingsTabs();
  const modelProviderTab = tabs[0];
  const memoryTab = tabs.find((tab) => tab.id === "memory");
  const safetyTab = tabs.find((tab) => tab.id === "safety");
  const [baseUrl, setBaseUrl] = useState(buildInitialModelSettings().baseUrl);
  const [modelName, setModelName] = useState(buildInitialModelSettings().modelName);
  const [token, setToken] = useState("");
  const [tokenHint, setTokenHint] = useState<string | undefined>();
  const [hasToken, setHasToken] = useState(false);
  const [memoryStatus, setMemoryStatus] = useState<MemoryStatus | null>(null);
  const [memoryStatusError, setMemoryStatusError] = useState("");
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
  const memoryView = buildMemoryDashboardViewModel({
    debugEvents: memoryDebugEvents,
    status: memoryStatus,
    latestRun: latestMemoryRun
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
                  <span>召回数量</span>
                  <strong>{memoryView.recalledCount}</strong>
                </div>
              </div>

              {memoryStatusError ? <p className="settings-save-note error">{memoryStatusError}</p> : null}

              <dl className="memory-storage-list">
                {memoryView.storageRows.map((row) => (
                  <div className="memory-storage-row" key={row.label}>
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>

              <div className="memory-recall-list">
                <h4>本轮召回</h4>
                {memoryView.memories.length > 0 ? (
                  memoryView.memories.map((memory) => (
                    <article className="memory-recall-item" key={memory.id}>
                      <div>
                        <span>{memory.kindLabel}</span>
                        <small>{memory.sourceLabel}</small>
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
            <section className="settings-placeholder">
              <h3>{safetyTab.label}</h3>
              <p>{safetyTab.description}</p>
            </section>
          </Tabs.Panel>
        ) : null}
      </Tabs>
    </aside>
  );
}
