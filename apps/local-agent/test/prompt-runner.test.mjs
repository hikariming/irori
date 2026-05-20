import assert from "node:assert/strict";
import { test } from "node:test";

import { collectAssistantText, runCockapooPiPrompt } from "../src/prompt-runner.mjs";

test("runCockapooPiPrompt dry run returns the selected route without calling a model", async () => {
  const result = await runCockapooPiPrompt({
    cwd: "/tmp/cockapoo-workspace",
    modelSettings: {
      baseUrl: "http://localhost:11434/v1",
      modelName: "qwen3-coder"
    },
    prompt: "你好，示璃",
    dryRun: true
  });

  assert.equal(result.providerId, "openai-compatible");
  assert.equal(result.modelRoute, "POST http://localhost:11434/v1/chat/completions · body.model = qwen3-coder");
  assert.match(result.text, /Pi session ready/);
});

test("runCockapooPiPrompt requires a token outside dry run", async () => {
  await assert.rejects(
    () =>
      runCockapooPiPrompt({
        cwd: "/tmp/cockapoo-workspace",
        modelSettings: {
          baseUrl: "https://api.openai.com/v1",
          modelName: "gpt-5.2"
        },
        prompt: "你好，示璃"
      }),
    /token/
  );
});

test("runCockapooPiPrompt reports the real OpenAI-compatible request route", async () => {
  const result = await runCockapooPiPrompt({
    cwd: "/tmp/cockapoo-workspace",
    modelSettings: {
      baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
      modelName: "GLM-5.1"
    },
    runtimeToken: "sk-test",
    prompt: "你好",
    createSession: async () => {
      let onEvent = () => {};

      return {
        session: {
          subscribe(callback) {
            onEvent = callback;
            return () => {};
          },
          async prompt() {
            onEvent({
              type: "message_update",
              assistantMessageEvent: {
                type: "text_end",
                content: "OK"
              }
            });
          },
          dispose() {}
        }
      };
    }
  });

  assert.equal(
    result.modelRoute,
    "POST https://open.bigmodel.cn/api/coding/paas/v4/chat/completions · body.model = GLM-5.1"
  );
});

test("runCockapooPiPrompt injects recalled memory and captures successful turns", async () => {
  let promptSentToPi = "";
  const capturedTurns = [];
  const result = await runCockapooPiPrompt({
    cwd: "/tmp/cockapoo-workspace",
    modelSettings: {
      baseUrl: "https://api.openai.com/v1",
      modelName: "gpt-5.2"
    },
    runtimeToken: "sk-test",
    prompt: "用户：继续做记忆",
    memoryBackend: {
      async recallForPrompt() {
        return [
          {
            id: "memory-1",
            scope: "user",
            kind: "preference",
            text: "用户偏好先给结论。"
          }
        ];
      },
      async captureConversationTurn(turn) {
        capturedTurns.push(turn);
      }
    },
    memoryRecallRequest: {
      userId: "local-user",
      characterId: "shili",
      query: "继续做记忆",
      mode: "companion"
    },
    memoryCaptureTurn: {
      userId: "local-user",
      characterId: "shili",
      sessionId: "session-1",
      userText: "继续做记忆"
    },
    createSession: async () => {
      let onEvent = () => {};

      return {
        session: {
          subscribe(callback) {
            onEvent = callback;
            return () => {};
          },
          async prompt(prompt) {
            promptSentToPi = prompt;
            onEvent({
              type: "message_update",
              assistantMessageEvent: {
                type: "text_end",
                content: "好，我先接记忆上下文。"
              }
            });
          },
          dispose() {}
        }
      };
    }
  });

  assert.match(promptSentToPi, /^<memory-context>/);
  assert.match(promptSentToPi, /用户偏好先给结论/);
  assert.match(promptSentToPi, /用户：继续做记忆$/);
  assert.equal(result.text, "好，我先接记忆上下文。");
  assert.equal(result.recalledMemories.length, 1);
  assert.equal(capturedTurns.length, 1);
  assert.equal(capturedTurns[0].assistantText, "好，我先接记忆上下文。");
});

