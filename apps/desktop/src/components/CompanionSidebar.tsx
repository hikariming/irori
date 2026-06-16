import { Avatar, Button, ScrollShadow } from "@heroui/react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import type { Mood } from "./character-state";
import type { CompanionCharacter, SessionGroup } from "./sidebar-model";
import type { Theme } from "./use-theme";

type CompanionSidebarProps = {
  characters: CompanionCharacter[];
  isNewSessionDisabled?: boolean;
  sessions: SessionGroup[];
  theme: Theme;
  isLifeActive?: boolean;
  lifeUnreadCount?: number;
  schedulesUnreadCount?: number;
  onCharacterInspect?: (character: CompanionCharacter) => void;
  onLifeOpen?: () => void;
  onNewSession?: () => void;
  onProfileOpen?: () => void;
  onSchedulesOpen?: () => void;
  onSessionSelect?: (sessionId: string) => void;
  onSettingsOpen?: () => void;
  onSkillsOpen?: () => void;
  onThemeToggle?: () => void;
};

function statusLabel(t: TFunction, status: CompanionCharacter["status"]) {
  return status === "online" ? t("sidebar.status.online") : t("sidebar.status.idle");
}

function meetLabel(t: TFunction, meetCount: number) {
  return meetCount > 0 ? t("common:characterState.meet", { count: meetCount }) : t("common:characterState.meetNone");
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function moodFillPercent(mood: Mood) {
  const moodLevels: Record<Mood, number> = {
    guarded: 22,
    tired: 34,
    calm: 56,
    warm: 78,
    playful: 92
  };
  return moodLevels[mood] ?? 50;
}

function CharacterAvatar({ character, index }: { character: CompanionCharacter; index: number }) {
  const { t } = useTranslation("companion");
  const unread = character.unreadCount ?? 0;
  return (
    <span className="avatar-wrap">
      <Avatar aria-label={`${character.name} ${statusLabel(t, character.status)}`} className={`character-avatar avatar-${index + 1}`}>
        {character.avatarSrc ? <Avatar.Image alt={character.name} src={character.avatarSrc} /> : null}
        <Avatar.Fallback className="avatar-fallback">{character.name.slice(0, 1)}</Avatar.Fallback>
      </Avatar>
      <span className={`status-dot ${character.status}`} aria-label={statusLabel(t, character.status)} />
      {unread > 0 ? (
        <span className="letter-badge" aria-label={t("sidebar.unreadLetters", { count: unread })}>
          {unread > 9 ? "9+" : unread}
        </span>
      ) : null}
    </span>
  );
}

function CharacterHoverCard({ character }: { character: CompanionCharacter }) {
  const { t } = useTranslation("companion");
  const summary = character.stateSummary;
  const themeColor = character.themeColor ?? "#2f6f68";
  const activity = character.activityStatus ?? t("sidebar.defaultActivity");

  if (!summary && !character.activityStatus) {
    return null;
  }

  return (
    <aside className="character-hover-card" aria-label={t("sidebar.stateCardAria", { name: character.name })}>
      <header className="character-hover-head">
        <span className={`status-dot ${character.status}`} aria-hidden="true" />
        <strong>{character.name}</strong>
        {summary ? <small>{meetLabel(t, summary.meetCount)}</small> : null}
      </header>

      <div className="character-hover-activity">
        <span>{t("sidebar.doing")}</span>
        <strong>{activity}</strong>
      </div>

      {summary ? (
        <>
          <div className="character-hover-meter">
            <div className="character-hover-meter-head">
              <span>{t("sidebar.mood")}</span>
              <strong>{t(`common:characterState.mood.${summary.mood}`)}</strong>
            </div>
            <span
              className="character-hover-track"
              role="meter"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={moodFillPercent(summary.mood)}
              aria-valuetext={t(`common:characterState.mood.${summary.mood}`)}
            >
              <span style={{ width: `${moodFillPercent(summary.mood)}%`, backgroundColor: themeColor }} />
            </span>
          </div>

          <dl className="character-hover-metrics">
            <div>
              <dt>{t("sidebar.energy")}</dt>
              <dd>{t(`common:characterState.energy.${summary.energyLevel}`)}</dd>
            </div>
            <div>
              <dt>{t("sidebar.affinity")}</dt>
              <dd>{t(`common:characterState.affinityTier.${summary.affinityTier}`)}</dd>
            </div>
          </dl>

          <span className="character-hover-energy" aria-label={t("sidebar.energyAria", { value: summary.energy })}>
            <span style={{ width: `${clampPercent(summary.energy)}%`, backgroundColor: themeColor }} />
          </span>
        </>
      ) : null}
    </aside>
  );
}

export function CompanionSidebar({
  characters,
  isNewSessionDisabled = false,
  isLifeActive = false,
  lifeUnreadCount = 0,
  schedulesUnreadCount = 0,
  onCharacterInspect,
  onLifeOpen,
  onNewSession,
  onProfileOpen,
  onSchedulesOpen,
  onSessionSelect,
  onSettingsOpen,
  onSkillsOpen,
  onThemeToggle,
  sessions,
  theme
}: CompanionSidebarProps) {
  const { t } = useTranslation("companion");
  return (
    <aside className="companion-sidebar" aria-label={t("sidebar.listAria")}>
      <section className="character-switcher" aria-label={t("sidebar.switcherAria")}>
        {characters.map((character, index) => (
          <div className="character-row-shell" key={character.id}>
            <Button
              className={`character-row ${character.active ? "active" : ""}`}
              onPress={() => onCharacterInspect?.(character)}
              type="button"
            >
              <CharacterAvatar character={character} index={index} />
              <span className="character-copy">
                <strong>{character.name}</strong>
                {character.activityStatus ? (
                  <small aria-label={t("sidebar.presenceAria", { name: character.name, activity: character.activityStatus })}>
                    {t("sidebar.presence", { activity: character.activityStatus })}
                  </small>
                ) : null}
              </span>
              {character.active ? <span className="status-dot online" aria-label={t("sidebar.status.online")} /> : null}
            </Button>
            <CharacterHoverCard character={character} />
          </div>
        ))}

      </section>

      <ScrollShadow className="session-list" hideScrollBar orientation="vertical">
        <section aria-label={t("sidebar.sessions.aria")}>
          <header className="session-list-header">
            <h2>{t("sidebar.sessions.title")}</h2>
            <Button
              aria-label={t("sidebar.sessions.newSession")}
              className="new-session-button"
              isDisabled={isNewSessionDisabled}
              onPress={onNewSession}
              type="button"
            >
              +
            </Button>
          </header>
          {sessions.map((group) => (
            <div className="session-group" key={group.group}>
              <p>{group.group}</p>
              {group.items.map((item) => (
                <Button
                  className={`session-item ${item.active ? "active" : ""}`}
                  key={item.id}
                  onPress={() => onSessionSelect?.(item.id)}
                  type="button"
                >
                  <span>{item.title}</span>
                  <time>{item.time}</time>
                </Button>
              ))}
            </div>
          ))}
        </section>
      </ScrollShadow>

      <footer className="sidebar-footer" aria-label={t("sidebar.footer.aria")}>
        <div className="sidebar-footer__group">
          <Button aria-label={t("sidebar.footer.settings")} className="sidebar-icon-button" onPress={onSettingsOpen} type="button">
            ⚙
          </Button>
          <Button aria-label={t("sidebar.footer.profile")} className="sidebar-icon-button" onPress={onProfileOpen} type="button">
            <svg
              className="sidebar-life-icon"
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <circle cx="12" cy="8" r="3.4" />
              <path d="M5 19a7 7 0 0 1 14 0" />
            </svg>
          </Button>
          <Button aria-label={t("sidebar.footer.skills")} className="sidebar-icon-button" onPress={onSkillsOpen} type="button">
            <svg
              className="sidebar-life-icon"
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
            </svg>
          </Button>
          <Button aria-label={t("sidebar.footer.schedules")} className="sidebar-icon-button" onPress={onSchedulesOpen} type="button">
            <svg
              className="sidebar-life-icon"
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <circle cx="12" cy="13" r="8" />
              <path d="M12 9v4l2.5 1.6" />
              <path d="M5 4 2.6 6.2M19 4l2.4 2.2" />
            </svg>
            {schedulesUnreadCount > 0 ? (
              <span className="letter-badge" aria-label={t("sidebar.newResults", { count: schedulesUnreadCount })}>
                {schedulesUnreadCount > 9 ? "9+" : schedulesUnreadCount}
              </span>
            ) : null}
          </Button>
          <Button
            aria-label={t("sidebar.footer.life")}
            className={`sidebar-icon-button sidebar-life-button ${isLifeActive ? "active" : ""}`}
            onPress={onLifeOpen}
            type="button"
          >
            <svg
              className="sidebar-life-icon"
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <circle cx="9" cy="8" r="3" />
              <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
              <path d="M16 5.3a3 3 0 0 1 0 5.4" />
              <path d="M17.5 13.4a5.5 5.5 0 0 1 3 4.9" />
            </svg>
            {lifeUnreadCount > 0 ? (
              <span className="letter-badge" aria-label={t("sidebar.unreadLetters", { count: lifeUnreadCount })}>
                {lifeUnreadCount > 9 ? "9+" : lifeUnreadCount}
              </span>
            ) : null}
          </Button>
        </div>
        <Button
          aria-label={theme === "dark" ? t("sidebar.footer.toLight") : t("sidebar.footer.toDark")}
          className="sidebar-icon-button"
          onPress={onThemeToggle}
          type="button"
        >
          {theme === "dark" ? "☀" : "☾"}
        </Button>
      </footer>
    </aside>
  );
}
