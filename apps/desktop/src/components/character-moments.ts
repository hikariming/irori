import { characterPromptName, type CharacterCard } from "./character-cards.ts";
import { lifeBeatAt, type CharacterState, type Mood } from "./character-state.ts";
import { formatMonthDayLong } from "../i18n/formatters.ts";

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

// 把小时映射成口语化的时段，让动态贴合一天里的此刻（清晨/深夜……）。
function timeOfDayLabel(hour: number): string {
  if (hour < 5) return "深夜";
  if (hour < 8) return "清晨";
  if (hour < 11) return "上午";
  if (hour < 13) return "中午";
  if (hour < 17) return "下午";
  if (hour < 19) return "傍晚";
  if (hour < 23) return "夜晚";
  return "深夜";
}

const weekdayLabels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

// 把当前时刻翻成「周三 傍晚 18:24」这样的时间要素，注入动态 prompt。
function describeMomentTime(now: number): string {
  const date = new Date(now);
  const hh = `${date.getHours()}`.padStart(2, "0");
  const mm = `${date.getMinutes()}`.padStart(2, "0");
  return `${weekdayLabels[date.getDay()]} ${timeOfDayLabel(date.getHours())} ${hh}:${mm}`;
}

const moodHint: Record<Mood, string> = {
  calm: "平静",
  warm: "心里暖暖的",
  playful: "有点俏皮想闹",
  tired: "有点累",
  guarded: "情绪有点低，想自己待会儿"
};

// 动态的「角度/体裁」池：每次随机挑一个，打散千篇一律的「此刻在做 X + 心情 Y」状态播报。
export type MomentAngle = { key: string; hint: string };

export const MOMENT_ANGLES: MomentAngle[] = [
  { key: "plain", hint: "就随手记一句此刻的生活片段，平实自然。" },
  { key: "complain", hint: "吐槽一下刚遇到的小麻烦或看不顺眼的小事，带点情绪但别上纲上线。" },
  { key: "delight", hint: "记一个不起眼的小确幸，一点点就能开心的小事。" },
  { key: "musing", hint: "由手头的事忽然飘出来的一句感慨或走神的念头。" },
  { key: "selfqa", hint: "自问自答：先问自己一个小问题，再随口接一句。" },
  { key: "mutter", hint: "碎碎念，像自言自语，半句也行，不用完整。" },
  { key: "detail", hint: "只抓一个很具体的细节来写：一个气味、声音、光线，或眼前某个物件。" },
  { key: "compare", hint: "和昨天 / 以前比一下，今天哪里不太一样。" },
  { key: "flag", hint: "随口立个小 flag 或给自己定个小目标。" },
  { key: "emo", hint: "稍微 emo 一下，但克制，一两句就收。" },
  { key: "joke", hint: "玩个小梗 / 冷幽默 / 自嘲一下。" },
  { key: "weather", hint: "感叹或抱怨一下此刻的环境、天气、温度、光线。" }
];

// 随机挑一个角度；传入 seed（0~1）可复现，便于测试。
export function pickMomentAngle(seed?: number): MomentAngle {
  const r = typeof seed === "number" ? seed : Math.random();
  const index = Math.min(MOMENT_ANGLES.length - 1, Math.max(0, Math.floor(r * MOMENT_ANGLES.length)));
  return MOMENT_ANGLES[index];
}

export type ComposeMomentOptions = {
  activity?: string; // 来自当天作息的「此刻在干嘛」
  angle?: MomentAngle; // 这条用什么角度/体裁写
  recentMoments?: string[]; // 该角色最近发过的几条（用于反重复 + 接着写）
  dayEvents?: string[]; // 今天已经经历过的事（已执行的作息条目），制造一天的连续性
};

