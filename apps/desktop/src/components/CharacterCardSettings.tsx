import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, Button, Chip } from "@heroui/react";

import { CharacterSkillsSection } from "./CharacterSkillsSection";
import { CharacterCardEditor } from "./CharacterCardEditor";
import { findCharacterCard, type CharacterCard } from "./character-cards";
import { desktopBackend, isDesktopRuntime } from "./desktop-backend";
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
  // 增删改/导入后通知上层重载角色卡，使聊天立即用上新卡。
  onCardsChanged?: () => void | Promise<void>;
};

type EditorState =
  | { mode: "create" }
  | { mode: "edit"; card: Record<string, unknown> }
  | null;

// 返回 characterCard:status.* 的 key，文案在组件里用 t() 渲染。
function listItemStatusKey(pref: CharacterPreference): string {
  if (!pref.enabled) {
    return "disabled";
  }
  return pref.showInSidebar ? "visible" : "hidden";
}

function extFromUrl(url: string): string {
  const clean = url.split("?")[0]?.split("#")[0] ?? url;
  const ext = clean.split(".").pop()?.toLowerCase() ?? "";
  return ext === "jpg" || ext === "jpeg" || ext === "webp" ? ext : "png";
}

function uniqueDuplicateId(baseId: string, existing: Set<string>): string {
  const base = `${baseId}-copy`;
  if (!existing.has(base)) {
    return base;
  }
  let n = 2;
  while (existing.has(`${base}-${n}`)) {
    n += 1;
  }
  return `${base}-${n}`;
}

