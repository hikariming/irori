import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@heroui/react";

import { desktopBackend } from "./desktop-backend";
import { requiredStickerIds, stickerMeta, type StickerId } from "./chat-model";
import { isValidCharacterId } from "./character-card-format";

// 编辑器一次能上传的 12 个资源槽：3 张主图 + 9 张表情。
type AssetSlot = "avatar" | "portrait" | "background" | `sticker:${StickerId}`;

const ALLOWED_IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp"]);

type StagedAsset = { bytes: number[]; ext: string; previewUrl: string };

type ExampleRow = { user: string; reply: string };

type EditorForm = {
  id: string;
  name: string;
  nameEn: string;
  nameJa: string;
  nameKo: string;
  persona: string;
  background: string;
  coreMotivation: string;
  speakingStyle: string;
  interactionPrinciples: string;
  examples: ExampleRow[];
  themeColor: string;
};

export type CharacterCardEditorProps = {
  mode: "create" | "edit";
  // 编辑态传入原始 card.json（保留资源相对路径与嵌套结构）；新建态为空。
  initialCard?: Record<string, unknown> | null;
  // 已占用的 id（内置 + 用户），用于新建时查重。
  existingIds: string[];
  onClose: () => void;
  onSaved: (id: string) => void | Promise<void>;
};

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function defaultAssets(): Record<string, unknown> {
  return {
    avatar: "assets/avatar/avatar-circle.png",
    portrait: "assets/portraits/neutral.png",
    background: "assets/backgrounds/default.png",
    themeColor: "#2f6f68",
    stickers: requiredStickerIds.map((id) => ({ id, src: `assets/stickers/${id}.png` }))
  };
}

// 编辑态资源以原 card.json 为准并补齐缺失的贴纸，避免改文字时丢路径。
function mergeAssets(raw: unknown): Record<string, unknown> {
  const base = defaultAssets();
  if (!raw || typeof raw !== "object") {
    return base;
  }
  const source = raw as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...base, ...source };
  const byId = new Map(
    (Array.isArray(source.stickers) ? source.stickers : [])
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => [asString(item.id), item] as const)
  );
  merged.stickers = requiredStickerIds.map(
    (id) => byId.get(id) ?? { id, src: `assets/stickers/${id}.png` }
  );
  return merged;
}

function formFromCard(card: Record<string, unknown> | null | undefined): EditorForm {
  const identity = (card?.identity ?? {}) as Record<string, unknown>;
  const localized = (card?.localizedNames ?? {}) as Record<string, unknown>;
  const assets = (card?.assets ?? {}) as Record<string, unknown>;
  const principles = Array.isArray(identity.interactionPrinciples)
    ? identity.interactionPrinciples.filter((item): item is string => typeof item === "string")
    : [];
  const examples = Array.isArray(identity.examples)
    ? identity.examples
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .map((item) => ({ user: asString(item.user), reply: asString(item.reply) }))
    : [];
  return {
    id: asString(card?.id),
    name: asString(card?.name),
    nameEn: asString(localized.en),
    nameJa: asString(localized.ja),
    nameKo: asString(localized.ko),
    persona: asString(identity.persona),
    background: asString(identity.background),
    coreMotivation: asString(identity.coreMotivation),
    speakingStyle: asString(identity.speakingStyle),
    interactionPrinciples: principles.join("\n"),
    examples: examples.length > 0 ? examples : [{ user: "", reply: "" }],
    themeColor: asString(assets.themeColor, "#2f6f68")
  };
}