test("runCockapooPiPrompt can recall memory for opening messages without capturing a turn", async () => {
  let promptSentToPi = "";
  let captureCount = 0;
  const result = await runCockapooPiPrompt({
    cwd: "/tmp/cockapoo-workspace",
    modelSettings: {
      baseUrl: "https://api.openai.com/v1",
      modelName: "gpt-5.2"
    },
    runtimeToken: "sk-test",
    prompt: "请生成一句自然开场白。",
    memoryBackend: {
      async recallForPrompt(request) {
        assert.equal(request.characterId, "shili");
        return [
          {
            id: "memory-1",
            scope: "character",
            kind: "relationship_note",
            text: "用户不喜欢一上来被连续追问。",
            characterId: "shili"
          }
        ];
      },
      async captureConversationTurn() {
        captureCount += 1;
      }
    },
    memoryRecallRequest: {
      userId: "local-user",
      characterId: "shili",
      query: "开场白",
      mode: "companion",
      maxResults: 5
    },
    createSession: async () => {
      let onEvent = () => {};

      return {
        session: {
          subscribe(callback) {
            onEvent = callback;
            return () => {};
          },
          async prompt(prompt) {
            promptSentToPi = prompt;
            onEvent({
              type: "message_update",
              assistantMessageEvent: {
                type: "text_end",
                content: "我在。今天我们轻一点开始。"
              }
            });
          },
          dispose() {}
        }
      };
    }
  });

  assert.match(promptSentToPi, /用户不喜欢一上来被连续追问/);
  assert.equal(result.text, "我在。今天我们轻一点开始。");
  assert.equal(result.recalledMemories.length, 1);
  assert.equal(captureCount, 0);
});

test("runCockapooPiPrompt uses chat history memory when no backend is provided", async () => {
  let promptSentToPi = "";
  const result = await runCockapooPiPrompt({
    cwd: "/tmp/cockapoo-workspace",
    modelSettings: {
      baseUrl: "https://api.openai.com/v1",
      modelName: "gpt-5.2"
    },
    runtimeToken: "sk-test",
    prompt: "用户：怎么回答更适合我？",
    chatHistoryMemory: {
      userId: "local-user",
      characterId: "shili",
      sessionId: "session-1",
      query: "回答更适合我",
      mode: "companion",
      messages: [
        {
          id: "m1",
          speaker: "user",
          text: "我喜欢你先给结论，再补充细节。",
          createdAt: "2026-05-19T10:00:00.000+08:00"
        }
      ]
    },
    createSession: async () => {
      let onEvent = () => {};

      return {
        session: {
          subscribe(callback) {
            onEvent = callback;
            return () => {};
          },
          async prompt(prompt) {
            promptSentToPi = prompt;
            onEvent({
              type: "message_update",
              assistantMessageEvent: {
                type: "text_end",
                content: "先给结论。"
              }
            });
          },
          dispose() {}
        }
      };
    }
  });

  assert.match(promptSentToPi, /<memory-context>/);
  assert.match(promptSentToPi, /先给结论/);
  assert.equal(result.recalledMemories.length, 1);
  assert.equal(result.memoryBackendSource, "chat-history");
});

test("runCockapooPiPrompt uses configured memory backend before chat history fallback", async () => {
  let promptSentToPi = "";
  const capturedTurns = [];
  const result = await runCockapooPiPrompt({
    cwd: "/tmp/cockapoo-workspace",
    modelSettings: {
      baseUrl: "https://api.openai.com/v1",
      modelName: "gpt-5.2"
    },
    runtimeToken: "sk-test",
    prompt: "用户：继续接真实记忆",
    memoryBackendConfig: {
      backend: "tencentdb"
    },
    resolveMemoryBackend: async ({ config }) => {
      assert.equal(config.backend, "tencentdb");

      return {
        async recallForPrompt() {
          return [
            {
              id: "memory-1",
              scope: "user",
              kind: "preference",
              text: "TencentDB 记忆里说用户喜欢先给结论。"
            }
          ];
        },
        async captureConversationTurn(turn) {
          capturedTurns.push(turn);
        }
      };
    },
    chatHistoryMemory: {
      userId: "local-user",
      characterId: "shili",
      sessionId: "session-1",
      query: "真实记忆",
      mode: "companion",
      messages: [
        {
          id: "m1",
          speaker: "user",
          text: "聊天历史里的旧偏好不该优先出现。",
          createdAt: "2026-05-19T10:00:00.000+08:00"
        }
      ]
    },
    createSession: async () => {
      let onEvent = () => {};

      return {
        session: {
          subscribe(callback) {
            onEvent = callback;
            return () => {};
          },
          async prompt(prompt) {
            promptSentToPi = prompt;
            onEvent({
              type: "message_update",
              assistantMessageEvent: {
                type: "text_end",
                content: "已经走配置记忆后端。"
              }
            });
          },
          dispose() {}
        }
      };
    }
  });

  assert.match(promptSentToPi, /TencentDB 记忆里说用户喜欢先给结论/);
  assert.doesNotMatch(promptSentToPi, /聊天历史里的旧偏好/);
  assert.equal(result.recalledMemories.length, 1);
  assert.equal(result.memoryBackendSource, "tencentdb");
  assert.equal(capturedTurns.length, 1);
  assert.equal(capturedTurns[0].assistantText, "已经走配置记忆后端。");
});

