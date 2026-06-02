import type { CharacterCard } from "./character-cards.ts";
import type { Mood } from "./character-state.ts";

// 一天里一个时间条目的类别，用于上色/统计与默认效果。
export type ScheduleCategory =
  | "sleep"
  | "meal"
  | "work"
  | "study"
  | "reading"
  | "outing"
  | "social"
  | "leisure"
  | "chore"
  | "rest";

export type ScheduleStatus = "pending" | "executed";

// 时间线上的一个时刻：从 startMinutes 起，角色在 location 做 activity。
// 带 energy/mood 效果，执行后会真实推进角色状态——这是「虚拟生活」会留下痕迹的关键。
export type ScheduleItem = {
  startMinutes: number; // 距 00:00 的分钟数 0-1439
  activity: string; // 一句话：在干嘛
  location: string; // 在哪：卧室/阳台/厨房/外面…
  category: ScheduleCategory;
  energyEffect: number; // 执行后对精力的增减，约 -25..+15
  moodShift: Mood | null; // 执行后可能转成的心情，可空
  status: ScheduleStatus;
};

// 某个角色某一天的作息脚本。按 startMinutes 升序。
export type DayScript = {
  characterId: string;
  date: string; // 本地 YYYY-MM-DD
  items: ScheduleItem[];
  generatedAt: number;
  source: "llm" | "skeleton"; // 来自模型还是兜底骨架；骨架在模型就绪后会被升级
};

const MOODS: Mood[] = ["calm", "warm", "playful", "tired", "guarded"];
const CATEGORIES: ScheduleCategory[] = [
  "sleep",
  "meal",
  "work",
  "study",
  "reading",
  "outing",
  "social",
  "leisure",
  "chore",
  "rest"
];

const MIN_ITEMS = 5;
const MAX_ITEMS = 16;
const MAX_ACTIVITY_LENGTH = 40;
const MAX_LOCATION_LENGTH = 16;

// 本地日期字符串 YYYY-MM-DD（按运行环境时区）。
export function toDateStr(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// 当天的分钟数 0-1439。
export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

// 解析 "HH:MM" 成分钟数；非法返回 null。
function parseClock(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clampMinutes(Math.round(value));
  }
  if (typeof value !== "string") {
    return null;
  }
  const match = value.trim().match(/^(\d{1,2})\s*[:：]\s*(\d{1,2})$/);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const mins = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(mins) || hours > 23 || mins > 59) {
    return null;
  }
  return hours * 60 + mins;
}

function clampMinutes(value: number): number {
  return Math.max(0, Math.min(1439, value));
}

function clampEnergyEffect(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) {
    return 0;
  }
  return Math.max(-30, Math.min(20, Math.round(num)));
}

// 一套通用作息骨架：LLM 不可用（如浏览器预览/离线）时的兜底，保证每天都有时间线。
const DEFAULT_DAY_TEMPLATE: Omit<ScheduleItem, "status">[] = [
  { startMinutes: 0, activity: "睡着了，做着乱七八糟的梦", location: "卧室", category: "sleep", energyEffect: 18, moodShift: "calm" },
  { startMinutes: 8 * 60, activity: "慢慢醒来，赖了会儿床", location: "卧室", category: "rest", energyEffect: 6, moodShift: "calm" },
  { startMinutes: 8 * 60 + 40, activity: "随便弄了点早饭", location: "厨房", category: "meal", energyEffect: 8, moodShift: "warm" },
  { startMinutes: 10 * 60, activity: "忙自己手头的事", location: "书桌前", category: "work", energyEffect: -10, moodShift: null },
  { startMinutes: 12 * 60 + 30, activity: "吃午饭，有点犯困", location: "厨房", category: "meal", energyEffect: 4, moodShift: "tired" },
  { startMinutes: 14 * 60, activity: "看会儿书，走神又拉回来", location: "阳台", category: "reading", energyEffect: -4, moodShift: "calm" },
  { startMinutes: 16 * 60 + 30, activity: "出门走走透透气", location: "外面", category: "outing", energyEffect: -6, moodShift: "playful" },
  { startMinutes: 19 * 60, activity: "做晚饭，顺手收拾了下", location: "厨房", category: "chore", energyEffect: -8, moodShift: null },
  { startMinutes: 21 * 60, activity: "窝着放空，刷刷东西", location: "沙发", category: "leisure", energyEffect: 4, moodShift: "warm" },
  { startMinutes: 23 * 60, activity: "困了，准备睡了", location: "卧室", category: "rest", energyEffect: 10, moodShift: "tired" }
];

// 兜底作息：从模板生成当天 DayScript（全部 pending）。
export function defaultDaySkeleton(characterId: string, date: string, now: number = 0): DayScript {
  return {
    characterId,
    date,
    generatedAt: now,
    source: "skeleton",
    items: DEFAULT_DAY_TEMPLATE.map((item) => ({ ...item, status: "pending" as const }))
  };
}

// 让 LLM 给某个角色生成一整天作息的一次性 prompt。要求结构化 JSON 数组输出。
export function composeDayScriptPrompt(card: CharacterCard, date: string): string {
  return [
    `你是 ${card.name}。`,
    `人设：${card.persona}`,
    `说话风格：${card.speakingStyle}`,
    "",
    `现在请你规划 ${date} 这一整天你自己的生活安排（不是和 ta 聊天，是你独处时真实在过的一天）。`,
    "从凌晨睡觉到深夜，按时间顺序排 8~12 件事，要符合你的人设与习惯，具体、有生活感、彼此连贯。",
    "",
    "严格只输出一个 JSON 数组，每个元素形如：",
    '{"time":"HH:MM","activity":"在做什么(一句话)","location":"在哪","category":"类别","energy":数字,"mood":"心情或空"}',
    `category 从这些里选：${CATEGORIES.join(" / ")}。`,
    "energy 是这件事做完对你精力的增减（睡觉/休息为正，劳累/外出为负，约 -25 到 +18）。",
    `mood 留空或从这些里选：${MOODS.join(" / ")}。`,
    "不要任何解释、不要 Markdown、不要数组以外的字符。"
  ].join("\n");
}

