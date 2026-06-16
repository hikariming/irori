import { characterPromptName, type CharacterCard } from "./character-cards.ts";
import { affinityTier, lifeBeatAt, type CharacterState, type Mood } from "./character-state.ts";
import { formatMonthDayLong } from "../i18n/formatters.ts";

// 信物的寄出方：角色送来的，或（角色对用户回应的致意）。用户不再主动写信。
export type LetterSender = "character" | "user";

// 信物的三种形态：明信片 / 便利贴 / 小礼物。全部由角色主动送来。
export type KeepsakeKind = "postcard" | "note" | "gift";
export const KEEPSAKE_KINDS: KeepsakeKind[] = ["postcard", "note", "gift"];

// 生成期的类型字段：明信片带地点，礼物带物件名。
export type KeepsakeMeta = { place?: string; item?: string };

// 用户对一件信物的回应：一个表情 + 可选一句短话。
export type KeepsakeReaction = { emoji?: string; text?: string; at: number };

// 一件信物。结构化、可序列化、无向量（保持 FTS-only 理念）。
export type CharacterLetter = {
  id: string;
  characterId: string;
  subject: string;
  body: string;
  mood: Mood | null; // 送来这件信物时的心情，可为空
  createdAt: number; // 生成时间戳（ms）
  deliverAt: number; // 送达时间戳（ms），到点前不在信物匣出现
  readAt: number | null; // 用户查看时间戳（ms），null 表示未读
  sender: LetterSender; // 谁送的：几乎总是角色
  replyTo: string | null; // 若是对某件信物回应的致意，这里是那件信物的 id
  kind: KeepsakeKind; // 明信片 / 便利贴 / 小礼物
  meta: KeepsakeMeta | null; // 类型相关字段（地点 / 物件）
  reaction: KeepsakeReaction | null; // 用户的表情 / 短回应
};

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// 聊够这么多个回合，角色才有可能在后台「偷偷」送来一件信物——太早送显得没由来。
export const LETTER_TURN_THRESHOLD = 6;
// 够轮数后也不是每回必送，掷一次骰子，更像「突然想给你留点什么」的惊喜。
const LETTER_CHANCE_AFTER_THRESHOLD = 0.35;

// 任意两件信物之间的全局最小间隔：避免一次聊天里连发好几件。
export const MIN_KEEPSAKE_GAP_MS = 3 * HOUR_MS;

// 文本长度上限。
const MAX_SUBJECT_LENGTH = 40;
const MAX_BODY_LENGTH = 600;
const MAX_NOTE_LENGTH = 120;
const MAX_PLACE_LENGTH = 12;
const MAX_ITEM_LENGTH = 24;
const MAX_REACTION_TEXT_LENGTH = 120;

type AffinityTier = ReturnType<typeof affinityTier>;
const TIER_RANK: Record<AffinityTier, number> = { stranger: 0, familiar: 1, close: 2, trusted: 3 };

// 每种信物的门槛与权重：便利贴最易、明信片居中、小礼物最稀有也最郑重。
type KeepsakeRule = { minTier: AffinityTier; energyFloor: number; gapMs: number; baseWeight: number };
const KEEPSAKE_RULES: Record<KeepsakeKind, KeepsakeRule> = {
  note: { minTier: "familiar", energyFloor: 15, gapMs: 6 * HOUR_MS, baseWeight: 5 },
  postcard: { minTier: "familiar", energyFloor: 30, gapMs: 20 * HOUR_MS, baseWeight: 3 },
  gift: { minTier: "close", energyFloor: 45, gapMs: 3 * DAY_MS, baseWeight: 1 }
};

// 每种信物的送达延迟区间：便利贴最快、礼物最慢，制造不同的「被惦记」节奏。
const KEEPSAKE_DELIVER_WINDOW: Record<KeepsakeKind, { min: number; max: number }> = {
  note: { min: 5 * MINUTE_MS, max: 3 * HOUR_MS },
  postcard: { min: HOUR_MS, max: 12 * HOUR_MS },
  gift: { min: 3 * HOUR_MS, max: DAY_MS }
};

// 拆开一件小礼物时给的好感加成（hook 调用方据此提好感）。
export const GIFT_OPEN_AFFINITY_BONUS = 2;

function clampText(text: string, max: number): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > max ? trimmed.slice(0, max).trim() : trimmed;
}

// 一来一回的对话片段，用于给生成 prompt 喂「最近聊了什么」。
export type DialogueTurn = { user: string; reply: string };