test("runCockapooPiPrompt applies tool policy settings to the Pi session", async () => {
  let sessionOptions;
  const result = await runCockapooPiPrompt({
    cwd: "/tmp/cockapoo-workspace",
    modelSettings: {
      baseUrl: "https://api.openai.com/v1",
      modelName: "gpt-5.2"
    },
    runtimeToken: "sk-test",
    prompt: "用户：可以读取记忆，但不要写文件",
    toolPolicySettings: {
      builtinTools: {
        read: true,
        grep: true,
        find: false,
        ls: true,
        bash: false,
        edit: false,
        write: false
      },
      customTools: {
        "memory.read": true,
        "memory.write": true,
        "web.fetch": true,
        "web.search": true,
        "browser.view": true,
        "browser.action": true
      },
      confirmTools: {
        bash: true,
        edit: true,
        write: true,
        "memory.write": true
      },
      protectedPaths: [".env"]
    },
    memoryBackend: {
      async recallForPrompt() {
        return [
          {
            id: "memory-1",
            scope: "user",
            kind: "preference",
            text: "用户喜欢先给结论。"
          }
        ];
      },
      async captureConversationTurn() {}
    },
    memoryRecallRequest: {
      userId: "local-user",
      characterId: "shili",
      query: "读取记忆",
      mode: "companion"
    },
    createSession: async (options) => {
      sessionOptions = options;
      let onEvent = () => {};

      return {
        session: {
          subscribe(callback) {
            onEvent = callback;
            return () => {};
          },
          async prompt() {
            onEvent({
              type: "message_update",
              assistantMessageEvent: {
                type: "text_end",
                content: "我会只读。"
              }
            });
          },
          dispose() {}
        }
      };
    }
  });

  assert.deepEqual(sessionOptions.tools, ["read", "grep", "ls", "memory_read", "memory_write"]);
  assert.deepEqual(sessionOptions.toolPolicy.builtinTools, ["read", "grep", "ls"]);
  assert.deepEqual(sessionOptions.toolPolicy.customTools, ["memory.read", "memory.write"]);
  assert.equal(sessionOptions.customTools.length, 2);
  assert.equal(sessionOptions.customTools[0].name, "memory_read");
  assert.equal(sessionOptions.customTools[1].name, "memory_write");
  assert.deepEqual(result.toolPolicy.enabledTools, ["read", "grep", "ls", "memory.read", "memory.write"]);
  assert.deepEqual(result.toolPolicy.registeredCustomTools, ["memory.read", "memory.write"]);
});

test("collectAssistantText uses text_end content when deltas are missing", () => {
  const text = collectAssistantText([
    {
      type: "message_update",
      assistantMessageEvent: {
        type: "text_end",
        content: "你好，我是示璃。"
      }
    }
  ]);

  assert.equal(text, "你好，我是示璃。");
});

test("collectAssistantText throws a clear error when the model returns no text", () => {
  assert.throws(
    () =>
      collectAssistantText([
        {
          type: "message_update",
          assistantMessageEvent: {
            type: "thinking_delta",
            delta: "..."
          }
        }
      ]),
    /模型没有返回文本/
  );
});

test("collectAssistantText surfaces assistant error messages", () => {
  assert.throws(
    () =>
      collectAssistantText([
        {
          type: "message_end",
          message: {
            role: "assistant",
            stopReason: "error",
            errorMessage: "Cannot read properties of undefined (reading 'includes')"
          }
        }
      ]),
    /Cannot read properties/
  );
});
