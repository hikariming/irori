import { Avatar, Button, ScrollShadow } from "@heroui/react";

import type { CompanionCharacter, SessionGroup } from "./sidebar-model";
import type { Theme } from "./use-theme";

type CompanionSidebarProps = {
  characters: CompanionCharacter[];
  isNewSessionDisabled?: boolean;
  sessions: SessionGroup[];
  theme: Theme;
  onCharacterInspect?: (character: CompanionCharacter) => void;
  onNewSession?: () => void;
  onSessionSelect?: (sessionId: string) => void;
  onSettingsOpen?: () => void;
  onThemeToggle?: () => void;
};

function statusLabel(status: CompanionCharacter["status"]) {
  return status === "online" ? "在线" : "待机";
}

function CharacterAvatar({ character, index }: { character: CompanionCharacter; index: number }) {
  return (
    <span className="avatar-wrap">
      <Avatar aria-label={`${character.name} ${statusLabel(character.status)}`} className={`character-avatar avatar-${index + 1}`}>
        {character.avatarSrc ? <Avatar.Image alt={character.name} src={character.avatarSrc} /> : null}
        <Avatar.Fallback className="avatar-fallback">{character.name.slice(0, 1)}</Avatar.Fallback>
      </Avatar>
      <span className={`status-dot ${character.status}`} aria-label={statusLabel(character.status)} />
    </span>
  );
}

export function CompanionSidebar({
  characters,
  isNewSessionDisabled = false,
  onCharacterInspect,
  onNewSession,
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
          <Button
            className={`character-row ${character.active ? "active" : ""}`}
            key={character.id}
            onPress={() => onCharacterInspect?.(character)}
            type="button"
          >
            <CharacterAvatar character={character} index={index} />
            <span className="character-copy">
              <strong>{character.name}</strong>
              <small>{character.tone}</small>
            </span>
            {character.active ? <span className="status-dot online" aria-label="在线" /> : null}
          </Button>
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
        <Button aria-label="设置" className="sidebar-icon-button" onPress={onSettingsOpen} type="button">
          ⚙
        </Button>
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
