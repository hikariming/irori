import type { CharacterCard } from "./character-cards.ts";
import { lifeBeatAt, type CharacterState, type Mood } from "./character-state.ts";

// 角色自己发的一条「朋友圈/动态」。结构化、可序列化、无向量（保持 FTS-only 理念）。
export type MomentActorType = "user" | "character";

export type MomentActorRef = {
  actorType: MomentActorType;
  actorId: string;
};

export type MomentLike = MomentActorRef & {
  createdAt: number;
};

export type MomentComment = MomentActorRef & {
  id: string;
  text: string;
  createdAt: number;
};

export type CharacterMoment = {
  id: string;
  characterId: string;
  text: string;
  createdAt: number; // 发布时间戳（ms）
  likes: MomentLike[];
  comments: MomentComment[];
};

// 两条动态之间至少间隔这么久，避免一打开就刷屏。
export const MIN_MOMENT_GAP_MS = 3 * 60 * 60 * 1000;
// 精力低于这个值就懒得发动态了（太累）。
const MOMENT_ENERGY_FLOOR = 15;
// 动态正文长度上限，超出截断。
const MAX_MOMENT_LENGTH = 140;

// 决定此刻这个角色要不要发一条动态：距上次够久，且没累趴下。
export function shouldPostMoment(
  state: CharacterState,
  lastMomentAt: number | null,
  now: number
): boolean {
  if (state.energy < MOMENT_ENERGY_FLOOR) {
    return false;
  }
  if (lastMomentAt !== null && now - lastMomentAt < MIN_MOMENT_GAP_MS) {
    return false;
  }
  return true;
}

const moodHint: Record<Mood, string> = {
  calm: "平静",
  warm: "心里暖暖的",
  playful: "有点俏皮想闹",
  tired: "有点累",
  guarded: "情绪有点低，想自己待会儿"
};

// 生成「让角色发一条动态」的一次性 prompt。它独立于聊天，不应提到用户或对话。
// 传入 activity（来自当天作息脚本的「此刻在干嘛」）时，动态就围绕这件事写，让虚拟生活落到动态上。
export function composeMomentPrompt(
  card: CharacterCard,
  state: CharacterState,
  now: number,
  activity?: string
): string {
  const situation = activity?.trim() || lifeBeatAt(new Date(now)).activity;

  return [
    `你是 ${card.name}。`,
    `人设：${card.persona}`,
    `说话风格：${card.speakingStyle}`,
    "",
    "现在请你像发一条朋友圈/动态那样，写下此刻你自己的生活片段或心情。",
    `此刻你正在：${situation}`,
    `此刻的心情：${moodHint[state.mood]}。`,
    "",
    "要求：",
    "- 用第一人称，像随手发的一条动态，1 到 2 句话，自然口语。",
    "- 围绕你此刻正在做的事来写，写你自己的生活、所见、所想或心情，不要提到「用户」「你」，也不要像在对谁说话。",
    "- 不要解释设定，不要出现任何数字或系统字样，不要用 Markdown。",
    "- 只输出动态正文本身。"
  ].join("\n");
}

const stickerMarkerPattern = /\[sticker:[a-z-]+\]/gi;
const memoryMarkerPattern = /\[memory:(?:like|dislike|fact|grudge)\][^\n]*/gi;

// 把模型输出清洗成纯动态正文：去掉表情/记忆标记、收敛空行、截断。
export function parseMomentText(reply: string): string {
  const text = reply
    .replace(memoryMarkerPattern, "")
    .replace(stickerMarkerPattern, "")
    .replace(/\n{2,}/g, "\n")
    .trim();

  if (text.length <= MAX_MOMENT_LENGTH) {
    return text;
  }
  return `${text.slice(0, MAX_MOMENT_LENGTH).trim()}…`;
}

// 把发布时间翻译成动态流里的相对时间标签。
export function formatMomentTime(createdAt: number, now: number): string {
  const diff = Math.max(0, now - createdAt);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) {
    return "刚刚";
  }
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时前`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days} 天前`;
  }
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(new Date(createdAt));
}

const actorTypes: MomentActorType[] = ["user", "character"];

function toFiniteNumber(value: unknown, fallback: number): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function sanitizeActor(entry: Record<string, unknown>): MomentActorRef | null {
  if (!actorTypes.includes(entry.actorType as MomentActorType) || typeof entry.actorId !== "string" || !entry.actorId.trim()) {
    return null;
  }
  return {
    actorType: entry.actorType as MomentActorType,
    actorId: entry.actorId.trim()
  };
}

function sanitizeLikes(value: unknown): MomentLike[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const likes: MomentLike[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const entry = raw as Record<string, unknown>;
    const actor = sanitizeActor(entry);
    if (!actor) {
      continue;
    }
    likes.push({ ...actor, createdAt: toFiniteNumber(entry.createdAt, 0) });
  }
  return likes.sort((a, b) => a.createdAt - b.createdAt);
}

function sanitizeComments(value: unknown): MomentComment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const comments: MomentComment[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const entry = raw as Record<string, unknown>;
    const actor = sanitizeActor(entry);
    const text = typeof entry.text === "string" ? entry.text.trim() : "";
    if (!actor || typeof entry.id !== "string" || !entry.id || !text) {
      continue;
    }
    comments.push({
      ...actor,
      id: entry.id,
      text,
      createdAt: toFiniteNumber(entry.createdAt, 0)
    });
  }
  return comments.sort((a, b) => a.createdAt - b.createdAt);
}

export function hasMomentLike(moment: CharacterMoment, actor: MomentActorRef): boolean {
  return moment.likes.some((like) => like.actorType === actor.actorType && like.actorId === actor.actorId);
}

// 校验后端返回的动态数组，丢弃无效项，按时间倒序。
export function sanitizeMoments(value: unknown): CharacterMoment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: CharacterMoment[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const entry = raw as Record<string, unknown>;
    if (typeof entry.id !== "string" || typeof entry.characterId !== "string" || typeof entry.text !== "string") {
      continue;
    }
    const text = entry.text.trim();
    if (!text) {
      continue;
    }
    const createdAt = toFiniteNumber(entry.createdAt, 0);
    result.push({
      id: entry.id,
      characterId: entry.characterId,
      text,
      createdAt,
      likes: sanitizeLikes(entry.likes),
      comments: sanitizeComments(entry.comments)
    });
  }

  return result.sort((a, b) => b.createdAt - a.createdAt);
}
