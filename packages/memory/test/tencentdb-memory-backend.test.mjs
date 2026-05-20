import assert from "node:assert/strict";
import { test } from "node:test";

import { createTencentDbMemoryBackend } from "../src/tencentdb-memory-backend.ts";

test("tencentdb backend requires an injected client", () => {
  assert.throws(
    () => createTencentDbMemoryBackend(),
    /TencentDB memory client is required/
  );
});

test("tencentdb backend delegates captured conversation turns", async () => {
  const calls = [];
  const backend = createTencentDbMemoryBackend({
    captureConversationTurn: async (turn) => calls.push(turn),
    recallForPrompt: async () => []
  });

  const turn = {
    userId: "local-user",
    characterId: "shili",
    projectId: "cockapoo",
    sessionId: "session-1",
    userText: "我喜欢先听结论。",
    assistantText: "记住，后续先给结论。",
    createdAt: "2026-05-19T09:00:00.000+08:00"
  };

  await backend.captureConversationTurn(turn);

  assert.deepEqual(calls, [turn]);
});

test("tencentdb backend normalizes recalled rows", async () => {
  const backend = createTencentDbMemoryBackend({
    recallForPrompt: async (request) => [
      {
        id: "memory-1",
        scope: "user",
        memoryType: "preference",
        content: "用户喜欢先给结论。",
        score: 0.82,
        metadata: { sourceRef: request.userId },
        approved: true
      },
      {
        memory_id: "memory-2",
        layer: "session",
        type: "summary",
        memory: "这一轮在接 TencentDB 记忆适配。",
        confidence: "0.7",
        source: "session-1/2026-05-19T09:05:00.000+08:00"
      }
    ]
  });

  const recalled = await backend.recallForPrompt({
    userId: "local-user",
    characterId: "shili",
    projectId: "cockapoo",
    sessionId: "session-1",
    query: "记忆适配",
    mode: "companion",
    maxResults: 5
  });

  assert.deepEqual(recalled, [
    {
      id: "memory-1",
      scope: "user",
      kind: "preference",
      text: "用户喜欢先给结论。",
      confidence: 0.82,
      sourceRef: "local-user",
      approved: true
    },
    {
      id: "memory-2",
      scope: "session",
      kind: "session_summary",
      text: "这一轮在接 TencentDB 记忆适配。",
      confidence: 0.7,
      sourceRef: "session-1/2026-05-19T09:05:00.000+08:00"
    }
  ]);
});

test("tencentdb backend keeps unscoped session rows from compatible clients", async () => {
  const backend = createTencentDbMemoryBackend({
    recallForPrompt: async () => [
      {
        memory_id: "memory-1",
        layer: "session",
        type: "summary",
        memory: "这次在接真实记忆后端。"
      }
    ]
  });

  const recalled = await backend.recallForPrompt({
    userId: "local-user",
    characterId: "shili",
    query: "真实记忆",
    mode: "companion"
  });

  assert.equal(recalled[0].kind, "session_summary");
  assert.equal(recalled[0].text, "这次在接真实记忆后端。");
});

test("tencentdb backend delegates list and delete when supported", async () => {
  const calls = [];
  const backend = createTencentDbMemoryBackend({
    listMemories: async (scope, ownerId) => {
      calls.push(["list", scope, ownerId]);
      return [{ id: "memory-1", scope, kind: "project_note", text: "项目使用 Pi SDK。" }];
    },
    deleteMemory: async (id) => calls.push(["delete", id])
  });

  const listed = await backend.listMemories("project", "cockapoo");
  await backend.deleteMemory("memory-1");

  assert.equal(listed[0].text, "项目使用 Pi SDK。");
  assert.deepEqual(calls, [
    ["list", "project", "cockapoo"],
    ["delete", "memory-1"]
  ]);
});
