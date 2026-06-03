import assert from "node:assert/strict";
import { test } from "node:test";

import { createChatHistoryMemoryBackend } from "../src/chat-history-memory-backend.mjs";

test("chat history memory backend recalls relevant non-system messages", async () => {
  const backend = createChatHistoryMemoryBackend({
    sessionId: "session-1",
    messages: [
      {
        id: "m1",
        speaker: "user",
        text: "我喜欢你先给结论，再补充细节。",
        createdAt: "2026-05-19T10:00:00.000+08:00"
      },
      {
        id: "m2",
        speaker: "character",
        text: "记住这个表达偏好。",
        createdAt: "2026-05-19T10:01:00.000+08:00"
      },
      {
        id: "m3",
        speaker: "system",
        text: "模型供应商连接失败。",
        createdAt: "2026-05-19T10:02:00.000+08:00"
      }
    ]
  });

  const recalled = await backend.recallForPrompt({
    userId: "local-user",
    characterId: "shili",
    query: "回答时先给结论",
    mode: "companion"
  });

  assert.equal(recalled.length, 1);
  assert.equal(recalled[0].scope, "session");
  assert.equal(recalled[0].kind, "session_summary");
  assert.match(recalled[0].text, /先给结论/);
  assert.doesNotMatch(recalled[0].text, /模型供应商/);
});

test("chat history memory backend limits recalled memories", async () => {
  const backend = createChatHistoryMemoryBackend({
    sessionId: "session-1",
    messages: [
      { id: "m1", speaker: "user", text: "本地记忆 A", createdAt: "1" },
      { id: "m2", speaker: "character", text: "本地记忆 B", createdAt: "2" },
      { id: "m3", speaker: "user", text: "本地记忆 C", createdAt: "3" }
    ]
  });

  const recalled = await backend.recallForPrompt({
    userId: "local-user",
    characterId: "shili",
    query: "本地记忆",
    mode: "companion",
    maxResults: 2
  });

  assert.equal(recalled.length, 2);
});
