import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPromptWithMemory, captureMemoryTurn } from "../src/memory-bridge.mjs";

test("buildPromptWithMemory injects recalled memory context before the prompt", async () => {
  const prompt = "用户：继续做记忆";
  const memoryBackend = {
    async recallForPrompt() {
      return [
        {
          id: "memory-1",
          scope: "user",
          kind: "preference",
          text: "用户偏好先给结论，再补充细节。"
        }
      ];
    }
  };

  const result = await buildPromptWithMemory({
    prompt,
    memoryBackend,
    recallRequest: {
      userId: "local-user",
      characterId: "shili",
      query: "继续做记忆",
      mode: "companion"
    }
  });

  assert.match(result.prompt, /^<memory-context>/);
  assert.match(result.prompt, /用户偏好先给结论/);
  assert.match(result.prompt, /用户：继续做记忆$/);
  assert.equal(result.memories.length, 1);
});

test("buildPromptWithMemory keeps the original prompt when no memories are recalled", async () => {
  const prompt = "用户：你好";
  const result = await buildPromptWithMemory({
    prompt,
    memoryBackend: {
      async recallForPrompt() {
        return [];
      }
    },
    recallRequest: {
      userId: "local-user",
      characterId: "shili",
      query: "你好",
      mode: "companion"
    }
  });

  assert.equal(result.prompt, prompt);
  assert.deepEqual(result.memories, []);
});

test("captureMemoryTurn delegates completed turns to the backend", async () => {
  const captured = [];

  await captureMemoryTurn({
    memoryBackend: {
      async captureConversationTurn(turn) {
        captured.push(turn);
      }
    },
    turn: {
      userId: "local-user",
      characterId: "shili",
      sessionId: "session-1",
      userText: "继续做记忆",
      assistantText: "好，我先接 recall。",
      createdAt: "2026-05-19T10:00:00.000+08:00"
    }
  });

  assert.equal(captured.length, 1);
  assert.equal(captured[0].assistantText, "好，我先接 recall。");
});
