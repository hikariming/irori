import { Button } from "@heroui/react";
import { useTranslation } from "react-i18next";

import { genderOptions, type UserProfile } from "./user-profile";

type UserProfilePanelProps = {
  isOpen: boolean;
  profile: UserProfile;
  onProfileChange: (patch: Partial<UserProfile>) => void;
  onClose: () => void;
};

// 「我」：用户自己的档案面板。名字/性别/偏好/自我介绍，改动即时保存（localStorage）。
// 这些内容会在聊天时注入给角色，让 ta 知道在和谁说话、该怎么称呼你。
export function UserProfilePanel({ isOpen, profile, onProfileChange, onClose }: UserProfilePanelProps) {
  const { t } = useTranslation(["profile", "common"]);

  if (!isOpen) {
    return null;
  }

  return (
    <aside className="system-settings-panel" aria-label={t("panelAria")}>
      <div className="settings-page-inner">
        <div className="settings-panel-header">
          <Button aria-label={t("common:nav.backToMain")} className="settings-back" onPress={onClose} type="button">
            <span className="settings-back-arrow" aria-hidden="true">←</span>
            {t("common:nav.back")}
          </Button>
          <div className="settings-header-titles">
            <span>{t("eyebrow")}</span>
            <h2>{t("title")}</h2>
          </div>
        </div>

        <div className="profile-panel-body">
          <p className="profile-panel-hint">
            {t("hint")}
          </p>

          <label className="settings-input">
            <span>{t("nameLabel")}</span>
            <input
              aria-label={t("nameAria")}
              placeholder={t("namePlaceholder")}
              value={profile.name}
              maxLength={40}
              onChange={(event) => onProfileChange({ name: event.target.value })}
            />
          </label>

          <div className="profile-field" role="group" aria-label={t("genderLabel")}>
            <span className="profile-field-label">{t("genderLabel")}</span>
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
            <span>{t("cityLabel")}</span>
            <input
              aria-label={t("cityAria")}
              placeholder={t("cityPlaceholder")}
              value={profile.city}
              maxLength={40}
              onChange={(event) => onProfileChange({ city: event.target.value })}
            />
          </label>

          <label className="profile-field">
            <span className="profile-field-label">{t("prefsLabel")}</span>
            <textarea
              className="profile-textarea"
              aria-label={t("prefsAria")}
              placeholder={t("prefsPlaceholder")}
              value={profile.preferences}
              maxLength={600}
              rows={4}
              onChange={(event) => onProfileChange({ preferences: event.target.value })}
            />
          </label>

          <label className="profile-field">
            <span className="profile-field-label">{t("introLabel")}</span>
            <textarea
              className="profile-textarea"
              aria-label={t("introAria")}
              placeholder={t("introPlaceholder")}
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
