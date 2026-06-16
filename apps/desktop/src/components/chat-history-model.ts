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

// 会话分组的桶标签：默认中文，调用方（App.tsx）传入按界面语言翻译后的文案。
export type SessionGroupLabels = {
  today: string;
  yesterday: string;
  earlier: string;
};

const DEFAULT_SESSION_GROUP_LABELS: SessionGroupLabels = {
  today: "今天",
  yesterday: "昨天",
  earlier: "更早"
};

export type GroupChatSessionsOptions = {
  activeSessionId?: string | null;
  now?: Date;
  labels?: SessionGroupLabels;
};

type SessionBucket = "today" | "yesterday" | "earlier";

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

function sessionBucket(updatedAt: Date, now: Date): SessionBucket {
  const diffDays = Math.round((dayStart(now) - dayStart(updatedAt)) / 86_400_000);

  if (diffDays <= 0) {
    return "today";
  }

  if (diffDays === 1) {
    return "yesterday";
  }

  return "earlier";
}

function formatSessionTime(updatedAt: Date, bucket: SessionBucket, labels: SessionGroupLabels) {
  if (bucket === "today") {
    return formatClockTime(updatedAt);
  }

  if (bucket === "yesterday") {
    return labels.yesterday;
  }

  return formatMonthDayNumeric(updatedAt);
}

const SESSION_BUCKET_ORDER: SessionBucket[] = ["today", "yesterday", "earlier"];

export function groupChatSessions(
  sessions: ChatSessionSummary[],
  { activeSessionId = null, now = new Date(), labels = DEFAULT_SESSION_GROUP_LABELS }: GroupChatSessionsOptions = {}
): SessionGroup[] {
  const groups = new Map<SessionBucket, SessionGroup>();

  for (const session of sessions) {
    const updatedAt = parseStoredTimestamp(session.updatedAt);
    const bucket = sessionBucket(updatedAt, now);
    const group = groups.get(bucket) ?? { group: labels[bucket], items: [] };

    group.items.push({
      id: session.id,
      title: session.title,
      time: formatSessionTime(updatedAt, bucket, labels),
      active: session.id === activeSessionId
    });
    groups.set(bucket, group);
  }

  return SESSION_BUCKET_ORDER
    .map((bucket) => groups.get(bucket))
    .filter((group): group is SessionGroup => Boolean(group));
}

export function findLatestCharacterSession(sessions: ChatSessionSummary[], characterId: string) {
  return sessions
    .filter((session) => session.characterId === characterId)
    .sort((left, right) => parseStoredTimestamp(right.updatedAt).getTime() - parseStoredTimestamp(left.updatedAt).getTime())[0] ?? null;
}