// 生成「让角色发一条动态」的一次性 prompt。它独立于聊天，不应提到用户或对话。
export function composeMomentPrompt(
  card: CharacterCard,
  state: CharacterState,
  now: number,
  options: ComposeMomentOptions = {}
): string {
  const { activity, angle, recentMoments = [], dayEvents = [] } = options;
  const situation = activity?.trim() || lifeBeatAt(new Date(now)).activity;

  const lines: string[] = [`你是 ${characterPromptName(card)}。`];
  if (card.persona) {
    lines.push(`人设：${card.persona}`);
  }
  if (card.storyBackground) {
    lines.push(`身份与背景：${card.storyBackground}`);
  }
  if (card.coreMotivation) {
    lines.push(`你看重的事：${card.coreMotivation}`);
  }
  if (card.speakingStyle) {
    lines.push(`说话风格：${card.speakingStyle}`);
  }
  lines.push(
    "",
    "现在请你像发一条朋友圈/动态那样，写下此刻你自己的生活片段或心情。",
    `此刻时间：${describeMomentTime(now)}。`,
    `此刻你正在：${situation}`,
    `此刻的心情：${moodHint[state.mood]}。`
  );

  // 一天的连续性：把今天已经经历过的事喂进来，可以自然地接着其中某件写。
  if (dayEvents.length > 0) {
    lines.push("", "今天你已经经历过这些（可以自然地接着其中某件写，不必都提）：", ...dayEvents.slice(-6).map((event) => `- ${event}`));
  }
  // 反重复：把最近发过的几条贴出来，要求换内容换语气。
  if (recentMoments.length > 0) {
    lines.push("", "你最近发过这些（千万别在内容或措辞上重复它们，语气也换一换）：", ...recentMoments.slice(0, 5).map((text) => `- ${text}`));
  }

  lines.push(
    "",
    `这一条的角度：${angle ? angle.hint : "就随手记一句此刻的生活片段，平实自然。"}`,
    "",
    "要求：",
    "- 用第一人称，像随手发的一条动态，自然口语。",
    "- 长度随意、别每条都一样长：有时半句到一句就够，有时两三句；可以用不完整的短句、口头禅、省略号。",
    "- 用上面这条的「角度」来写，并结合你此刻在做的事、当下的时间与时段（清晨刚醒、深夜还没睡、傍晚收工……要对得上）。",
    "- 要贴合你的身份与背景（学生、调试师、整理型的人……写出来要像「你」，不要换成别人也成立的泛泛感慨）。",
    "- 写你自己的生活、所见、所想或心情，不要提到「用户」「你」，也不要像在对谁说话。",
    "- 不要解释设定，不要出现任何数字或系统字样，不要用 Markdown。",
    "- 只输出动态正文本身。"
  );
  return lines.join("\n");
}

// —— 方向三：彼此认识的角色之间互相评论/点赞 ——
// 一条动态发布超过这个时长，就太「过气」了，大家不再去评论/点赞（硬截断）。
export const PEER_REACTION_MAX_AGE_MS = 6 * 60 * 60 * 1000;
// 反应意愿的半衰期：每过这么久，去评论的概率减半（指数衰减）。
export const PEER_REACTION_HALF_LIFE_MS = 90 * 60 * 1000;

// 按动态年龄给出 0~1 的「反应意愿」衰减系数：刚发=1，越久越低，超过硬截断=0。
export function peerReactionDecay(ageMs: number): number {
  if (ageMs <= 0) {
    return 1;
  }
  if (ageMs >= PEER_REACTION_MAX_AGE_MS) {
    return 0;
  }
  return Math.pow(0.5, ageMs / PEER_REACTION_HALF_LIFE_MS);
}

// 生成「让某个角色评论另一个角色刚发的动态」的一次性 prompt。彼此认识的角色之间的互动，不涉及用户。
// 刻意只给很轻的人设提示 + 大量「像真人随手回一句」的约束，避免端着人设、说成一本正经的完整句（很违和）。
export function composePeerCommentPrompt(
  peer: CharacterCard,
  peerState: CharacterState,
  authorName: string,
  momentText: string,
  now: number
): string {
  const lines: string[] = [`你是 ${characterPromptName(peer)}，和 ${authorName} 是彼此认识的朋友（你们各自生活，并不住在一起）。`];
  if (peer.speakingStyle) {
    lines.push(`你平时说话的味儿：${peer.speakingStyle}`);
  }
  lines.push(
    "",
    `${authorName} 刚发了条朋友圈：「${momentText}」`,
    `现在 ${describeMomentTime(now)}，你心情${moodHint[peerState.mood]}。`,
    "",
    "你在底下随手回一句，就像在微信朋友圈给朋友评论那样。要像个真人，别像 AI：",
    "- 越短越好。三五个字、一个语气词、半句话都行，别凑成完整、工整的句子。",
    "- 大白话口语。可以调侃、附和、关心、拌嘴、接梗，或者就一句「哈哈哈」「我也是」「又来」「绝了」。",
    "- 别客套、别总结、别复述对方说了啥、别自我介绍、别讲道理、别解释——就当是熟人之间。",
    "- 带一点你自己的味儿就够了，别刻意「表演」人设。",
    "- 不提「用户」，不要出现数字 / 系统字样 / Markdown / 引号。",
    "- 只输出这一句评论本身。"
  );
  return lines.join("\n");
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
  return formatMonthDayLong(new Date(createdAt));
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
