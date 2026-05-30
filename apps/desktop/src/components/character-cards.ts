import {
  requiredStickerIds,
  stickerMeta,
  type CharacterChatPreview,
  type ChatSticker,
  type StickerId
} from "./chat-model.ts";

export type CharacterCard = {
  id: string;
  name: string;
  tagline: string;
  relationship: string;
  persona: string;
  storyBackground: string;
  coreMotivation: string;
  speakingStyle: string;
  firstMessage: string;
  interactionPrinciples: string[];
  immersionCues: string[];
  themeColor: string;
  assets: {
    avatar: string;
    portrait: string;
    background: string;
  };
  stickers: ChatSticker[];
};

function cardBasePath(characterId: string) {
  return `/characters/${characterId}.card`;
}

function resolveAsset(basePath: string, src: string) {
  return src.startsWith("/") || src.startsWith("http") ? src : `${basePath}/${src}`;
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function buildStickers(
  basePath: string,
  rawStickers: Array<Record<string, unknown>>
): ChatSticker[] {
  const byId = new Map(rawStickers.map((sticker) => [asString(sticker.id), sticker] as const));

  return requiredStickerIds.map((id) => {
    const raw = byId.get(id) ?? {};
    const meta = stickerMeta[id];

    return {
      id,
      emotion: id,
      intent: meta.intent,
      label: meta.label,
      src: resolveAsset(basePath, asString(raw.src, `assets/stickers/${id}.png`)),
      textFallback: asString(raw.textFallback)
    };
  });
}

export function parseCharacterCard(characterId: string, raw: Record<string, unknown>): CharacterCard {
  const basePath = cardBasePath(characterId);
  const identity = (raw.identity ?? {}) as Record<string, unknown>;
  const assets = (raw.assets ?? {}) as Record<string, unknown>;
  const rawStickers = Array.isArray(assets.stickers)
    ? (assets.stickers as Array<Record<string, unknown>>)
    : [];

  return {
    id: characterId,
    name: asString(raw.name, characterId),
    tagline: asString(raw.tagline),
    relationship: asString(identity.relationship),
    persona: asString(identity.persona),
    storyBackground: asString(identity.background),
    coreMotivation: asString(identity.coreMotivation),
    speakingStyle: asString(identity.speakingStyle),
    firstMessage: asString(identity.firstMessage),
    interactionPrinciples: asStringArray(identity.interactionPrinciples),
    immersionCues: asStringArray(identity.immersionCues),
    themeColor: asString(assets.themeColor, "#2f6f68"),
    assets: {
      avatar: resolveAsset(basePath, asString(assets.avatar, "assets/avatar/avatar-circle.png")),
      portrait: resolveAsset(basePath, asString(assets.portrait, "assets/portraits/neutral.png")),
      background: resolveAsset(basePath, asString(assets.background, "assets/backgrounds/default.png"))
    },
    stickers: buildStickers(basePath, rawStickers)
  };
}

export function buildCharacterChatPreview(card: CharacterCard): CharacterChatPreview {
  return {
    character: {
      id: card.id,
      name: card.name,
      tagline: card.tagline,
      relationship: card.relationship
    },
    assets: card.assets,
    stickers: card.stickers,
    messages: []
  };
}

const fallbackCharacterCard: CharacterCard = parseCharacterCard("shili", {
  name: "示璃",
  tagline: "安静但可靠的本地陪伴",
  identity: {
    relationship: "可信赖的陪伴型协作者",
    persona: "冷静、细致、带一点柔和距离感的本地 AI 陪伴角色。",
    firstMessage: "我在。今天想先聊聊，还是直接一起处理一件事？"
  }
});

export function findCharacterCard(cards: CharacterCard[], characterId: string): CharacterCard | null {
  return cards.find((card) => card.id === characterId) ?? null;
}

export async function loadCharacterManifest(fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const response = await fetchImpl("/characters/manifest.json");
  if (!response.ok) {
    throw new Error(`manifest.json responded ${response.status}`);
  }
  const raw = (await response.json()) as { characters?: unknown };
  return asStringArray(raw.characters);
}

export async function loadCharacterCard(
  characterId: string,
  fetchImpl: typeof fetch = fetch
): Promise<CharacterCard> {
  const response = await fetchImpl(`${cardBasePath(characterId)}/card.json`);
  if (!response.ok) {
    throw new Error(`card.json responded ${response.status}`);
  }
  const raw = (await response.json()) as Record<string, unknown>;
  return parseCharacterCard(characterId, raw);
}

export async function loadCharacterCards(fetchImpl: typeof fetch = fetch): Promise<CharacterCard[]> {
  try {
    const ids = await loadCharacterManifest(fetchImpl);
    const cards = await Promise.all(
      ids.map((id) => loadCharacterCard(id, fetchImpl).catch(() => null))
    );
    const loaded = cards.filter((card): card is CharacterCard => card !== null);
    return loaded.length > 0 ? loaded : [fallbackCharacterCard];
  } catch {
    return [fallbackCharacterCard];
  }
}
