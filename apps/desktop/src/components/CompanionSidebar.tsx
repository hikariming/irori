import { Avatar, Button, ScrollShadow } from "@heroui/react";

import type { CompanionCharacter, SessionGroup } from "./sidebar-model";
import type { Theme } from "./use-theme";

type CompanionSidebarProps = {
  characters: CompanionCharacter[];
  isNewSessionDisabled?: boolean;
  sessions: SessionGroup[];
  theme: Theme;
  isLifeActive?: boolean;
  lifeUnreadCount?: number;
  onCharacterInspect?: (character: CompanionCharacter) => void;
  onLifeOpen?: () => void;
  onNewSession?: () => void;
  onProfileOpen?: () => void;
  onSessionSelect?: (sessionId: string) => void;
  onSettingsOpen?: () => void;
  onThemeToggle?: () => void;
};

function statusLabel(status: CompanionCharacter["status"]) {
  return status === "online" ? "在线" : "待机";
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function moodFillPercent(label: string) {
  const moodLevels: Record<string, number> = {
    戒备: 22,
    疲惫: 34,
    平静: 56,
    温暖: 78,
    俏皮: 92
  };
  return moodLevels[label] ?? 50;
}

function CharacterAvatar({ character, index }: { character: CompanionCharacter; index: number }) {
  const unread = character.unreadCount ?? 0;
  return (
    <span className="avatar-wrap">
      <Avatar aria-label={`${character.name} ${statusLabel(character.status)}`} className={`character-avatar avatar-${index + 1}`}>
        {character.avatarSrc ? <Avatar.Image alt={character.name} src={character.avatarSrc} /> : null}
        <Avatar.Fallback className="avatar-fallback">{character.name.slice(0, 1)}</Avatar.Fallback>
      </Avatar>
      <span className={`status-dot ${character.status}`} aria-label={statusLabel(character.status)} />
      {unread > 0 ? (
        <span className="letter-badge" aria-label={`${unread} 封未读信`}>
          {unread > 9 ? "9+" : unread}
        </span>
      ) : null}
    </span>
  );
}

function CharacterHoverCard({ character }: { character: CompanionCharacter }) {
  const summary = character.stateSummary;
  const themeColor = character.themeColor ?? "#2f6f68";
  const activity = character.activityStatus ?? "同步今天的作息";

  if (!summary && !character.activityStatus) {
    return null;
  }

  return (
    <aside className="character-hover-card" aria-label={`${character.name}当前状态`}>
      <header className="character-hover-head">
        <span className={`status-dot ${character.status}`} aria-hidden="true" />
        <strong>{character.name}</strong>
        {summary ? <small>{summary.meetLabel}</small> : null}
      </header>

      <div className="character-hover-activity">
        <span>正在</span>
        <strong>{activity}</strong>
      </div>

      {summary ? (
        <>
          <div className="character-hover-meter">
            <div className="character-hover-meter-head">
              <span>心情</span>
              <strong>{summary.moodLabel}</strong>
            </div>
            <span
              className="character-hover-track"
              role="meter"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={moodFillPercent(summary.moodLabel)}
              aria-valuetext={summary.moodLabel}
            >
              <span style={{ width: `${moodFillPercent(summary.moodLabel)}%`, backgroundColor: themeColor }} />
            </span>
          </div>

          <dl className="character-hover-metrics">
            <div>
              <dt>精力</dt>
              <dd>{summary.energyLabel}</dd>
            </div>
            <div>
              <dt>好感</dt>
              <dd>{summary.affinityTierLabel}</dd>
            </div>
          </dl>

          <span className="character-hover-energy" aria-label={`精力 ${summary.energy}`}>
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
  onCharacterInspect,
  onLifeOpen,
  onNewSession,
  onProfileOpen,
  onSessionSelect,
  onSettingsOpen,
  onThemeToggle,
  sessions,
  theme
}: CompanionSidebarProps) {
  return (
    <aside className="companion-sidebar" aria-label="角色与对话记录">
      <section className="character-switcher" aria-label="角色切换">
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
                  <small aria-label={`${character.name}此刻${character.activityStatus}`}>
                    此刻{character.activityStatus}
                  </small>
                ) : null}
              </span>
              {character.active ? <span className="status-dot online" aria-label="在线" /> : null}
            </Button>
            <CharacterHoverCard character={character} />
          </div>
        ))}

        <Button className="add-character" type="button">
          <span>+</span>
          添加角色
        </Button>
      </section>

      <ScrollShadow className="session-list" hideScrollBar orientation="vertical">
        <section aria-label="对话记录">
          <header className="session-list-header">
            <h2>对话记录</h2>
            <Button
              aria-label="新建会话"
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

      <footer className="sidebar-footer" aria-label="设置">
        <div className="sidebar-footer__group">
          <Button aria-label="设置" className="sidebar-icon-button" onPress={onSettingsOpen} type="button">
            ⚙
          </Button>
          <Button aria-label="我的档案" className="sidebar-icon-button" onPress={onProfileOpen} type="button">
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
          <Button
            aria-label="生活圈"
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
              <span className="letter-badge" aria-label={`${lifeUnreadCount} 封未读信`}>
                {lifeUnreadCount > 9 ? "9+" : lifeUnreadCount}
              </span>
            ) : null}
          </Button>
        </div>
        <Button
          aria-label={theme === "dark" ? "切换亮色模式" : "切换暗色模式"}
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
