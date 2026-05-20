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

test("in-memory backend recalls only memories owned by the active character and session", async () => {
  const backend = createInMemoryBackend([
    {
      id: "shili-relationship",
      scope: "character",
      kind: "relationship_note",
      text: "用户希望开场白轻一点，不要审问。",
      characterId: "shili"
    },
    {
      id: "lulin-relationship",
      scope: "character",
      kind: "relationship_note",
      text: "用户希望开场白轻一点，不要审问。",
      characterId: "lulin"
    },
    {
      id: "current-session",
      scope: "session",
      kind: "session_summary",
      text: "用户希望开场白轻一点，不要审问。",
      sessionId: "session-shili",
      characterId: "shili"
    },
    {
      id: "other-session",
      scope: "session",
      kind: "session_summary",
      text: "用户希望开场白轻一点，不要审问。",
      sessionId: "session-lulin",
      characterId: "lulin"
    },
    {
      id: "global-user-preference",
      scope: "user",
      kind: "preference",
      text: "用户希望开场白轻一点，不要审问。",
      userId: "local-user"
    }
  ]);

  const recalled = await backend.recallForPrompt({
    userId: "local-user",
    characterId: "shili",
    sessionId: "session-shili",
    query: "开场白不要审问",
    mode: "companion",
    maxResults: 10
  });

  assert.deepEqual(
    recalled.map((memory) => memory.id),
    ["shili-relationship", "current-session", "global-user-preference"]
  );
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
