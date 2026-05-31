import { useEffect, useState } from "react";
import { Avatar, Chip } from "@heroui/react";

import { findCharacterCard, type CharacterCard } from "./character-cards";
import {
  getCharacterPreference,
  type CharacterPreference,
  type CharacterPreferences
} from "./character-preferences";
import {
  buildCharacterStateView,
  getCharacterState,
  type CharacterStates
} from "./character-state";

type CharacterCardSettingsProps = {
  cards: CharacterCard[];
  activeCharacterId?: string;
  preferences?: CharacterPreferences;
  states?: CharacterStates;
  onPreferenceChange?: (characterId: string, patch: Partial<CharacterPreference>) => void;
};

function listItemStatus(pref: CharacterPreference): string {
  if (!pref.enabled) {
    return "已关闭";
  }
  return pref.showInSidebar ? "侧边栏可见" : "已隐藏";
}

export function CharacterCardSettings({
  cards,
  activeCharacterId = "shili",
  preferences = {},
  states = {},
  onPreferenceChange
}: CharacterCardSettingsProps) {
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

  const selectedPref = getCharacterPreference(preferences, card.id);
  const stateView = buildCharacterStateView(getCharacterState(states, card.id));

  return (
    <section className="character-card-settings" aria-label="角色卡设置">
      <div className="character-card-layout">
        <aside className="character-card-list" role="tablist" aria-label="选择角色">
          {cards.map((item) => {
            const pref = getCharacterPreference(preferences, item.id);
            const isActive = item.id === card.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`character-card-list-item${isActive ? " is-active" : ""}${pref.enabled ? "" : " is-disabled"}`}
                onClick={() => setSelectedId(item.id)}
              >
                <Avatar className="character-card-list-avatar" size="sm">
                  <Avatar.Image alt={item.name} src={item.assets.avatar} />
                  <Avatar.Fallback>{item.name.slice(0, 1)}</Avatar.Fallback>
                </Avatar>
                <span className="character-card-list-copy">
                  <strong>{item.name}</strong>
                  <small>{listItemStatus(pref)}</small>
                </span>
              </button>
            );
          })}
        </aside>

        <div className="character-card-detail">
          <div className="character-card-toggles" role="group" aria-label="角色可用性">
            <label className="character-card-toggle">
              <input
                type="checkbox"
                checked={selectedPref.enabled}
                onChange={(event) => onPreferenceChange?.(card.id, { enabled: event.target.checked })}
              />
              <span>
                <strong>开启角色</strong>
                <small>关闭后该角色不会出现在侧边栏，也不参与后续的角色互动 / 自代理。</small>
              </span>
            </label>
            <label className={`character-card-toggle${selectedPref.enabled ? "" : " is-locked"}`}>
              <input
                type="checkbox"
                checked={selectedPref.enabled && selectedPref.showInSidebar}
                disabled={!selectedPref.enabled}
                onChange={(event) => onPreferenceChange?.(card.id, { showInSidebar: event.target.checked })}
              />
              <span>
                <strong>显示在侧边栏</strong>
                <small>仅控制左侧侧边栏列表是否展示，角色仍保持开启状态。</small>
              </span>
            </label>
          </div>

          <header className="character-card-summary" style={{ borderLeftColor: card.themeColor }}>
            <Avatar className="settings-character-avatar">
              <Avatar.Image alt={card.name} src={card.assets.avatar} />
              <Avatar.Fallback>{card.name.slice(0, 1)}</Avatar.Fallback>
            </Avatar>
            <div>
              <h3>{card.name}</h3>
            </div>
          </header>

          <section className="character-state-strip" aria-label="角色当前状态">
            <div className="character-state-affinity">
              <div className="character-state-affinity-head">
                <span>好感度</span>
                <strong>{stateView.affinityTierLabel}</strong>
              </div>
              <div className="character-state-bar" role="presentation">
                <span style={{ width: `${stateView.affinity}%`, backgroundColor: card.themeColor }} />
              </div>
            </div>
            <dl className="character-state-metrics">
              <div>
                <dt>心情</dt>
                <dd>{stateView.moodLabel}</dd>
              </div>
              <div>
                <dt>精力</dt>
                <dd>{stateView.energyLabel}</dd>
              </div>
              <div>
                <dt>相处</dt>
                <dd>{stateView.meetLabel}</dd>
              </div>
            </dl>
          </section>

          {stateView.impressions.length > 0 ? (
            <section className="character-impressions" aria-label="角色记得的事">
              <h4>{card.name} 记得的事</h4>
              <ul>
                {stateView.impressions.map((impression) => (
                  <li key={impression.id}>
                    <span className="character-impression-kind">{impression.kindLabel}</span>
                    <span className="character-impression-text">{impression.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

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
              <ul className="character-card-list-principles">
                {card.interactionPrinciples.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <h4>对话示例</h4>
              <ul className="character-card-list-principles">
                {card.examples.map((example) => (
                  <li key={example.user}>
                    <span className="character-example-user">用户：{example.user}</span>
                    <span className="character-example-reply">{card.name}：{example.reply}</span>
                  </li>
                ))}
              </ul>
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
        </div>
      </div>
    </section>
  );
}