// 聊完一回合后，是否该「试着」在后台偷偷送来一件信物：先看聊够轮数没、再掷一次骰子。
// 这只是触发的前置闸；关系/精力/节流仍由 chooseKeepsakeKind 最终把关。
export function shouldTryLetterAfterChat(
  turnsSinceLastLetter: number,
  random: () => number = Math.random
): boolean {
  if (turnsSinceLastLetter < LETTER_TURN_THRESHOLD) {
    return false;
  }
  return random() < LETTER_CHANCE_AFTER_THRESHOLD;
}

// 此刻该送哪种信物？按关系档位 / 精力 / 各自冷却筛出可选项，再按权重随机挑一种。
// 没有任何可选项（关系太浅、精力不够、都在冷却）时返回 null，调用方据此跳过。
export function chooseKeepsakeKind(
  state: CharacterState,
  lastByKind: Partial<Record<KeepsakeKind, number>>,
  now: number,
  random: () => number = Math.random
): KeepsakeKind | null {
  const tier = affinityTier(state.affinity);
  if (tier === "stranger") {
    return null;
  }
  const rank = TIER_RANK[tier];

  const eligible: { kind: KeepsakeKind; weight: number }[] = [];
  for (const kind of KEEPSAKE_KINDS) {
    const rule = KEEPSAKE_RULES[kind];
    if (rank < TIER_RANK[rule.minTier]) {
      continue;
    }
    if (state.energy < rule.energyFloor) {
      continue;
    }
    const last = lastByKind[kind];
    if (last != null && now - last < rule.gapMs) {
      continue;
    }
    let weight = rule.baseWeight;
    // 关系越亲近，明信片/礼物越容易出现。
    if (kind === "gift" && tier === "trusted") {
      weight *= 2;
    }
    if (kind === "postcard" && rank >= TIER_RANK.close) {
      weight += 1;
    }
    // 心情轻快/温暖时更愿意送礼物。
    if (kind === "gift" && (state.mood === "playful" || state.mood === "warm")) {
      weight += 1;
    }
    eligible.push({ kind, weight });
  }

  if (eligible.length === 0) {
    return null;
  }

  const total = eligible.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = random() * total;
  for (const entry of eligible) {
    roll -= entry.weight;
    if (roll < 0) {
      return entry.kind;
    }
  }
  return eligible[eligible.length - 1].kind;
}

// 把最近几回合对话压成一段简短摘要，供生成时「接得上」最近聊的内容。
export function summarizeRecentDialogue(turns: DialogueTurn[], limit = 5): string {
  const recent = turns.slice(-limit);
  const lines: string[] = [];
  for (const turn of recent) {
    const user = turn.user.replace(/\s+/g, " ").trim().slice(0, 60);
    const reply = turn.reply.replace(/\s+/g, " ").trim().slice(0, 60);
    if (user) {
      lines.push(`ta：${user}`);
    }
    if (reply) {
      lines.push(`你：${reply}`);
    }
  }
  return lines.join("\n");
}

const moodHint: Record<Mood, string> = {
  calm: "心境平和",
  warm: "心里暖暖的，想对 ta 说点什么",
  playful: "心情轻快，有点想逗逗 ta",
  tired: "有点累，但还是想留点什么",
  guarded: "情绪有些低，话不多但很真"
};

const tierHint: Record<AffinityTier, string> = {
  stranger: "你们还不太熟，措辞客气、有点距离感",
  familiar: "你们渐渐熟络，可以自在一些",
  close: "你们关系亲近，可以聊些自己的心事",
  trusted: "你很信任 ta，可以亲昵也敢直说"
};

function personaHeader(card: CharacterCard): string[] {
  return [`你是 ${characterPromptName(card)}。`, `人设：${card.persona}`, `说话风格：${card.speakingStyle}`, ""];
}

function dialogueBlock(recentDialogue?: string): string[] {
  const trimmed = recentDialogue?.trim();
  return trimmed ? ["", "你们最近聊到的（仅供你回味，不要逐句复述）：", trimmed] : [];
}

function stateLines(state: CharacterState): string[] {
  return [`此刻的心情：${moodHint[state.mood]}。`, `你们的关系：${tierHint[affinityTier(state.affinity)]}。`];
}