export function CharacterCardSettings({
  cards,
  activeCharacterId = "shili",
  preferences = {},
  states = {},
  onPreferenceChange,
  onCardsChanged
}: CharacterCardSettingsProps) {
  const { t } = useTranslation("characterCard");
  const [selectedId, setSelectedId] = useState(activeCharacterId);
  const [editor, setEditor] = useState<EditorState>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [docOpen, setDocOpen] = useState(false);
  const [docText, setDocText] = useState<string>("");

  const card = findCharacterCard(cards, selectedId) ?? cards[0] ?? null;
  const existingIds = useMemo(() => cards.map((item) => item.id), [cards]);

  useEffect(() => {
    setSelectedId(activeCharacterId);
  }, [activeCharacterId]);

  useEffect(() => {
    if (!docOpen || docText) {
      return;
    }
    fetch("/docs/character-card-authoring.md")
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error())))
      .then((text) => setDocText(text))
      .catch(() => setDocText(t("doc.loadFailed")));
  }, [docOpen, docText, t]);

  async function runAction(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function openEdit(target: CharacterCard) {
    await runAction(async () => {
      const records = await desktopBackend.listUserCharacters();
      const record = records.find((item) => item.id === target.id);
      if (!record) {
        throw new Error(t("manage.missingUserCard"));
      }
      setEditor({ mode: "edit", card: record.card });
    });
  }

  function handleDelete(target: CharacterCard) {
    if (!globalThis.confirm(t("manage.deleteConfirm", { name: target.name }))) {
      return;
    }
    void runAction(async () => {
      await desktopBackend.deleteUserCharacter(target.id);
      await onCardsChanged?.();
      setNotice(t("manage.deleted", { name: target.name }));
    });
  }

  function handleExport(target: CharacterCard) {
    void runAction(async () => {
      const path = await desktopBackend.exportCharacterCard(target.id);
      if (path) {
        setNotice(t("manage.exported", { path }));
      }
    });
  }

  function handleImport() {
    void runAction(async () => {
      const record = await desktopBackend.importCharacterCard();
      if (record) {
        await onCardsChanged?.();
        setSelectedId(record.id);
        setNotice(t("manage.imported", { id: record.id }));
      }
    });
  }

  function handleDuplicate(target: CharacterCard) {
    void runAction(async () => {
      const raw = (await fetch(`/characters/${target.id}.card/card.json`).then((response) =>
        response.json()
      )) as Record<string, unknown>;
      const newId = uniqueDuplicateId(target.id, new Set(existingIds));
      await desktopBackend.createUserCharacter({ id: newId, card: { ...raw, id: newId } });
      const jobs: Array<{ slot: string; url: string }> = [
        { slot: "avatar", url: target.assets.avatar },
        { slot: "portrait", url: target.assets.portrait },
        { slot: "background", url: target.assets.background },
        ...target.stickers.map((sticker) => ({ slot: `sticker:${sticker.id}`, url: sticker.src }))
      ];
      for (const job of jobs) {
        const buffer = await fetch(job.url).then((response) => response.arrayBuffer());
        await desktopBackend.saveUserCharacterAsset({
          id: newId,
          slot: job.slot,
          bytes: Array.from(new Uint8Array(buffer)),
          ext: extFromUrl(job.url)
        });
      }
      await onCardsChanged?.();
      setSelectedId(newId);
      setNotice(t("manage.duplicated", { id: newId }));
    });
  }

  const toolbar = (
    <div className="character-card-toolbar" role="group" aria-label={t("manage.toolbarAria")}>
      <Button size="sm" variant="primary" isDisabled={busy} onPress={() => setEditor({ mode: "create" })}>
        {t("manage.create")}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        isDisabled={busy || !isDesktopRuntime}
        onPress={handleImport}
      >
        {t("manage.import")}
      </Button>
      <Button size="sm" variant="secondary" isDisabled={busy} onPress={() => setDocOpen(true)}>
        {t("manage.howToCreate")}
      </Button>
      <a className="character-card-template" href="/templates/blank.card.zip" download>
        {t("manage.downloadTemplate")}
      </a>
      {!isDesktopRuntime ? <small className="character-card-hint">{t("manage.desktopOnly")}</small> : null}
    </div>
  );

  if (!card) {
    return (
      <section className="character-card-settings" aria-label={t("settingsAria")}>
        {toolbar}
        <p className="character-card-empty">{t("loading")}</p>
        {editor ? (
          <CharacterCardEditor
            mode={editor.mode}
            initialCard={editor.mode === "edit" ? editor.card : null}
            existingIds={existingIds}
            onClose={() => setEditor(null)}
            onSaved={async () => {
              await onCardsChanged?.();
            }}
          />
        ) : null}
      </section>
    );
  }

  const selectedPref = getCharacterPreference(preferences, card.id);
  const stateView = buildCharacterStateView(getCharacterState(states, card.id));
  const isUserCard = card.origin === "user";

  return (
    <section className="character-card-settings" aria-label={t("settingsAria")}>
      {toolbar}
      {error ? <p className="character-card-status is-error">{error}</p> : null}
      {notice ? <p className="character-card-status">{notice}</p> : null}

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
                  <small>
                    {item.origin === "user" ? `${t("manage.userBadge")} · ` : ""}
                    {t(`status.${listItemStatusKey(pref)}`)}
                  </small>
                </span>
              </button>
            );
          })}
        </aside>

        <div className="character-card-detail">
          <div className="character-card-actions-bar" role="group" aria-label={t("manage.actionsAria")}>
            <Chip size="sm" variant="soft">
              {isUserCard ? t("manage.userBadge") : t("manage.bundledBadge")}
            </Chip>
            {isUserCard ? (
              <>
                <Button size="sm" variant="secondary" isDisabled={busy} onPress={() => void openEdit(card)}>
                  {t("manage.edit")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  isDisabled={busy || !isDesktopRuntime}
                  onPress={() => handleExport(card)}
                >
                  {t("manage.export")}
                </Button>
                <Button size="sm" variant="danger-soft" isDisabled={busy} onPress={() => handleDelete(card)}>
                  {t("manage.delete")}
                </Button>
              </>
            ) : (
              <Button size="sm" variant="secondary" isDisabled={busy} onPress={() => handleDuplicate(card)}>
                {t("manage.duplicate")}
              </Button>
            )}
          </div>

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
                <strong>{t(`common:characterState.affinityTier.${stateView.affinityTier}`)}</strong>
              </div>
              <div className="character-state-bar" role="presentation">
                <span style={{ width: `${stateView.affinity}%`, backgroundColor: card.themeColor }} />
              </div>
            </div>
            <dl className="character-state-metrics">
              <div>
                <dt>{t("mood")}</dt>
                <dd>{t(`common:characterState.mood.${stateView.mood}`)}</dd>
              </div>
              <div>
                <dt>{t("energy")}</dt>
                <dd>{t(`common:characterState.energy.${stateView.energyLevel}`)}</dd>
              </div>
              <div>
                <dt>{t("meet")}</dt>
                <dd>{stateView.meetCount > 0 ? t("common:characterState.meet", { count: stateView.meetCount }) : t("common:characterState.meetNone")}</dd>
              </div>
            </dl>
          </section>

          {stateView.impressions.length > 0 ? (
            <section className="character-impressions" aria-label={t("impressionsAria")}>
              <h4>{t("remembersTitle", { name: card.name })}</h4>
              <ul>
                {stateView.impressions.map((impression) => (
                  <li key={impression.id}>
                    <span className="character-impression-kind">{t(`common:characterState.impressionKind.${impression.kind}`)}</span>
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

      {editor ? (
        <CharacterCardEditor
          mode={editor.mode}
          initialCard={editor.mode === "edit" ? editor.card : null}
          existingIds={existingIds}
          onClose={() => setEditor(null)}
          onSaved={async (id) => {
            await onCardsChanged?.();
            setSelectedId(id);
          }}
        />
      ) : null}

      {docOpen ? (
        <div className="cc-editor-overlay" role="dialog" aria-modal="true">
          <div className="cc-editor-modal cc-doc-modal">
            <header className="cc-editor-header">
              <h3>{t("doc.title")}</h3>
              <Button size="sm" variant="ghost" onPress={() => setDocOpen(false)}>
                {t("doc.close")}
              </Button>
            </header>
            <pre className="cc-doc-body">{docText || t("doc.loading")}</pre>
          </div>
        </div>
      ) : null}
    </section>
  );
}
