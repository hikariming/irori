import assert from "node:assert/strict";
import { test } from "node:test";

import { buildToolRuntime } from "../src/tool-policy-runtime.mjs";

test("buildToolRuntime maps policy ids to Pi-compatible tool names and omits unsupported custom tools", () => {
  const runtime = buildToolRuntime({
    settings: {
      builtinTools: {
        read: true,
        grep: true,
        find: false,
        ls: false,
        bash: false,
        edit: false,
        write: false
      },
      customTools: {
        "memory.read": true,
        "memory.write": true,
        "web.fetch": true,
        "browser.action": true
      },
      confirmTools: {
        bash: true,
        "browser.action": true
      },
      protectedPaths: [".env"]
    },
    memoryBackend: {
      async recallForPrompt() {
        return [];
      },
      async captureConversationTurn() {
      }
    },
    memoryRecallRequest: {
      userId: "local-user",
      characterId: "shili",
      query: "偏好",
      mode: "companion"
    }
  });

  assert.deepEqual(runtime.tools, ["read", "grep", "memory_read", "memory_write"]);
  assert.deepEqual(runtime.summary.enabledTools, ["read", "grep", "memory.read", "memory.write"]);
  assert.deepEqual(runtime.summary.registeredCustomTools, ["memory.read", "memory.write"]);
  assert.deepEqual(runtime.summary.unsupportedCustomTools, ["web.fetch", "browser.action"]);
});

test("memory_read tool recalls memory through the active memory backend", async () => {
  let recallRequest;
  const runtime = buildToolRuntime({
    settings: {
      builtinTools: {},
      customTools: {
        "memory.read": true
      },
      confirmTools: {},
      protectedPaths: []
    },
    memoryBackend: {
      async recallForPrompt(request) {
        recallRequest = request;
        return [
          {
            id: "memory-1",
            scope: "user",
            kind: "preference",
            text: "用户喜欢先给结论。"
          }
        ];
      }
    },
    memoryRecallRequest: {
      userId: "local-user",
      characterId: "shili",
      query: "默认查询",
      mode: "companion",
      maxResults: 3
    }
  });

  const result = await runtime.customTools[0].execute("tool-call-1", {
    query: "回答风格",
    maxResults: 1
  });

  assert.equal(recallRequest.query, "回答风格");
  assert.equal(recallRequest.maxResults, 1);
  assert.match(result.content[0].text, /用户喜欢先给结论/);
});

test("memory_write tool captures an approved memory through the active backend", async () => {
  let capturedTurn;
  const runtime = buildToolRuntime({
    settings: {
      builtinTools: {},
      customTools: {
        "memory.write": true
      },
      confirmTools: {},
      protectedPaths: []
    },
    memoryBackend: {
      async captureConversationTurn(turn) {
        capturedTurn = turn;
      }
    },
    memoryRecallRequest: {
      userId: "local-user",
      characterId: "shili",
      projectId: "cockapoo",
      sessionId: "session-1",
      query: "写入记忆",
      mode: "companion"
    }
  });

  const result = await runtime.customTools[0].execute("tool-call-1", {
    kind: "preference",
    text: "用户喜欢先给结论，再补充关键细节。",
    reason: "用户明确表达过回答风格偏好。"
  });

  assert.equal(capturedTurn.userId, "local-user");
  assert.equal(capturedTurn.characterId, "shili");
  assert.equal(capturedTurn.projectId, "cockapoo");
  assert.equal(capturedTurn.sessionId, "session-1");
  assert.equal(capturedTurn.userText, "用户喜欢先给结论，再补充关键细节。");
  assert.match(capturedTurn.assistantText, /记忆写入工具/);
  assert.equal(result.details.status, "saved");
  assert.match(result.content[0].text, /已保存记忆/);
});

test("memory_write tool honors policy confirmation before saving", async () => {
  let captureCount = 0;
  const runtime = buildToolRuntime({
    settings: {
      builtinTools: {},
      customTools: {
        "memory.write": true
      },
      confirmTools: {
        "memory.write": true
      },
      protectedPaths: []
    },
    memoryBackend: {
      async captureConversationTurn() {
        captureCount += 1;
      }
    },
    memoryRecallRequest: {
      userId: "local-user",
      characterId: "shili",
      sessionId: "session-1",
      query: "写入记忆",
      mode: "companion"
    }
  });

  const result = await runtime.customTools[0].execute("tool-call-1", {
    kind: "preference",
    text: "用户喜欢简洁回答。"
  });

  assert.equal(captureCount, 0);
  assert.equal(result.details.status, "needs_approval");
  assert.match(result.content[0].text, /确认/);
});

test("memory_write tool rejects empty or sensitive memory candidates", async () => {
  let captureCount = 0;
  const runtime = buildToolRuntime({
    settings: {
      builtinTools: {},
      customTools: {
        "memory.write": true
      },
      confirmTools: {},
      protectedPaths: []
    },
    memoryBackend: {
      async captureConversationTurn() {
        captureCount += 1;
      }
    },
    memoryRecallRequest: {
      userId: "local-user",
      characterId: "shili",
      sessionId: "session-1",
      query: "写入记忆",
      mode: "companion"
    }
  });

  const emptyResult = await runtime.customTools[0].execute("tool-call-1", {
    kind: "preference",
    text: ""
  });
  const sensitiveResult = await runtime.customTools[0].execute("tool-call-2", {
    kind: "project_note",
    text: "用户的 API key 是 sk-test-secret"
  });

  assert.equal(captureCount, 0);
  assert.equal(emptyResult.details.status, "rejected");
  assert.equal(sensitiveResult.details.status, "rejected");
  assert.match(sensitiveResult.content[0].text, /敏感信息/);
});
