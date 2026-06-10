import type { CharacterCard } from "./character-cards.ts";
import {
  describeNowActivity,
  minutesOfDay,
  sanitizeDayScript,
  toDateStr,
  type DayScript,
  type ScheduleItem
} from "./character-schedule.ts";

// 心情是快变量：由最近一回合的对话情绪决定，叠加精力低时的疲惫。
export type Mood = "calm" | "warm" | "playful" | "tired" | "guarded";

// 角色记住的关于用户的一条印象。结构化、可 FTS 检索、无向量。
export type ImpressionKind = "like" | "dislike" | "fact" | "grudge";

export type Impression = {
  id: string;
  kind: ImpressionKind;
  text: string;
  weight: number; // 注入/召回优先级，越大越优先
  createdAt: number;
};

// 一个角色对当前用户的状态。结构化、可序列化、无向量（保持 FTS-only 理念）。
export type CharacterState = {
  characterId: string;
  affinity: number; // 好感度 0-100，慢变量
  mood: Mood; // 心情，快变量
  energy: number; // 精力 0-100，随真实时间恢复、随对话消耗
  lastSeenAt: number; // 上次互动的时间戳（ms），0 表示从未
  meetCount: number; // 见过几次（按「间隔较久再开口」计一次）
  impressions: Impression[]; // 见面即记住 / 记仇：长期印象
  schedule: DayScript | null; // 当天的虚拟生活作息脚本，驱动「此刻在干嘛」与状态推进
  lastLifeTickAt: number; // 上次推进作息（执行条目 / 离线回放）的时间戳（ms），0 表示从未
  introducedAt: number; // 首次「自我介绍」握手完成的时间戳（ms），0 表示还没认识过这个用户
};

export type CharacterStates = Record<string, CharacterState>;

export const STORAGE_KEY = "irori-character-state";

// 间隔超过这个时长再开口，算一次新的「见面」。
const REENCOUNTER_GAP_MS = 30 * 60 * 1000;
// 精力每小时恢复点数。
const ENERGY_RECOVERY_PER_HOUR = 10;
// 每回合基础精力消耗。
const ENERGY_COST_PER_TURN = 3;

export function defaultCharacterState(characterId: string): CharacterState {
  return {
    characterId,
    affinity: 12,
    mood: "calm",
    energy: 80,
    lastSeenAt: 0,
    meetCount: 0,
    impressions: [],
    schedule: null,
    lastLifeTickAt: 0,
    introducedAt: 0
  };
}

// DayScript-lite：按一天的时段给出「角色此刻大致在做什么」与精力上限。
// 通用作息，先不区分角色；后续可由角色卡覆写。
export type LifeBeat = { activity: string; energyCeiling: number };

