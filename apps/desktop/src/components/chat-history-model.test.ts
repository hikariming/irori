import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canStartNewDraftSession,
  createSessionTitle,
  findLatestCharacterSession,
  groupChatSessions,
  shouldGenerateOpeningMessage,
  type ChatSessionSummary
} from "./chat-history-model.ts";

test("createSessionTitle uses the first user message and normalizes whitespace", () => {
  assert.equal(createSessionTitle("  先把\n聊天历史 存起来，然后再做记忆  "), "先把聊天历史存起来，然后再做记忆");
  assert.equal(createSessionTitle("这是一段很长很长的中文消息，用来生成会话标题"), "这是一段很长很长的中文消息，用来生成");
  assert.equal(createSessionTitle(""), "新对话");
});

test("groupChatSessions groups summaries into today, yesterday, and earlier buckets", () => {
  const sessions: ChatSessionSummary[] = [
    {
      id: "today-session",
      characterId: "shili",
      title: "今天的对话",
      updatedAt: "2026-05-18T10:42:00.000+08:00",
      lastMessagePreview: "今天继续做"
    },
    {
      id: "yesterday-session",
      characterId: "shili",
      title: "昨天的对话",
      updatedAt: "2026-05-17T22:18:00.000+08:00",
      lastMessagePreview: "昨天聊过"
    },
    {
      id: "earlier-session",
      characterId: "shili",
      title: "更早的对话",
      updatedAt: "2026-05-10T09:00:00.000+08:00",
      lastMessagePreview: "更早的记录"
    }
  ];

  const groups = groupChatSessions(sessions, {
    activeSessionId: "yesterday-session",
    now: new Date("2026-05-18T12:00:00.000+08:00")
  });

  assert.deepEqual(
    groups.map((group) => group.group),
    ["今天", "昨天", "更早"]
  );
  assert.equal(groups[0].items[0].id, "today-session");
  assert.equal(groups[0].items[0].time, "10:42");
  assert.equal(groups[1].items[0].id, "yesterday-session");
  assert.equal(groups[1].items[0].active, true);
  assert.equal(groups[1].items[0].time, "昨天");
  assert.equal(groups[2].items[0].time, "5/10");
});

test("groupChatSessions accepts millisecond timestamps from the Tauri store", () => {
  const updatedAt = new Date("2026-05-18T10:42:00.000+08:00").getTime().toString();
  const groups = groupChatSessions(
    [
      {
        id: "tauri-session",
        characterId: "shili",
        title: "Tauri 历史",
        updatedAt,
        lastMessagePreview: "毫秒时间戳"
      }
    ],
    { now: new Date("2026-05-18T12:00:00.000+08:00") }
  );

  assert.equal(groups[0].group, "今天");
  assert.equal(groups[0].items[0].time, "10:42");
});

test("findLatestCharacterSession returns the newest session for a character", () => {
  const sessions: ChatSessionSummary[] = [
    {
      id: "older-lulin",
      characterId: "lulin",
      title: "陆临旧会话",
      updatedAt: "2026-05-18T10:42:00.000+08:00",
      lastMessagePreview: "旧一点"
    },
    {
      id: "newer-shili",
      characterId: "shili",
      title: "示璃新会话",
      updatedAt: "2026-05-20T10:42:00.000+08:00",
      lastMessagePreview: "不是当前角色"
    },
    {
      id: "newer-lulin",
      characterId: "lulin",
      title: "陆临新会话",
      updatedAt: "2026-05-19T22:18:00.000+08:00",
      lastMessagePreview: "最近一次"
    }
  ];

  assert.equal(findLatestCharacterSession(sessions, "lulin")?.id, "newer-lulin");
  assert.equal(findLatestCharacterSession(sessions, "shenyanzhou"), null);
});

test("canStartNewDraftSession only allows leaving an active saved session", () => {
  assert.equal(canStartNewDraftSession({ activeSessionId: "session-1" }), true);
  assert.equal(canStartNewDraftSession({ activeSessionId: null }), false);
  assert.equal(canStartNewDraftSession({ activeSessionId: undefined }), false);
  assert.equal(canStartNewDraftSession({ activeSessionId: "session-1", isSending: true }), false);
  assert.equal(canStartNewDraftSession({ activeSessionId: "session-1", isDraftPending: true }), false);
});

test("shouldGenerateOpeningMessage requires an explicit request for a draft session", () => {
  assert.equal(shouldGenerateOpeningMessage({ activeSessionId: null, modelReady: true, requested: true }), true);
  assert.equal(shouldGenerateOpeningMessage({ activeSessionId: null, modelReady: true, requested: false }), false);
  assert.equal(shouldGenerateOpeningMessage({ activeSessionId: "session-1", modelReady: true, requested: true }), false);
  assert.equal(shouldGenerateOpeningMessage({ activeSessionId: null, modelReady: false, requested: true }), false);
});