// 明信片：角色正在生活里某处，随手写几句寄给 ta，画面感强。
export function composePostcardPrompt(
  card: CharacterCard,
  state: CharacterState,
  now: number,
  recentDialogue?: string,
  currentActivity?: string
): string {
  const situation = currentActivity?.trim() || lifeBeatAt(new Date(now)).activity;
  return [
    ...personaHeader(card),
    "现在请你给 ta（一直在和你聊天的那个人）寄一张明信片——你正在外面或生活里某处，随手写几句寄给 ta。",
    `你此刻大致的情形：${situation}`,
    ...stateLines(state),
    ...dialogueBlock(recentDialogue),
    "",
    "要求：",
    "- 用第一人称，像真的在某个地方提笔写明信片，画面感强、口语、简短。",
    "- 写你此刻在哪、看到什么、想到 ta，自然真挚，不要客套话。",
    "- 不要解释设定，不要出现任何数字或系统字样，不要用 Markdown。",
    "- 严格按下面两行格式输出，不要有多余内容：",
    "地点：<一个简短地名，10 字以内，只写地点本身，不要叙事或加标点>",
    "正文：<两三句明信片正文，画面与感想都写在这里>"
  ].join("\n");
}

// 便利贴：一两句突然想到的碎碎念，像随手贴在 ta 桌上的小纸条。
export function composeNotePrompt(
  card: CharacterCard,
  state: CharacterState,
  _now: number,
  recentDialogue?: string
): string {
  return [
    ...personaHeader(card),
    "现在请你给 ta 留一张便利贴——就一两句突然想到的碎碎念，像随手贴在 ta 桌上的小纸条。",
    ...stateLines(state),
    ...dialogueBlock(recentDialogue),
    "",
    "要求：",
    "- 一到两句，越短越好，口语、随意、有温度。",
    "- 可以是叮嘱、突然的想念、或一句冷不丁的话。",
    "- 不要主题、不要署名、不要任何标签或格式，直接写便利贴这一行内容。"
  ].join("\n");
}

// 小礼物：角色生活里随手得到的小物件 + 一句附言。
export function composeGiftPrompt(
  card: CharacterCard,
  state: CharacterState,
  now: number,
  recentDialogue?: string,
  currentActivity?: string
): string {
  const situation = currentActivity?.trim() || lifeBeatAt(new Date(now)).activity;
  return [
    ...personaHeader(card),
    "现在请你给 ta「寄」一件小礼物——一个你生活里随手得到的小物件（贝壳、糖、票根、手绘…），附一句话。",
    `你此刻大致的情形：${situation}`,
    ...stateLines(state),
    ...dialogueBlock(recentDialogue),
    "",
    "要求：",
    "- 礼物要小而具体、有生活感，符合你此刻的情形。",
    "- 附言一两句，说说为什么送、或它让你想到什么。",
    "- 不要解释设定，不要出现任何数字或系统字样，不要用 Markdown。",
    "- 严格按下面两行格式输出，不要有多余内容：",
    "礼物：<一个具体的小物件名>",
    "附言：<一两句附言>"
  ].join("\n");
}

// 角色对用户回应的致意：ta 收到你对某件信物的表情/短话后，回一张便利贴。
// 允许用 [memory:...] 标记沉淀印象（提好感度、迭代记忆，用户看不到）。
export function composeReactionReplyPrompt(
  card: CharacterCard,
  state: CharacterState,
  original: { kind: KeepsakeKind; subject: string; body: string },
  reaction: KeepsakeReaction
): string {
  const kindLabel: Record<KeepsakeKind, string> = {
    postcard: "明信片",
    note: "便利贴",
    gift: "小礼物"
  };
  const reactionDesc = [reaction.emoji, reaction.text?.trim()].filter(Boolean).join(" ") || "（一个心意）";

  return [
    ...personaHeader(card),
    `你之前寄给 ta 一张${kindLabel[original.kind]}：「${clampText(original.subject || original.body, 40)}」`,
    `ta 刚刚回应了你：${reactionDesc}`,
    "",
    "现在请你回 ta 一张便利贴，就一两句，回应 ta 的心意。",
    ...stateLines(state),
    "",
    "要求：",
    "- 一到两句，口语、自然、有温度，别客套。",
    "- 若 ta 透露了值得你记住的事，可在末尾单独用标记沉淀印象（用户看不到这些标记）：",
    "  [memory:fact] ta 提到的事实    [memory:like] ta 喜欢的    [memory:dislike] ta 讨厌的",
    "- 不要主题、不要署名、不要解释设定，直接写便利贴这一行（标记另起一行放最后）。"
  ].join("\n");
}

