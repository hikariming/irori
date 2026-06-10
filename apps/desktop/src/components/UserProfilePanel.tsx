import { Button } from "@heroui/react";

import { genderLabels, genderOptions, type UserProfile } from "./user-profile";

type UserProfilePanelProps = {
  isOpen: boolean;
  profile: UserProfile;
  onProfileChange: (patch: Partial<UserProfile>) => void;
  onClose: () => void;
};

// 「我」：用户自己的档案面板。名字/性别/偏好/自我介绍，改动即时保存（localStorage）。
// 这些内容会在聊天时注入给角色，让 ta 知道在和谁说话、该怎么称呼你。
export function UserProfilePanel({ isOpen, profile, onProfileChange, onClose }: UserProfilePanelProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <aside className="system-settings-panel" aria-label="我的档案">
      <div className="settings-page-inner">
        <div className="settings-panel-header">
          <Button aria-label="返回主界面" className="settings-back" onPress={onClose} type="button">
            <span className="settings-back-arrow" aria-hidden="true">←</span>
            返回
          </Button>
          <div className="settings-header-titles">
            <span>我</span>
            <h2>我的档案</h2>
          </div>
        </div>

        <div className="profile-panel-body">
          <p className="profile-panel-hint">
            这些信息会在聊天时让角色知道「你是谁」：该怎么称呼你、你的偏好与习惯。改动会自动保存。
          </p>

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
            <span className="profile-field-label">偏好与习惯</span>
            <textarea
              className="profile-textarea"
              aria-label="我的偏好与习惯"
              placeholder="比如：喜欢简洁直接的回答、习惯深夜写代码、不喜欢被催…"
              value={profile.preferences}
              maxLength={600}
              rows={4}
              onChange={(event) => onProfileChange({ preferences: event.target.value })}
            />
          </label>

          <label className="profile-field">
            <span className="profile-field-label">自我介绍（对所有角色展示）</span>
            <textarea
              className="profile-textarea"
              aria-label="我的自我介绍"
              placeholder="想让角色们知道的关于你的事：身份、在做的项目、性格…"
              value={profile.selfIntroduction}
              maxLength={600}
              rows={5}
              onChange={(event) => onProfileChange({ selfIntroduction: event.target.value })}
            />
          </label>
        </div>
      </div>
    </aside>
  );
}
