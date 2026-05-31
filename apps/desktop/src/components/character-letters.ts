import type { CharacterCard } from "./character-cards.ts";
import { affinityTier, lifeBeatAt, type CharacterState, type Mood } from "./character-state.ts";

// 信件的寄出方：角色写来的，或用户写给角色的。
export type LetterSender = "character" | "user";

// 一封信。结构化、可序列化、无向量（保持 FTS-only 理念）。角色写来的或用户写出的都用这个结构。
export type CharacterLetter = {
  id: string;
  characterId: string;
  subject: string;
  body: string;
  mood: Mood | null; // 写这封信时的心情，可为空
  createdAt: number; // 写信时间戳（ms）
  deliverAt: number; // 送达时间戳（ms），到点前不在收件箱出现
  readAt: number | null; // 用户读信时间戳（ms），null 表示未读
  sender: LetterSender; // 谁写的：角色 or 用户
  replyTo: string | null; // 若是回信，这里是被回复那封信的 id
};

// 两封信之间至少间隔这么久：写信比发动态郑重，别太频繁。
export const MIN_LETTER_GAP_MS = 20 * 60 * 60 * 1000;
// 精力低于这个值就没心力写信了。
const LETTER_ENERGY_FLOOR = 25;
// 送达延迟区间：写完后过 1~24 小时才送到，营造「被惦记」的等待感。
const MIN_DELIVER_DELAY_MS = 1 * 60 * 60 * 1000;
const MAX_DELIVER_DELAY_MS = 24 * 60 * 60 * 1000;
// 主题/正文长度上限。
const MAX_SUBJECT_LENGTH = 40;
const MAX_BODY_LENGTH = 600;

// 决定此刻这个角色要不要写信：关系够熟、距上次够久、精力还够。
export function shouldWriteLetter(state: CharacterState, lastLetterAt: number | null, now: number): boolean {
  if (state.energy < LETTER_ENERGY_FLOOR) {
    return false;
  }
  // 还是陌生人就不会主动写信。
  if (affinityTier(state.affinity) === "stranger") {
    return false;
  }
  if (lastLetterAt !== null && now - lastLetterAt < MIN_LETTER_GAP_MS) {
    return false;
  }
  return true;
}

const moodHint: Record<Mood, string> = {
  calm: "心境平和",
  warm: "心里暖暖的，想对 ta 说点什么",
  playful: "心情轻快，有点想逗逗 ta",
  tired: "有点累，但还是想写几句",
  guarded: "情绪有些低，话不多但很真"
};

const tierHint: Record<ReturnType<typeof affinityTier>, string> = {
  stranger: "你们还不太熟，措辞客气、有点距离感",
  familiar: "你们渐渐熟络，可以自在一些",
  close: "你们关系亲近，可以聊些自己的心事",
  trusted: "你很信任 ta，可以亲昵也敢直说"
};

// 生成「让角色写一封信」的一次性 prompt。要求结构化输出主题与正文。
export function composeLetterPrompt(card: CharacterCard, state: CharacterState, now: number): string {
  const beat = lifeBeatAt(new Date(now));

  return [
    `你是 ${card.name}。`,
    `人设：${card.persona}`,
    `说话风格：${card.speakingStyle}`,
    "",
    "现在请你给 ta（一直在和你聊天的那个人）写一封短信。",
    `此刻大致的情形：${beat.activity}`,
    `此刻的心情：${moodHint[state.mood]}。`,
    `你们的关系：${tierHint[affinityTier(state.affinity)]}。`,
    "",
    "要求：",
    "- 用第一人称写给 ta，像一封真正的私人信件，自然真挚，不要客套话。",
    "- 内容写你最近的生活、想法、或想对 ta 说的话，可以提到 ta，但不要复述聊天记录。",
    "- 不要解释设定，不要出现任何数字或系统字样，不要用 Markdown。",
    "- 严格按下面两行格式输出，不要有多余内容：",
    "主题：<一句话主题>",
    "正文：<信的正文，可分多段>"
  ].join("\n");
}

