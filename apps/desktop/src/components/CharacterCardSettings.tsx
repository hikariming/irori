import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, Chip } from "@heroui/react";

import { CharacterSkillsSection } from "./CharacterSkillsSection";
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

// 返回 characterCard:status.* 的 key，文案在组件里用 t() 渲染。
function listItemStatusKey(pref: CharacterPreference): string {
  if (!pref.enabled) {
    return "disabled";
  }
  return pref.showInSidebar ? "visible" : "hidden";
}

export function CharacterCardSettings({
  cards,
  activeCharacterId = "shili",
  preferences = {},
  states = {},
  onPreferenceChange
}: CharacterCardSettingsProps) {
  const { t } = useTranslation("characterCard");
  const [selectedId, setSelectedId] = useState(activeCharacterId);
  const card = findCharacterCard(cards, selectedId) ?? cards[0] ?? null;

  useEffect(() => {
    setSelectedId(activeCharacterId);
  }, [activeCharacterId]);

  if (!card) {
    return (
      <section className="character-card-settings" aria-label={t("settingsAria")}>
        <p className="character-card-empty">{t("loading")}</p>
      </section>
    );
  }

  const selectedPref = getCharacterPreference(preferences, card.id);
  const stateView = buildCharacterStateView(getCharacterState(states, card.id));

  return (
    <section className="character-card-settings" aria-label={t("settingsAria")}>
      <div className="character-card-layout">
        <aside className="character-card-list" role="tablist" aria-label={t("listAria")}>
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
                  <small>{t(`status.${listItemStatusKey(pref)}`)}</small>
                </span>
              </button>
            );
          })}
        </aside>

        <div className="character-card-detail">
          <div className="character-card-toggles" role="group" aria-label={t("togglesAria")}>
            <label className="character-card-toggle">
              <input
                type="checkbox"
                checked={selectedPref.enabled}
                onChange={(event) => onPreferenceChange?.(card.id, { enabled: event.target.checked })}
              />
              <span>
                <strong>{t("enableCharacter")}</strong>
                <small>{t("enableCharacterHint")}</small>
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
                <strong>{t("showInSidebar")}</strong>
                <small>{t("showInSidebarHint")}</small>
              </span>
            </label>
          </div>

          <CharacterSkillsSection characterId={card.id} characterName={card.name} />

          <header className="character-card-summary" style={{ borderLeftColor: card.themeColor }}>
            <Avatar className="settings-character-avatar">
              <Avatar.Image alt={card.name} src={card.assets.avatar} />
              <Avatar.Fallback>{card.name.slice(0, 1)}</Avatar.Fallback>
            </Avatar>
            <div>
              <h3>{card.name}</h3>
            </div>
          </header>

          <section className="character-state-strip" aria-label={t("stateAria")}>
            <div className="character-state-affinity">
              <div className="character-state-affinity-head">
                <span>{t("affinity")}</span>
                <strong>{stateView.affinityTierLabel}</strong>
              </div>
              <div className="character-state-bar" role="presentation">
                <span style={{ width: `${stateView.affinity}%`, backgroundColor: card.themeColor }} />
              </div>
            </div>
            <dl className="character-state-metrics">
              <div>
                <dt>{t("mood")}</dt>
                <dd>{stateView.moodLabel}</dd>
              </div>
              <div>
                <dt>{t("energy")}</dt>
                <dd>{stateView.energyLabel}</dd>
              </div>
              <div>
                <dt>{t("meet")}</dt>
                <dd>{stateView.meetLabel}</dd>
              </div>
            </dl>
          </section>

          {stateView.impressions.length > 0 ? (
            <section className="character-impressions" aria-label={t("impressionsAria")}>
              <h4>{t("remembersTitle", { name: card.name })}</h4>
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
              <h4>{t("persona")}</h4>
              <p>{card.persona}</p>
              <h4>{t("background")}</h4>
              <p>{card.storyBackground}</p>
              <h4>{t("coreMotivation")}</h4>
              <p>{card.coreMotivation}</p>
              <h4>{t("speakingStyle")}</h4>
              <p>{card.speakingStyle}</p>
              <h4>{t("interactionPrinciples")}</h4>
              <ul className="character-card-list-principles">
                {card.interactionPrinciples.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <h4>{t("examples")}</h4>
              <ul className="character-card-list-principles">
                {card.examples.map((example) => (
                  <li key={example.user}>
                    <span className="character-example-user">{t("exampleUser")}{example.user}</span>
                    <span className="character-example-reply">{card.name}：{example.reply}</span>
                  </li>
                ))}
              </ul>
            </article>

            <article className="character-visual-preview">
              <img alt="" className="settings-card-bg" src={card.assets.background} />
              <img alt={t("portraitAlt", { name: card.name })} className="settings-card-portrait" src={card.assets.portrait} />
            </article>
          </div>

          <section className="settings-sticker-section" aria-label={t("stickersAria")}>
            <div>
              <h4>{t("stickersTitle")}</h4>
              <p>{t("stickersHint")}</p>
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
              {t("stickersReady", { count: card.stickers.length })}
            </Chip>
          </footer>
        </div>
      </div>
    </section>
  );
}
