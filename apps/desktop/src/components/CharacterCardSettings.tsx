import { useEffect, useState } from "react";
import { Avatar, Chip } from "@heroui/react";

import { findCharacterCard, type CharacterCard } from "./character-cards";

type CharacterCardSettingsProps = {
  cards: CharacterCard[];
  activeCharacterId?: string;
};

export function CharacterCardSettings({ cards, activeCharacterId = "shili" }: CharacterCardSettingsProps) {
  const [selectedId, setSelectedId] = useState(activeCharacterId);
  const card = findCharacterCard(cards, selectedId) ?? cards[0] ?? null;

  useEffect(() => {
    setSelectedId(activeCharacterId);
  }, [activeCharacterId]);

  if (!card) {
    return (
      <section className="character-card-settings" aria-label="角色卡设置">
        <p className="character-card-empty">正在加载角色卡…</p>
      </section>
    );
  }

  return (
    <section className="character-card-settings" aria-label="角色卡设置">
      {cards.length > 1 && (
        <div className="character-switcher" role="tablist" aria-label="选择角色">
          {cards.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={item.id === card.id}
              className={`character-switcher-item${item.id === card.id ? " is-active" : ""}`}
              onClick={() => setSelectedId(item.id)}
            >
              <Avatar className="character-switcher-avatar" size="sm">
                <Avatar.Image alt={item.name} src={item.assets.avatar} />
                <Avatar.Fallback>{item.name.slice(0, 1)}</Avatar.Fallback>
              </Avatar>
              <span className="character-switcher-name">{item.name}</span>
              <span className="character-switcher-tone">{item.tagline}</span>
            </button>
          ))}
        </div>
      )}

      <header className="character-card-summary" style={{ borderLeftColor: card.themeColor }}>
        <Avatar className="settings-character-avatar">
          <Avatar.Image alt={card.name} src={card.assets.avatar} />
          <Avatar.Fallback>{card.name.slice(0, 1)}</Avatar.Fallback>
        </Avatar>
        <div>
          <span>{card.relationship || "陪伴角色"}</span>
          <h3>{card.name}</h3>
          <p>{card.tagline}</p>
        </div>
      </header>

      <div className="character-card-grid">
        <article className="character-card-copy">
          <h4>人设</h4>
          <p>{card.persona}</p>
          <h4>背景</h4>
          <p>{card.storyBackground}</p>
          <h4>核心动机</h4>
          <p>{card.coreMotivation}</p>
          <h4>说话风格</h4>
          <p>{card.speakingStyle}</p>
          <h4>互动原则</h4>
          <ul className="character-card-list">
            {card.interactionPrinciples.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <h4>沉浸提示</h4>
          <ul className="character-card-list">
            {card.immersionCues.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <h4>初始问候</h4>
          <blockquote>{card.firstMessage}</blockquote>
        </article>

        <article className="character-visual-preview">
          <img alt="" className="settings-card-bg" src={card.assets.background} />
          <img alt={`${card.name} 立绘`} className="settings-card-portrait" src={card.assets.portrait} />
        </article>
      </div>

      <section className="settings-sticker-section" aria-label="九宫格表情">
        <div>
          <h4>九宫格表情</h4>
          <p>对话时由情绪节点决定是否偶尔发送。</p>
        </div>
        <div className="settings-sticker-grid">
          {card.stickers.map((sticker) => (
            <figure key={sticker.id}>
              <img alt={sticker.label} src={sticker.src} />
              <figcaption>{sticker.label}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <footer className="character-card-actions">
        <Chip className="provider-status" size="sm" variant="soft">
          {card.stickers.length} 个表情已就绪
        </Chip>
      </footer>
    </section>
  );
}
