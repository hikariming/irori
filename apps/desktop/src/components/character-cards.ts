import { convertFileSrc } from "@tauri-apps/api/core";

import {
  requiredStickerIds,
  stickerMeta,
  type CharacterChatPreview,
  type ChatSticker,
  type StickerId
} from "./chat-model.ts";

export type CharacterExample = {
  user: string;
  reply: string;
};

// 角色卡来源：内置（打包进 public/characters，只读）或用户（app_data_dir/user-characters，可增删改）。
export type CharacterCardOrigin = "bundled" | "user";

export type CharacterCard = {
  id: string;
  sourceName: string;
  name: string;
  localizedNames: Record<string, string>;
  persona: string;
  storyBackground: string;
  coreMotivation: string;
  speakingStyle: string;
  interactionPrinciples: string[];
  examples: CharacterExample[];
  themeColor: string;
  origin: CharacterCardOrigin;
  assets: {
    avatar: string;
    portrait: string;
    background: string;
  };
  stickers: ChatSticker[];
};

// 解析时把卡内相对资源路径转成可加载的 URL。内置卡用 fetch 路径，用户卡用 asset 协议。
type AssetResolver = (src: string) => string;

// 用户卡的资源解析器：把相对路径 join 到磁盘目录后过 convertFileSrc（asset://）；
// 已经是 data:/http:/绝对路径的（预览态或外链）原样返回。
function makeUserAssetResolver(dir: string): AssetResolver {
  return (src: string) => {
    if (!src || src.startsWith("data:") || src.startsWith("http") || src.startsWith("/")) {
      return src;
    }
    return convertFileSrc(`${dir}/${src}`);
  };
}

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

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const record: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" && item.trim().length > 0) {
      record[key] = item;
    }
  }
  return record;
}

function languageLookupChain(language: string): string[] {
  const normalized = language.trim();
  const base = normalized.split("-")[0] ?? normalized;
  return [normalized, base].filter((item, index, list) => item && list.indexOf(item) === index);
}

function parseExamples(value: unknown): CharacterExample[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      const entry = (item ?? {}) as Record<string, unknown>;
      return { user: asString(entry.user), reply: asString(entry.reply) };
    })
    .filter((example) => example.user.length > 0 && example.reply.length > 0);
}

function buildStickers(
  resolve: AssetResolver,
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
      src: resolve(asString(raw.src, `assets/stickers/${id}.png`)),
      textFallback: asString(raw.textFallback)
    };
  });
}

export type ParseCharacterCardOptions = {
  origin?: CharacterCardOrigin;
  // 自定义资源解析器；缺省时按内置卡的 /characters/<id>.card 路径解析。
  resolveAssetPath?: AssetResolver;
};

export function parseCharacterCard(
  characterId: string,
  raw: Record<string, unknown>,
  options: ParseCharacterCardOptions = {}
): CharacterCard {
  const basePath = cardBasePath(characterId);
  const resolve = options.resolveAssetPath ?? ((src: string) => resolveAsset(basePath, src));
  const identity = (raw.identity ?? {}) as Record<string, unknown>;
  const assets = (raw.assets ?? {}) as Record<string, unknown>;
  const rawStickers = Array.isArray(assets.stickers)
    ? (assets.stickers as Array<Record<string, unknown>>)
    : [];
  const sourceName = asString(raw.name, characterId);

  return {
    id: characterId,
    sourceName,
    name: sourceName,
    localizedNames: asStringRecord(raw.localizedNames),
    persona: asString(identity.persona),
    storyBackground: asString(identity.background),
    coreMotivation: asString(identity.coreMotivation),
    speakingStyle: asString(identity.speakingStyle),
    interactionPrinciples: asStringArray(identity.interactionPrinciples),
    examples: parseExamples(identity.examples),
    themeColor: asString(assets.themeColor, "#2f6f68"),
    origin: options.origin ?? "bundled",
    assets: {
      avatar: resolve(asString(assets.avatar, "assets/avatar/avatar-circle.png")),
      portrait: resolve(asString(assets.portrait, "assets/portraits/neutral.png")),
      background: resolve(asString(assets.background, "assets/backgrounds/default.png"))
    },
    stickers: buildStickers(resolve, rawStickers)
  };
}

export function localizeCharacterCard(card: CharacterCard, language: string): CharacterCard {
  for (const key of languageLookupChain(language)) {
    const name = card.localizedNames[key];
    if (name) {
      return { ...card, name };
    }
  }
  return { ...card, name: card.sourceName };
}

export function localizeCharacterCards(cards: CharacterCard[], language: string): CharacterCard[] {
  return cards.map((card) => localizeCharacterCard(card, language));
}

export function characterPromptName(card: CharacterCard): string {
  return card.sourceName || card.name;
}

export function buildCharacterChatPreview(card: CharacterCard): CharacterChatPreview {
  return {
    character: {
      id: card.id,
      name: card.name
    },
    assets: card.assets,
    stickers: card.stickers,
    messages: []
  };
}

// 生活圈里一条动态/一封信的「发件人」信息：头像 + 名字。
export type FeedAuthor = { name: string; avatar: string };

// 由角色卡构建「角色 id → 头像/名字」映射，给聚合的生活圈按发件人显示。
export function buildCharacterAuthors(cards: CharacterCard[]): Record<string, FeedAuthor> {
  const map: Record<string, FeedAuthor> = {};
  for (const card of cards) {
    map[card.id] = { name: card.name, avatar: card.assets.avatar };
  }
  return map;
}

const fallbackCharacterCard: CharacterCard = parseCharacterCard("shili", {
  name: "示璃",
  localizedNames: {
    en: "Shili",
    ja: "シーリー",
    ko: "시리"
  },
  identity: {
    persona: "冷静、细致、带一点柔和距离感的本地 AI 陪伴角色。"
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

async function loadBundledCards(fetchImpl: typeof fetch = fetch): Promise<CharacterCard[]> {
  const ids = await loadCharacterManifest(fetchImpl);
  const cards = await Promise.all(
    ids.map((id) => loadCharacterCard(id, fetchImpl).catch(() => null))
  );
  return cards.filter((card): card is CharacterCard => card !== null);
}

// 用户卡来源：只依赖 listUserCharacters，避免与 desktop-backend 形成模块环。
export type UserCardSource = {
  listUserCharacters: () => Promise<Array<{ id: string; dir: string; card: Record<string, unknown> }>>;
};

async function loadUserCards(source: UserCardSource): Promise<CharacterCard[]> {
  try {
    const records = await source.listUserCharacters();
    return records.map((record) =>
      parseCharacterCard(record.id, record.card, {
        origin: "user",
        resolveAssetPath: makeUserAssetResolver(record.dir)
      })
    );
  } catch {
    return [];
  }
}

// 合并内置卡与用户卡：内置优先，用户卡里 id 已被内置占用的丢弃（与 Rust 侧的去重一致）。
export async function loadCharacterCards(
  source?: UserCardSource | null,
  fetchImpl: typeof fetch = fetch
): Promise<CharacterCard[]> {
  try {
    const bundled = await loadBundledCards(fetchImpl);
    const user = source ? await loadUserCards(source) : [];
    const seen = new Set(bundled.map((card) => card.id));
    const merged = [...bundled, ...user.filter((card) => !seen.has(card.id))];
    return merged.length > 0 ? merged : [fallbackCharacterCard];
  } catch {
    return [fallbackCharacterCard];
  }
}
