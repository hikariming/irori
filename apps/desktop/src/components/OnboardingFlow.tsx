import { Button } from "@heroui/react";
import { useState } from "react";

import { desktopBackend } from "./desktop-backend";
import {
  getActiveModelProfile,
  isModelConfigured,
  normalizeOpenAiCompatibleSettings,
  type ModelSettingsState
} from "./model-settings-controller";
import { genderLabels, genderOptions, type UserProfile } from "./user-profile";

type OnboardingFlowProps = {
  appName: string;
  profile: UserProfile;
  onProfileChange: (patch: Partial<UserProfile>) => void;
  modelSettings: ModelSettingsState;
  onModelSettingsChange: (settings: ModelSettingsState) => void;
  onFinish: () => void;
  onSkip: () => void;
};

const STEP_TITLES = ["欢迎", "我是谁", "模型供应商", "完成"] as const;
const TOTAL_STEPS = STEP_TITLES.length;

const FEATURES: Array<{ title: string; desc: string }> = [
  { title: "角色陪伴", desc: "角色各有人设与做事风格，可操作电脑，编写代码，完成工作。" },
  { title: "虚拟生活", desc: "角色有自己的一天作息：此刻在做什么、心情与精力都会变化。" },
  { title: "生活圈与信件", desc: "角色会发动态、写信给你，关系慢慢长出来。" },
  { title: "本地记忆", desc: "ta 会记住你的偏好与重要的事，越聊越懂你。" }
];

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
  const [step, setStep] = useState(0);

  const activeProfile = getActiveModelProfile(modelSettings);
  const [modelDraft, setModelDraft] = useState({
    name: activeProfile.name,
    baseUrl: activeProfile.baseUrl,
    modelName: activeProfile.modelName,
    token: ""
  });
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const modelConfigured = isModelConfigured(modelSettings);

  function patchModel(patch: Partial<typeof modelDraft>) {
    setModelDraft((current) => ({ ...current, ...patch }));
    setSaveState("idle");
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
    <aside className="onboarding-overlay" aria-label={`${appName} 新手引导`}>
      <div className="onboarding-card">
        <div className="onboarding-progress" role="progressbar" aria-valuemin={1} aria-valuemax={TOTAL_STEPS} aria-valuenow={step + 1}>
          {STEP_TITLES.map((title, index) => (
            <span
              key={title}
              className={`onboarding-progress-dot ${index === step ? "active" : ""} ${index < step ? "done" : ""}`}
              aria-label={`第 ${index + 1} 步：${title}`}
            />
          ))}
        </div>

        <div className="onboarding-body">
          {step === 0 ? (
            <section className="onboarding-step">
              <p className="onboarding-eyebrow">欢迎使用</p>
              <h2 className="onboarding-title">{appName}</h2>
              <p className="onboarding-lead">一个住在你本地的角色陪伴 app。先花一分钟，把基础设置好，就能开始啦。</p>
              <ul className="onboarding-features">
                {FEATURES.map((feature) => (
                  <li key={feature.title}>
                    <strong>{feature.title}</strong>
                    <span>{feature.desc}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {step === 1 ? (
            <section className="onboarding-step">
              <p className="onboarding-eyebrow">第二步</p>
              <h2 className="onboarding-title">介绍一下你自己</h2>
              <p className="onboarding-lead">这些会让角色知道在和谁聊天、该怎么称呼你。都可以之后在「我」里修改。</p>

              <label className="settings-input">
                <span>名字 / 称呼</span>
                <input
                  aria-label="我的名字或称呼"
                  placeholder="希望角色怎么称呼你"
                  value={profile.name}
                  maxLength={40}
                  onChange={(event) => onProfileChange({ name: event.target.value })}
                />
              </label>

              <div className="profile-field" role="group" aria-label="性别">
                <span className="profile-field-label">性别</span>
                <div className="profile-gender-options">
                  {genderOptions.map((gender) => (
                    <Button
                      key={gender}
                      type="button"
                      aria-pressed={profile.gender === gender}
                      className={`profile-gender-chip ${profile.gender === gender ? "active" : ""}`}
                      onPress={() => onProfileChange({ gender })}
                    >
                      {genderLabels[gender]}
                    </Button>
                  ))}
                </div>
              </div>

              <label className="settings-input">
                <span>居住的城市</span>
                <input
                  aria-label="我居住的城市"
                  placeholder="比如：上海"
                  value={profile.city}
                  maxLength={40}
                  onChange={(event) => onProfileChange({ city: event.target.value })}
                />
              </label>

              <label className="profile-field">
                <span className="profile-field-label">自我介绍（选填，会展示给所有角色）</span>
                <textarea
                  className="profile-textarea"
                  aria-label="我的自我介绍"
                  placeholder="想让角色们知道的关于你的事：身份、在做的项目、性格…"
                  value={profile.selfIntroduction}
                  maxLength={600}
                  rows={3}
                  onChange={(event) => onProfileChange({ selfIntroduction: event.target.value })}
                />
              </label>
            </section>
          ) : null}

          {step === 2 ? (
            <section className="onboarding-step">
              <p className="onboarding-eyebrow">第三步</p>
              <h2 className="onboarding-title">连接模型供应商</h2>
              <p className="onboarding-lead">填入任意 OpenAI 兼容接口（Base URL、模型名、Token），角色就能开口说话了。</p>

              <label className="settings-input">
                <span>配置名称</span>
                <input
                  aria-label="模型配置名称"
                  placeholder="给这套配置起个名字"
                  value={modelDraft.name}
                  onChange={(event) => patchModel({ name: event.target.value })}
                />
              </label>
              <label className="settings-input">
                <span>Base URL</span>
                <input
                  aria-label="OpenAI 兼容接口 Base URL"
                  placeholder="https://api.example.com/v1"
                  value={modelDraft.baseUrl}
                  onChange={(event) => patchModel({ baseUrl: event.target.value })}
                />
              </label>
              <label className="settings-input">
                <span>模型名</span>
                <input
                  aria-label="模型名"
                  placeholder="比如 gpt-4o-mini"
                  value={modelDraft.modelName}
                  onChange={(event) => patchModel({ modelName: event.target.value })}
                />
              </label>
              <label className="settings-input">
                <span>Token</span>
                <input
                  aria-label="接口 Token"
                  type="password"
                  placeholder={activeProfile.hasToken ? "已保存，留空则不修改" : "sk-…"}
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
                  {saveState === "saving" ? "保存中…" : "保存并启用"}
                </Button>
                {saveState === "saved" || modelConfigured ? (
                  <span className="settings-save-note">已保存，可以进入下一步。</span>
                ) : null}
                {saveState === "error" ? <span className="settings-save-note error">保存失败，请检查后重试。</span> : null}
              </div>
            </section>
          ) : null}

          {step === 3 ? (
            <section className="onboarding-step onboarding-step--center">
              <div className="onboarding-done-badge" aria-hidden="true">✓</div>
              <h2 className="onboarding-title">都设置好啦{profile.name ? `，${profile.name}` : ""}</h2>
              <p className="onboarding-lead">
                {modelConfigured
                  ? "角色们已经准备好了，去打个招呼吧。Enjoy ✨"
                  : "你还没配置模型，角色暂时无法回复——可以稍后在「设置」里补上。Enjoy ✨"}
              </p>
            </section>
          ) : null}
        </div>

        <footer className="onboarding-footer">
          <div className="onboarding-footer-left">
            {step > 0 ? (
              <Button type="button" className="onboarding-ghost" onPress={() => setStep((current) => current - 1)}>
                上一步
              </Button>
            ) : (
              <Button type="button" className="onboarding-ghost" onPress={onSkip}>
                跳过引导
              </Button>
            )}
          </div>
          <div className="onboarding-footer-right">
            {isLast ? (
              <Button type="button" className="settings-primary-action" onPress={onFinish}>
                开始使用
              </Button>
            ) : (
              <Button type="button" className="settings-primary-action" onPress={() => setStep((current) => current + 1)}>
                下一步
              </Button>
            )}
          </div>
        </footer>
      </div>
    </aside>
  );
}