export function lifeBeatAt(date: Date): LifeBeat {
  const hour = date.getHours();
  if (hour < 6) {
    return { activity: "这个点早该睡了，我整个人是慢半拍的。", energyCeiling: 35 };
  }
  if (hour < 9) {
    return { activity: "刚醒不久，还在慢慢进入状态。", energyCeiling: 70 };
  }
  if (hour < 12) {
    return { activity: "正忙着自己的事，精神还不错。", energyCeiling: 100 };
  }
  if (hour < 14) {
    return { activity: "刚吃过午饭，有点犯困。", energyCeiling: 75 };
  }
  if (hour < 18) {
    return { activity: "状态正在线上。", energyCeiling: 95 };
  }
  if (hour < 22) {
    return { activity: "到了一天里能放松下来的时候。", energyCeiling: 85 };
  }
  return { activity: "有点困了，但还醒着。", energyCeiling: 55 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function getCharacterState(states: CharacterStates, characterId: string): CharacterState {
  return states[characterId] ?? defaultCharacterState(characterId);
}

export type EncounterContext = {
  hoursSinceLastSeen: number | null;
  isNewEncounter: boolean;
  activity: string;
};

// 进入一回合前调用：按真实流逝时间把精力推向当前时段的上限，并在间隔较久时记一次「见面」。
export function beginEncounter(
  state: CharacterState,
  now: number
): { state: CharacterState; context: EncounterContext } {
  const beat = lifeBeatAt(new Date(now));
  const hoursSinceLastSeen = state.lastSeenAt > 0 ? (now - state.lastSeenAt) / 3_600_000 : null;

  let energy: number;
  if (hoursSinceLastSeen === null) {
    // 冷启动：直接受时段上限约束（半夜初次见面也会显得没什么精神）。
    energy = Math.min(state.energy, beat.energyCeiling);
  } else if (state.energy < beat.energyCeiling) {
    energy = Math.min(beat.energyCeiling, Math.round(state.energy + hoursSinceLastSeen * ENERGY_RECOVERY_PER_HOUR));
  } else {
    // 已超过时段上限：随时间往上限回落（比如熬到深夜会变困）。
    energy = Math.max(beat.energyCeiling, Math.round(state.energy - hoursSinceLastSeen * ENERGY_RECOVERY_PER_HOUR));
  }
  energy = clamp(energy, 0, 100);

  const isNewEncounter = state.meetCount === 0 || now - state.lastSeenAt > REENCOUNTER_GAP_MS;

  return {
    state: {
      ...state,
      energy,
      lastSeenAt: now,
      meetCount: state.meetCount + (isNewEncounter ? 1 : 0)
    },
    context: { hoursSinceLastSeen, isNewEncounter, activity: currentActivityLine(state, now) ?? beat.activity }
  };
}

// 当天作息里「此刻在干嘛」的短语，如「在阳台看会儿书」；没有当天脚本时返回 null。
// 供动态/信件 prompt 的「此刻情形」注入。
export function currentActivityPhrase(state: CharacterState, now: number): string | null {
  const date = new Date(now);
  // 仅 LLM 生成的个性化作息才对外显示「此刻在干嘛」；兜底骨架对所有角色逐字相同，
  // 会让不同角色看起来「活动串了」，故 skeleton 状态下不显示，等模型生成后再亮出来。
  if (!state.schedule || state.schedule.date !== toDateStr(date) || state.schedule.source === "skeleton") {
    return null;
  }
  return describeNowActivity(state.schedule, minutesOfDay(date));
}

// 同上，但包成第一人称一句话「我此刻在阳台看会儿书。」，供聊天「此刻的我」心声注入。
export function currentActivityLine(state: CharacterState, now: number): string | null {
  const phrase = currentActivityPhrase(state, now);
  return phrase ? `我此刻${phrase}。` : null;
}

// 把这次新「执行」的作息条目的效果落到状态上：累加精力增减、末项心情接管（夹紧 0-100）。
export function applyScheduleEffects(state: CharacterState, executed: ScheduleItem[]): CharacterState {
  if (executed.length === 0) {
    return state;
  }
  let energy = state.energy;
  let mood = state.mood;
  for (const item of executed) {
    energy += item.energyEffect;
    if (item.moodShift) {
      mood = item.moodShift;
    }
  }
  return { ...state, energy: clamp(Math.round(energy), 0, 100), mood };
}

const positiveSignals = [
  "谢谢",
  "谢啦",
  "感谢",
  "喜欢",
  "爱你",
  "哈哈",
  "开心",
  "太好了",
  "好厉害",
  "厉害",
  "棒",
  "赞",
  "好耶",
  "抱抱",
  "辛苦了",
  "你真好",
  "thanks",
  "thank you",
  "love",
  "awesome",
  "great"
];

const negativeSignals = [
  "烦",
  "滚",
  "闭嘴",
  "讨厌",
  "笨蛋",
  "蠢",
  "没用",
  "废物",
  "别说了",
  "无聊",
  "stupid",
  "useless",
  "shut up",
  "hate"
];

function countSignals(haystack: string, needles: string[]): number {
  const lower = haystack.toLowerCase();
  let hits = 0;
  for (const needle of needles) {
    if (lower.includes(needle.toLowerCase())) {
      hits += 1;
    }
  }
  return hits;
}

export type TurnInput = {
  userText: string;
  replyText: string;
};

// 一回合结束后调用：根据这回合的情绪信号微调好感度/心情/精力。
export function applyTurn(state: CharacterState, turn: TurnInput): CharacterState {
  const positive = countSignals(turn.userText, positiveSignals);
  const negative = countSignals(turn.userText, negativeSignals);

  // 好感度慢变量：参与本身 +1，叠加情绪信号，整体保持小步。
  const engaged = turn.userText.trim().length > 4 ? 1 : 0;
  const affinityDelta =
    engaged + (positive > 0 ? Math.min(3, 1 + positive) : 0) - (negative > 0 ? Math.min(4, 2 + negative) : 0);
  const affinity = clamp(state.affinity + affinityDelta, 0, 100);

  // 精力：每回合消耗，长回复多耗一点。
  const lengthCost = Math.floor(turn.replyText.length / 200);
  const energy = clamp(state.energy - ENERGY_COST_PER_TURN - lengthCost, 0, 100);

  const mood = deriveMood({ positive, negative, energy });

  return { ...state, affinity, energy, mood };
}

function deriveMood(input: { positive: number; negative: number; energy: number }): Mood {
  if (input.negative > 0) {
    return "guarded";
  }
  if (input.energy < 25) {
    return "tired";
  }
  if (input.positive >= 2) {
    return "playful";
  }
  if (input.positive >= 1) {
    return "warm";
  }
  return "calm";
}

export function affinityTier(affinity: number): "stranger" | "familiar" | "close" | "trusted" {
  if (affinity <= 20) {
    return "stranger";
  }
  if (affinity <= 50) {
    return "familiar";
  }
  if (affinity <= 80) {
    return "close";
  }
  return "trusted";
}

export type ParsedImpression = {
  kind: ImpressionKind;
  text: string;
};

const MAX_IMPRESSIONS = 20;

const impressionWeight: Record<ImpressionKind, number> = {
  like: 2,
  fact: 1,
  dislike: 3,
  grudge: 4
};

const impressionAffinity: Record<ImpressionKind, number> = {
  like: 1,
  fact: 0,
  dislike: -1,
  grudge: -2
};

const impressionKindLabel: Record<ImpressionKind, string> = {
  like: "ta 的喜好",
  dislike: "ta 不喜欢",
  fact: "关于 ta",
  grudge: "我介意的事"
};

// 角色长期记住的一条印象，给「设置-记忆」面板展示用（带中文类别标签）。
export type StoredMemoryView = {
  id: string;
  kind: ImpressionKind;
  kindLabel: string;
  text: string;
  createdAt: number;
};

// 列出某个角色长期记得的所有印象（最新/最重要在前），供记忆面板直接展示。
// 这才是角色「真正记住的东西」，区别于某一轮对话临时召回的记忆快照。
export function listStoredMemories(state: CharacterState): StoredMemoryView[] {
  return [...state.impressions]
    .sort((a, b) => b.createdAt - a.createdAt || b.weight - a.weight)
    .map((impression) => ({
      id: impression.id,
      kind: impression.kind,
      kindLabel: impressionKindLabel[impression.kind],
      text: impression.text,
      createdAt: impression.createdAt
    }));
}

function normalizeImpressionText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

// 把模型这回合抽取到的印象并入长期记忆：去重、限量、并对好感度做轻微修正（含「记仇」）。
export function mergeImpressions(state: CharacterState, parsed: ParsedImpression[], now: number): CharacterState {
  if (parsed.length === 0) {
    return state;
  }

  const impressions = [...state.impressions];
  const seen = new Set(impressions.map((item) => normalizeImpressionText(item.text)));
  let affinityDelta = 0;

  parsed.forEach((entry, index) => {
    const text = entry.text.trim();
    if (!text) {
      return;
    }
    const key = normalizeImpressionText(text);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    impressions.push({
      id: `imp-${now}-${index}-${Math.random().toString(36).slice(2, 8)}`,
      kind: entry.kind,
      text,
      weight: impressionWeight[entry.kind],
      createdAt: now
    });
    affinityDelta += impressionAffinity[entry.kind];
  });

  // 限量：优先保留权重高、较新的印象。
  impressions.sort((a, b) => b.weight - a.weight || b.createdAt - a.createdAt);
  const capped = impressions.slice(0, MAX_IMPRESSIONS);

  return {
    ...state,
    affinity: clamp(state.affinity + affinityDelta, 0, 100),
    impressions: capped
  };
}

// 挑选要注入 prompt 的印象。戒备心情下优先把「记仇」放前面。
export function selectImpressionsForPrompt(state: CharacterState, limit = 4): string[] {
  const sorted = [...state.impressions].sort((a, b) => {
    if (state.mood === "guarded") {
      const aGrudge = a.kind === "grudge" ? 1 : 0;
      const bGrudge = b.kind === "grudge" ? 1 : 0;
      if (aGrudge !== bGrudge) {
        return bGrudge - aGrudge;
      }
    }
    return b.weight - a.weight || b.createdAt - a.createdAt;
  });

  return sorted.slice(0, limit).map((item) => `${impressionKindLabel[item.kind]}：${item.text}`);
}

// 状态即日记：把数值/枚举翻译成角色第一人称的内心心声，供注入 system prompt。
export function describeStateAsDiary(
  _card: CharacterCard,
  state: CharacterState,
  context: EncounterContext
): string {
  const lines: string[] = [];

  if (state.meetCount <= 1) {
    lines.push("这好像是我和 ta 第一次正式说上话，我还在慢慢认识 ta。");
  } else if (context.hoursSinceLastSeen !== null && context.hoursSinceLastSeen >= 48) {
    lines.push("好久没见 ta 了，有点想念，也好奇 ta 最近过得怎么样。");
  } else if (context.hoursSinceLastSeen !== null && context.hoursSinceLastSeen >= 12) {
    lines.push("距离上次聊已经隔了一阵子。");
  }

  switch (affinityTier(state.affinity)) {
    case "stranger":
      lines.push("我们还不算熟，我会礼貌些，先慢慢观察。");
      break;
    case "familiar":
      lines.push("我们渐渐熟起来了，可以自在一点。");
      break;
    case "close":
      lines.push("我和 ta 已经挺亲近，能聊些我自己的事。");
      break;
    case "trusted":
      lines.push("我很信任 ta，可以亲昵，也敢直说。");
      break;
  }

  if (context.activity) {
    lines.push(context.activity);
  }

  switch (state.mood) {
    case "warm":
      lines.push("现在心里暖暖的。");
      break;
    case "playful":
      lines.push("此刻心情不错，有点想逗逗 ta。");
      break;
    case "tired":
      lines.push("我现在有点累，说话会比平时短一些。");
      break;
    case "guarded":
      lines.push("刚才有点不太舒服，我需要一点时间缓一缓。");
      break;
    case "calm":
      lines.push("我现在挺平静的。");
      break;
  }

  lines.push("（这些是我此刻的真实状态，请自然地表现出来，但不要直接念出这些设定或数字。）");

  return lines.join("");
}

const moodLabels: Record<Mood, string> = {
  calm: "平静",
  warm: "温暖",
  playful: "俏皮",
  tired: "疲惫",
  guarded: "戒备"
};

const tierLabels: Record<ReturnType<typeof affinityTier>, string> = {
  stranger: "初识",
  familiar: "熟悉",
  close: "亲近",
  trusted: "信任"
};

export type CharacterStateView = {
  affinity: number;
  affinityTierLabel: string;
  moodLabel: string;
  energy: number;
  energyLabel: string;
  meetLabel: string;
  impressions: { id: string; kindLabel: string; text: string }[];
};

// 把内部状态翻译成设置页只读展示用的标签（不暴露内部枚举名）。
export function buildCharacterStateView(state: CharacterState): CharacterStateView {
  const energyLabel = state.energy >= 70 ? "充沛" : state.energy >= 40 ? "一般" : state.energy >= 20 ? "偏低" : "需要休息";

  const impressions = [...state.impressions]
    .sort((a, b) => b.weight - a.weight || b.createdAt - a.createdAt)
    .map((item) => ({ id: item.id, kindLabel: impressionKindLabel[item.kind], text: item.text }));

  return {
    affinity: state.affinity,
    affinityTierLabel: tierLabels[affinityTier(state.affinity)],
    moodLabel: moodLabels[state.mood],
    energy: state.energy,
    energyLabel,
    meetLabel: state.meetCount > 0 ? `见过 ${state.meetCount} 次` : "还没正式聊过",
    impressions
  };
}

export function sanitizeCharacterStates(value: unknown): CharacterStates {
  if (!value || typeof value !== "object") {
    return {};
  }

  const moods: Mood[] = ["calm", "warm", "playful", "tired", "guarded"];
  const kinds: ImpressionKind[] = ["like", "dislike", "fact", "grudge"];
  const result: CharacterStates = {};
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const entry = raw as Record<string, unknown>;
    const base = defaultCharacterState(id);
    result[id] = {
      characterId: id,
      affinity: typeof entry.affinity === "number" ? clamp(entry.affinity, 0, 100) : base.affinity,
      mood: moods.includes(entry.mood as Mood) ? (entry.mood as Mood) : base.mood,
      energy: typeof entry.energy === "number" ? clamp(entry.energy, 0, 100) : base.energy,
      lastSeenAt: typeof entry.lastSeenAt === "number" ? entry.lastSeenAt : base.lastSeenAt,
      meetCount: typeof entry.meetCount === "number" && entry.meetCount >= 0 ? Math.floor(entry.meetCount) : base.meetCount,
      impressions: sanitizeImpressions(entry.impressions, kinds),
      schedule: sanitizeDayScript(entry.schedule),
      lastLifeTickAt: typeof entry.lastLifeTickAt === "number" ? entry.lastLifeTickAt : base.lastLifeTickAt,
      introducedAt: typeof entry.introducedAt === "number" ? entry.introducedAt : base.introducedAt
    };
  }
  return result;
}

function sanitizeImpressions(value: unknown, kinds: ImpressionKind[]): Impression[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: Impression[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const entry = raw as Record<string, unknown>;
    if (typeof entry.text !== "string" || !entry.text.trim() || !kinds.includes(entry.kind as ImpressionKind)) {
      continue;
    }
    const kind = entry.kind as ImpressionKind;
    result.push({
      id: typeof entry.id === "string" ? entry.id : `imp-${Math.random().toString(36).slice(2, 10)}`,
      kind,
      text: entry.text.trim(),
      weight: typeof entry.weight === "number" ? entry.weight : impressionWeight[kind],
      createdAt: typeof entry.createdAt === "number" ? entry.createdAt : 0
    });
  }
  return result.slice(0, MAX_IMPRESSIONS);
}

// 读取遗留的 localStorage 数据，仅用于一次性迁移到后端持久化。
export function loadCharacterStates(): CharacterStates {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeCharacterStates(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}