// 从模型输出解析出 DayScript；解析失败 / 为空时回退到默认骨架。
export function parseDayScript(raw: string, characterId: string, date: string, now: number = 0): DayScript {
  const items = extractScheduleItems(raw);
  if (items.length < MIN_ITEMS) {
    return defaultDaySkeleton(characterId, date, now);
  }
  return { characterId, date, generatedAt: now, source: "llm", items };
}

function extractScheduleItems(raw: string): ScheduleItem[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end <= start) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }

  const items: ScheduleItem[] = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const entry = raw as Record<string, unknown>;
    const startMinutes = parseClock(entry.time ?? entry.startMinutes);
    const activity = typeof entry.activity === "string" ? entry.activity.replace(/\s+/g, " ").trim().slice(0, MAX_ACTIVITY_LENGTH) : "";
    if (startMinutes === null || !activity) {
      continue;
    }
    const location = typeof entry.location === "string" ? entry.location.replace(/\s+/g, " ").trim().slice(0, MAX_LOCATION_LENGTH) : "";
    const category = CATEGORIES.includes(entry.category as ScheduleCategory) ? (entry.category as ScheduleCategory) : "leisure";
    const moodShift = MOODS.includes(entry.mood as Mood) ? (entry.mood as Mood) : null;
    items.push({
      startMinutes,
      activity,
      location,
      category,
      energyEffect: clampEnergyEffect(entry.energy ?? entry.energyEffect),
      moodShift,
      status: "pending"
    });
  }

  // 按时间排序、去掉同一时刻重复，限制条目数。
  items.sort((a, b) => a.startMinutes - b.startMinutes);
  const deduped: ScheduleItem[] = [];
  for (const item of items) {
    if (deduped.length > 0 && deduped[deduped.length - 1].startMinutes === item.startMinutes) {
      continue;
    }
    deduped.push(item);
  }
  return deduped.slice(0, MAX_ITEMS);
}

// 此刻（atMinutes 分钟）正在进行的条目：最后一个 startMinutes <= atMinutes 的；
// 若都在之后（凌晨早于首项），算作昨夜延续的最后一项（通常是睡觉）。
export function currentItem(script: DayScript, atMinutes: number): ScheduleItem | null {
  if (script.items.length === 0) {
    return null;
  }
  let active: ScheduleItem | null = null;
  for (const item of script.items) {
    if (item.startMinutes <= atMinutes) {
      active = item;
    } else {
      break;
    }
  }
  return active ?? script.items[script.items.length - 1];
}

// 把一个作息条目翻成短语，如「在阳台看会儿书」（无 location 时只用 activity）。
export function scheduleItemPhrase(item: ScheduleItem): string {
  return item.location ? `在${item.location}${item.activity}` : item.activity;
}

// 把「此刻在干嘛」翻译成可注入 prompt 的短语，如「在阳台看会儿书」。
export function describeNowActivity(script: DayScript, atMinutes: number): string | null {
  const item = currentItem(script, atMinutes);
  return item ? scheduleItemPhrase(item) : null;
}

// 把截至 atMinutes 应该已发生的 pending 条目标记为 executed，返回新 script 与这次新执行的条目。
export function markExecutedUpTo(
  script: DayScript,
  atMinutes: number
): { script: DayScript; newlyExecuted: ScheduleItem[] } {
  const newlyExecuted: ScheduleItem[] = [];
  const items = script.items.map((item) => {
    if (item.status === "pending" && item.startMinutes <= atMinutes) {
      const executed = { ...item, status: "executed" as const };
      newlyExecuted.push(executed);
      return executed;
    }
    return item;
  });
  return { script: { ...script, items }, newlyExecuted };
}

// 校验 / 净化从持久化里读回来的 DayScript；非法返回 null。
export function sanitizeDayScript(value: unknown): DayScript | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const entry = value as Record<string, unknown>;
  if (typeof entry.characterId !== "string" || typeof entry.date !== "string" || !Array.isArray(entry.items)) {
    return null;
  }
  const items: ScheduleItem[] = [];
  for (const raw of entry.items) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const it = raw as Record<string, unknown>;
    if (typeof it.startMinutes !== "number" || typeof it.activity !== "string" || !it.activity.trim()) {
      continue;
    }
    items.push({
      startMinutes: clampMinutes(Math.round(it.startMinutes)),
      activity: it.activity.trim().slice(0, MAX_ACTIVITY_LENGTH),
      location: typeof it.location === "string" ? it.location.trim().slice(0, MAX_LOCATION_LENGTH) : "",
      category: CATEGORIES.includes(it.category as ScheduleCategory) ? (it.category as ScheduleCategory) : "leisure",
      energyEffect: clampEnergyEffect(it.energyEffect),
      moodShift: MOODS.includes(it.moodShift as Mood) ? (it.moodShift as Mood) : null,
      status: it.status === "executed" ? "executed" : "pending"
    });
  }
  if (items.length === 0) {
    return null;
  }
  items.sort((a, b) => a.startMinutes - b.startMinutes);
  return {
    characterId: entry.characterId,
    date: entry.date,
    generatedAt: typeof entry.generatedAt === "number" ? entry.generatedAt : 0,
    source: entry.source === "llm" ? "llm" : "skeleton",
    items: items.slice(0, MAX_ITEMS)
  };
}
