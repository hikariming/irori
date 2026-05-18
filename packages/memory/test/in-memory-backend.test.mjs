import assert from "node:assert/strict";
import { test } from "node:test";

import { createInMemoryBackend } from "../src/in-memory-backend.ts";

test("in-memory backend recalls seeded memories by query text", async () => {
  const backend = createInMemoryBackend([
    {
      id: "memory-1",
      scope: "user",
      kind: "preference",
      text: "用户偏好先给结论，再补充细节。"
    },
    {
      id: "memory-2",
      scope: "project",
      kind: "project_note",
      text: "Cockapoo 使用 Tauri 和 Pi SDK。"
    }
  ]);

  const recalled = await backend.recallForPrompt({
    userId: "local-user",
    characterId: "shili",
    query: "回答时先给结论",
    mode: "companion"
  });

  assert.equal(recalled.length, 1);
  assert.equal(recalled[0].id, "memory-1");
});

test("in-memory backend captures turns as session summaries and can delete memories", async () => {
  const backend = createInMemoryBackend();

  await backend.captureConversationTurn({
    userId: "local-user",
    characterId: "shili",
    sessionId: "session-1",
    userText: "我们先做本地记忆。",
    assistantText: "好，我先铺接口。",
    createdAt: "2026-05-18T12:00:00.000+08:00"
  });

  const listed = await backend.listMemories("session", "session-1");

  assert.equal(listed.length, 1);
  assert.equal(listed[0].kind, "session_summary");
  assert.match(listed[0].text, /我们先做本地记忆/);

  await backend.deleteMemory(listed[0].id);

  assert.deepEqual(await backend.listMemories("session", "session-1"), []);
});