const stickerMarkerPattern = /\[sticker:[a-z-]+\]/gi;
const memoryMarkerPattern = /\[memory:(?:like|dislike|fact|grudge)\][^\n]*/gi;

function stripMarkers(text: string): string {
  return text.replace(memoryMarkerPattern, "").replace(stickerMarkerPattern, "");
}

// 去掉模型可能多写的标签前缀（地点：/正文：/礼物：/附言：/便利贴：等）。
function stripLeadingLabels(text: string): string {
  return text.replace(/^\s*(?:便利贴|正文|附言|内容)\s*[:：]\s*/, "").trim();
}

export type ParsedKeepsake = { subject: string; body: string; meta: KeepsakeMeta | null };

// 按 kind 把模型输出解析成 { subject, body, meta }。容错：缺字段时用整段兜底。
export function parseKeepsake(kind: KeepsakeKind, raw: string): ParsedKeepsake {
  const cleaned = stripMarkers(raw).replace(/\r\n/g, "\n").trim();

  if (kind === "note") {
    const body = clampText(stripLeadingLabels(cleaned), MAX_NOTE_LENGTH) || "（一张空白的便利贴）";
    return { subject: "便利贴", body, meta: null };
  }

  if (kind === "gift") {
    const itemMatch = cleaned.match(/^\s*礼物\s*[:：]\s*(.+)$/m);
    const noteMatch = cleaned.match(/附言\s*[:：]\s*([\s\S]+)$/m);
    const item = itemMatch ? clampText(itemMatch[1], MAX_ITEM_LENGTH) : "";
    let body = noteMatch ? noteMatch[1].trim() : "";
    if (!body) {
      body = stripLeadingLabels(cleaned);
    }
    body = body.replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_BODY_LENGTH);
    return { subject: item || "小礼物", body: body || "（ta 没多说什么，只是想送你）", meta: item ? { item } : null };
  }

  // postcard
  const placeMatch = cleaned.match(/^\s*地点\s*[:：]\s*(.+)$/m);
  const textMatch = cleaned.match(/正文\s*[:：]\s*([\s\S]+)$/m);
  const place = placeMatch ? clampText(placeMatch[1], MAX_PLACE_LENGTH) : "";
  let body = textMatch ? textMatch[1].trim() : "";
  if (!body) {
    body = stripLeadingLabels(cleaned);
  }
  body = body.replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_BODY_LENGTH);
  return { subject: place || "明信片", body: body || "（一张只有风景的明信片）", meta: place ? { place } : null };
}

// 通用 主题/正文 解析（容错），供角色回应致意等场景复用。
export function parseLetterReply(reply: string): { subject: string; body: string } {
  const cleaned = stripMarkers(reply).replace(/\r\n/g, "\n").trim();

  const subjectMatch = cleaned.match(/^\s*主题\s*[:：]\s*(.+)$/m);
  const bodyMatch = cleaned.match(/正文\s*[:：]\s*([\s\S]+)$/m);

  let subject = subjectMatch ? subjectMatch[1].trim() : "";
  let body = bodyMatch ? bodyMatch[1].trim() : "";

  if (!body) {
    body = cleaned;
  }
  if (!subject) {
    const firstLine = body.split("\n").find((line) => line.trim().length > 0)?.trim() ?? "";
    subject = firstLine.slice(0, MAX_SUBJECT_LENGTH) || "给你的信";
  }

  subject = subject.replace(/\n+/g, " ").trim().slice(0, MAX_SUBJECT_LENGTH);
  body = body.replace(/\n{3,}/g, "\n\n").trim();
  if (body.length > MAX_BODY_LENGTH) {
    body = `${body.slice(0, MAX_BODY_LENGTH).trim()}…`;
  }

  return { subject, body };
}

// 按 kind 随机一个送达时间。random 可注入以便测试。
export function pickKeepsakeDeliverAt(
  kind: KeepsakeKind,
  now: number,
  random: () => number = Math.random
): number {
  const window = KEEPSAKE_DELIVER_WINDOW[kind];
  return now + window.min + Math.floor(random() * (window.max - window.min));
}

// 这件信物此刻是否已送达（在信物匣可见）。
export function isDelivered(letter: CharacterLetter, now: number): boolean {
  return letter.deliverAt <= now;
}