// 生成「让角色回一封信」的一次性 prompt：用户刚寄来一封信，角色读后回信。
// 要求结构化输出主题/正文，并允许用 [memory:...] 标记沉淀印象（提好感度、迭代记忆）。
export function composeLetterReplyPrompt(
  card: CharacterCard,
  state: CharacterState,
  userLetter: { subject: string; body: string },
  now: number
): string {
  const beat = lifeBeatAt(new Date(now));

  return [
    `你是 ${card.name}。`,
    `人设：${card.persona}`,
    `说话风格：${card.speakingStyle}`,
    "",
    "ta（一直在和你聊天的那个人）刚刚给你写来一封信：",
    `主题：${userLetter.subject}`,
    `正文：${userLetter.body}`,
    "",
    "现在请你读完后，给 ta 回一封信。",
    `此刻大致的情形：${beat.activity}`,
    `此刻的心情：${moodHint[state.mood]}。`,
    `你们的关系：${tierHint[affinityTier(state.affinity)]}。`,
    "",
    "要求：",
    "- 用第一人称回信，真诚回应 ta 信里说的事和情绪，不要客套话。",
    "- 可以分享你自己的近况和想法，但要让 ta 感到你认真读了 ta 的信。",
    "- 不要解释设定，不要出现任何数字或系统字样，不要用 Markdown。",
    "- 若 ta 透露了值得你记住的事，可在信末单独用标记沉淀印象（用户看不到这些标记）：",
    "  [memory:fact] ta 提到的事实    [memory:like] ta 喜欢的    [memory:dislike] ta 讨厌的",
    "- 严格按下面两行格式输出正文部分，标记另起一行放最后：",
    "主题：<一句话主题>",
    "正文：<回信正文，可分多段>"
  ].join("\n");
}

const stickerMarkerPattern = /\[sticker:[a-z-]+\]/gi;
const memoryMarkerPattern = /\[memory:(?:like|dislike|fact|grudge)\][^\n]*/gi;

function stripMarkers(text: string): string {
  return text.replace(memoryMarkerPattern, "").replace(stickerMarkerPattern, "");
}

// 把模型输出解析成 { subject, body }。容错：缺主题时用正文首句兜底。
export function parseLetterReply(reply: string): { subject: string; body: string } {
  const cleaned = stripMarkers(reply).replace(/\r\n/g, "\n").trim();

  const subjectMatch = cleaned.match(/^\s*主题\s*[:：]\s*(.+)$/m);
  const bodyMatch = cleaned.match(/正文\s*[:：]\s*([\s\S]+)$/m);

  let subject = subjectMatch ? subjectMatch[1].trim() : "";
  let body = bodyMatch ? bodyMatch[1].trim() : "";

  if (!body) {
    // 没按格式来：把整段当正文，首句当主题。
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

// 写完后随机一个 1~24 小时的送达时间。random 可注入以便测试。
export function pickDeliverAt(now: number, random: () => number = Math.random): number {
  const span = MAX_DELIVER_DELAY_MS - MIN_DELIVER_DELAY_MS;
  return now + MIN_DELIVER_DELAY_MS + Math.floor(random() * span);
}

// 这封信此刻是否已送达（在收件箱可见）。
export function isDelivered(letter: CharacterLetter, now: number): boolean {
  return letter.deliverAt <= now;
}

// 把送达时间翻译成收件箱里的相对时间标签。
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
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(new Date(deliverAt));
}

const moods: Mood[] = ["calm", "warm", "playful", "tired", "guarded"];

function toFiniteNumber(value: unknown, fallback: number): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

// 校验后端返回的信件数组，丢弃无效项，按送达时间倒序。
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
      replyTo
    });
  }

  return result.sort((a, b) => b.deliverAt - a.deliverAt);
}
