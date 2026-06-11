import type { ChatMessage } from "./chat-model.ts";
import type { SessionGroup } from "./sidebar-model.ts";
import { formatClockTime, formatMonthDayNumeric } from "../i18n/formatters.ts";

export type ChatSessionSummary = {
  id: string;
  characterId: string;
  title: string;
  updatedAt: string;
  lastMessagePreview: string;
};

export type ChatSessionDetail = {
  session: ChatSessionSummary;
  messages: ChatMessage[];
};

export type CreateChatSessionRequest = {
  characterId: string;
  title: string;
};

export type AppendChatMessageRequest = {
  sessionId: string;
  speaker: ChatMessage["speaker"];
  author: string;
  text: string;
  stickerId?: string;
  modelRoute?: string;
  providerId?: string;
  // 该消息所属角色 id：用于把返回消息的表情解析到正确角色的素材，
  // 避免实时聊天时表情包混成默认角色（Rust 端忽略未知字段，故不影响持久化）。
  characterId?: string;
};

export type GroupChatSessionsOptions = {
  activeSessionId?: string | null;
  now?: Date;
};

export type NewDraftSessionState = {
  activeSessionId?: string | null;
  isDraftPending?: boolean;
  isSending?: boolean;
};

export function canStartNewDraftSession({ activeSessionId = null, isDraftPending = false, isSending = false }: NewDraftSessionState) {
  return Boolean(activeSessionId) && !isDraftPending && !isSending;
}

function normalizeTitleText(text: string) {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, "$1$2");
}

export function createSessionTitle(text: string) {
  const normalized = normalizeTitleText(text);

  if (!normalized) {
    return "新对话";
  }

  return Array.from(normalized).slice(0, 18).join("");
}

function dayStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function parseStoredTimestamp(value: string) {
  if (/^\d+$/.test(value)) {
    return new Date(Number(value));
  }

  return new Date(value);
}

function sessionBucket(updatedAt: Date, now: Date) {
  const diffDays = Math.round((dayStart(now) - dayStart(updatedAt)) / 86_400_000);

  if (diffDays <= 0) {
    return "今天";
  }

  if (diffDays === 1) {
    return "昨天";
  }

  return "更早";
}

function formatSessionTime(updatedAt: Date, bucket: string) {
  if (bucket === "今天") {
    return formatClockTime(updatedAt);
  }

  if (bucket === "昨天") {
    return "昨天";
  }

  return formatMonthDayNumeric(updatedAt);
}

export function groupChatSessions(
  sessions: ChatSessionSummary[],
  { activeSessionId = null, now = new Date() }: GroupChatSessionsOptions = {}
): SessionGroup[] {
  const groups = new Map<string, SessionGroup>();

  for (const session of sessions) {
    const updatedAt = parseStoredTimestamp(session.updatedAt);
    const bucket = sessionBucket(updatedAt, now);
    const group = groups.get(bucket) ?? { group: bucket, items: [] };

    group.items.push({
      id: session.id,
      title: session.title,
      time: formatSessionTime(updatedAt, bucket),
      active: session.id === activeSessionId
    });
    groups.set(bucket, group);
  }

  return ["今天", "昨天", "更早"]
    .map((bucket) => groups.get(bucket))
    .filter((group): group is SessionGroup => Boolean(group));
}

export function findLatestCharacterSession(sessions: ChatSessionSummary[], characterId: string) {
  return sessions
    .filter((session) => session.characterId === characterId)
    .sort((left, right) => parseStoredTimestamp(right.updatedAt).getTime() - parseStoredTimestamp(left.updatedAt).getTime())[0] ?? null;
}