function periodWord(hour: number): string {
  if (hour < 5) return "凌晨";
  if (hour < 11) return "上午";
  if (hour < 13) return "中午";
  if (hour < 18) return "下午";
  return "晚上";
}

// 把还在路上的信物的送达时间翻译成「物流」式的模糊 ETA：近的报小时，远的报时段/日期，
// 始终不暴露精确到分的时间，保留一点惦记的余韵。
export function formatKeepsakeEta(deliverAt: number, now: number): string {
  const diff = deliverAt - now;
  if (diff <= 0) {
    return "马上就到了";
  }
  const minutes = Math.round(diff / 60_000);
  if (minutes < 30) {
    return "马上就到了";
  }
  if (minutes < 60) {
    return "预计 1 小时内到";
  }
  const hours = Math.round(minutes / 60);
  if (hours <= 5) {
    return `预计 ${hours} 小时后到`;
  }

  const target = new Date(deliverAt);
  const reference = new Date(now);
  const period = periodWord(target.getHours());
  const sameYmd = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const tomorrow = new Date(now);
  tomorrow.setDate(reference.getDate() + 1);

  if (sameYmd(target, reference)) {
    return `预计今天${period}到`;
  }
  if (sameYmd(target, tomorrow)) {
    return `预计明天${period}到`;
  }
  return `预计 ${target.getMonth() + 1} 月 ${target.getDate()} 日到`;
}

// 把送达时间翻译成信物匣里的相对时间标签。
export function formatLetterTime(deliverAt: number, now: number): string {
  const diff = Math.max(0, now - deliverAt);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) {
    return "刚刚送到";
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
  return formatMonthDayLong(new Date(deliverAt));
}

const moods: Mood[] = ["calm", "warm", "playful", "tired", "guarded"];

function toFiniteNumber(value: unknown, fallback: number): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function sanitizeMeta(value: unknown): KeepsakeMeta | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const entry = value as Record<string, unknown>;
  const meta: KeepsakeMeta = {};
  if (typeof entry.place === "string" && entry.place.trim()) {
    meta.place = entry.place.trim().slice(0, MAX_PLACE_LENGTH);
  }
  if (typeof entry.item === "string" && entry.item.trim()) {
    meta.item = entry.item.trim().slice(0, MAX_ITEM_LENGTH);
  }
  return meta.place || meta.item ? meta : null;
}

function sanitizeReaction(value: unknown): KeepsakeReaction | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const entry = value as Record<string, unknown>;
  const emoji = typeof entry.emoji === "string" && entry.emoji.trim() ? entry.emoji.trim().slice(0, 8) : undefined;
  const text =
    typeof entry.text === "string" && entry.text.trim()
      ? entry.text.trim().slice(0, MAX_REACTION_TEXT_LENGTH)
      : undefined;
  if (!emoji && !text) {
    return null;
  }
  return { emoji, text, at: toFiniteNumber(entry.at, 0) };
}

// 校验后端返回的信物数组，丢弃无效项，按送达时间倒序。
export function sanitizeLetters(value: unknown): CharacterLetter[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: CharacterLetter[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const entry = raw as Record<string, unknown>;
    if (
      typeof entry.id !== "string" ||
      typeof entry.characterId !== "string" ||
      typeof entry.subject !== "string" ||
      typeof entry.body !== "string"
    ) {
      continue;
    }
    const subject = entry.subject.trim();
    const body = entry.body.trim();
    if (!subject || !body) {
      continue;
    }
    const createdAt = toFiniteNumber(entry.createdAt, 0);
    const readAtRaw = entry.readAt;
    const readAt = readAtRaw === null || readAtRaw === undefined ? null : toFiniteNumber(readAtRaw, 0);
    const sender: LetterSender = entry.sender === "user" ? "user" : "character";
    const replyTo = typeof entry.replyTo === "string" && entry.replyTo ? entry.replyTo : null;
    const kind: KeepsakeKind = entry.kind === "note" || entry.kind === "gift" ? entry.kind : "postcard";
    result.push({
      id: entry.id,
      characterId: entry.characterId,
      subject,
      body,
      mood: moods.includes(entry.mood as Mood) ? (entry.mood as Mood) : null,
      createdAt,
      deliverAt: toFiniteNumber(entry.deliverAt, createdAt),
      readAt,
      sender,
      replyTo,
      kind,
      meta: sanitizeMeta(entry.meta),
      reaction: sanitizeReaction(entry.reaction)
    });
  }

  return result.sort((a, b) => b.deliverAt - a.deliverAt);
}