export function CharacterCardEditor({
  mode,
  initialCard,
  existingIds,
  onClose,
  onSaved
}: CharacterCardEditorProps) {
  const { t } = useTranslation("characterCard");
  const [form, setForm] = useState<EditorForm>(() => formFromCard(initialCard));
  const [staged, setStaged] = useState<Partial<Record<AssetSlot, StagedAsset>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const baseAssets = useMemo(() => mergeAssets(initialCard?.assets), [initialCard]);
  const takenIds = useMemo(
    () => new Set(existingIds.filter((id) => id !== form.id)),
    [existingIds, form.id]
  );

  function patch(patchValue: Partial<EditorForm>) {
    setForm((current) => ({ ...current, ...patchValue }));
  }

  function updateExample(index: number, patchValue: Partial<ExampleRow>) {
    setForm((current) => ({
      ...current,
      examples: current.examples.map((row, position) =>
        position === index ? { ...row, ...patchValue } : row
      )
    }));
  }

  async function onPickImage(slot: AssetSlot, file: File | null) {
    if (!file) {
      return;
    }
    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    if (!ALLOWED_IMAGE_EXTS.has(ext)) {
      setError(t("editor.errorImageExt"));
      return;
    }
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    setStaged((current) => ({
      ...current,
      [slot]: { bytes, ext, previewUrl: URL.createObjectURL(file) }
    }));
  }

  function buildCardJson(id: string): Record<string, unknown> {
    const localizedNames: Record<string, string> = {};
    if (form.nameEn.trim()) localizedNames.en = form.nameEn.trim();
    if (form.nameJa.trim()) localizedNames.ja = form.nameJa.trim();
    if (form.nameKo.trim()) localizedNames.ko = form.nameKo.trim();
    const interactionPrinciples = form.interactionPrinciples
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const examples = form.examples
      .map((row) => ({ user: row.user.trim(), reply: row.reply.trim() }))
      .filter((row) => row.user && row.reply);
    return {
      id,
      name: form.name.trim() || id,
      localizedNames,
      identity: {
        persona: form.persona.trim(),
        background: form.background.trim(),
        coreMotivation: form.coreMotivation.trim(),
        speakingStyle: form.speakingStyle.trim(),
        interactionPrinciples,
        examples
      },
      assets: { ...baseAssets, themeColor: form.themeColor || "#2f6f68" }
    };
  }

  function validate(id: string): string | null {
    if (mode === "create") {
      if (!id) return t("editor.errorIdRequired");
      if (!isValidCharacterId(id)) return t("editor.errorIdInvalid");
      if (takenIds.has(id)) return t("editor.errorIdTaken");
    }
    if (!form.persona.trim()) return t("editor.errorPersona");
    if (!form.speakingStyle.trim()) return t("editor.errorSpeakingStyle");
    return null;
  }

  async function onSubmit() {
    const id = mode === "create" ? form.id.trim() : asString(initialCard?.id, form.id.trim());
    const message = validate(id);
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const card = buildCardJson(id);
      if (mode === "create") {
        await desktopBackend.createUserCharacter({ id, card });
      } else {
        await desktopBackend.updateUserCharacter({ id, card });
      }
      // 图片在卡建立后逐张上传；Rust 会把 card.json 的资源路径指向真实文件。
      for (const slot of Object.keys(staged) as AssetSlot[]) {
        const asset = staged[slot];
        if (asset) {
          await desktopBackend.saveUserCharacterAsset({ id, slot, bytes: asset.bytes, ext: asset.ext });
        }
      }
      await onSaved(id);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const imageSlots: Array<{ slot: AssetSlot; label: string }> = [
    { slot: "avatar", label: t("editor.avatar") },
    { slot: "portrait", label: t("editor.portrait") },
    { slot: "background", label: t("editor.backgroundImage") },
    ...requiredStickerIds.map((id) => ({
      slot: `sticker:${id}` as AssetSlot,
      label: stickerMeta[id].label
    }))
  ];

  return (
    <div className="cc-editor-overlay" role="dialog" aria-modal="true">
      <div className="cc-editor-modal">
        <header className="cc-editor-header">
          <h3>{mode === "create" ? t("editor.createTitle") : t("editor.editTitle")}</h3>
          <Button size="sm" variant="ghost" onPress={onClose}>
            {t("editor.cancel")}
          </Button>
        </header>

        <div className="cc-editor-body">
          {mode === "create" ? (
            <label className="settings-input">
              <span>{t("editor.id")}</span>
              <input
                value={form.id}
                placeholder="my-character"
                onChange={(event) => patch({ id: event.target.value })}
              />
              <small>{t("editor.idHint")}</small>
            </label>
          ) : null}

          <div className="cc-editor-row">
            <label className="settings-input">
              <span>{t("editor.name")}</span>
              <input value={form.name} onChange={(event) => patch({ name: event.target.value })} />
            </label>
            <label className="settings-input">
              <span>{t("editor.themeColor")}</span>
              <input
                type="color"
                value={form.themeColor}
                onChange={(event) => patch({ themeColor: event.target.value })}
              />
            </label>
          </div>

          <div className="cc-editor-row">
            <label className="settings-input">
              <span>{t("editor.nameEn")}</span>
              <input value={form.nameEn} onChange={(event) => patch({ nameEn: event.target.value })} />
            </label>
            <label className="settings-input">
              <span>{t("editor.nameJa")}</span>
              <input value={form.nameJa} onChange={(event) => patch({ nameJa: event.target.value })} />
            </label>
            <label className="settings-input">
              <span>{t("editor.nameKo")}</span>
              <input value={form.nameKo} onChange={(event) => patch({ nameKo: event.target.value })} />
            </label>
          </div>

          <label className="settings-input">
            <span>{t("editor.persona")}</span>
            <textarea value={form.persona} rows={2} onChange={(event) => patch({ persona: event.target.value })} />
          </label>
          <label className="settings-input">
            <span>{t("editor.background")}</span>
            <textarea value={form.background} rows={2} onChange={(event) => patch({ background: event.target.value })} />
          </label>
          <label className="settings-input">
            <span>{t("editor.coreMotivation")}</span>
            <textarea value={form.coreMotivation} rows={2} onChange={(event) => patch({ coreMotivation: event.target.value })} />
          </label>
          <label className="settings-input">
            <span>{t("editor.speakingStyle")}</span>
            <textarea value={form.speakingStyle} rows={2} onChange={(event) => patch({ speakingStyle: event.target.value })} />
          </label>
          <label className="settings-input">
            <span>{t("editor.interactionPrinciples")}</span>
            <textarea
              value={form.interactionPrinciples}
              rows={3}
              onChange={(event) => patch({ interactionPrinciples: event.target.value })}
            />
          </label>

          <div className="cc-editor-examples">
            <span className="cc-editor-section-label">{t("editor.examples")}</span>
            {form.examples.map((row, index) => (
              <div key={index} className="cc-editor-example-row">
                <input
                  placeholder={t("editor.exampleUser")}
                  value={row.user}
                  onChange={(event) => updateExample(index, { user: event.target.value })}
                />
                <input
                  placeholder={t("editor.exampleReply")}
                  value={row.reply}
                  onChange={(event) => updateExample(index, { reply: event.target.value })}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={() =>
                    setForm((current) => ({
                      ...current,
                      examples: current.examples.filter((_, position) => position !== index)
                    }))
                  }
                >
                  {t("editor.removeExample")}
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              variant="secondary"
              onPress={() => setForm((current) => ({ ...current, examples: [...current.examples, { user: "", reply: "" }] }))}
            >
              {t("editor.addExample")}
            </Button>
          </div>

          <div className="cc-editor-images">
            <span className="cc-editor-section-label">{t("editor.images")}</span>
            <small>{t("editor.imagesHint")}</small>
            <div className="cc-editor-image-grid">
              {imageSlots.map(({ slot, label }) => {
                const preview = staged[slot]?.previewUrl;
                return (
                  <label key={slot} className="cc-image-slot">
                    {preview ? (
                      <img alt={label} src={preview} />
                    ) : (
                      <span className="cc-image-placeholder">{label}</span>
                    )}
                    <span className="cc-image-label">{label}</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(event) => onPickImage(slot, event.target.files?.[0] ?? null)}
                    />
                  </label>
                );
              })}
            </div>
          </div>

          {error ? <p className="cc-editor-error">{error}</p> : null}
        </div>

        <footer className="cc-editor-footer">
          <Button variant="ghost" onPress={onClose} isDisabled={busy}>
            {t("editor.cancel")}
          </Button>
          <Button variant="primary" onPress={onSubmit} isDisabled={busy}>
            {busy ? t("editor.saving") : t("editor.save")}
          </Button>
        </footer>
      </div>
    </div>
  );
}
