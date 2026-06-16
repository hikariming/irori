import assert from "node:assert/strict";
import { test } from "node:test";

import {
  collectAssistantText,
  createPromptIdleWatchdog,
  perRunToolGateConfigPath,
  runIroriPiPrompt,
  toPiPromptProgressEvent
} from "../src/prompt-runner.mjs";

test("runIroriPiPrompt dry run returns the selected route without calling a model", async () => {
  const result = await runIroriPiPrompt({
    cwd: "/tmp/irori-workspace",
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

test("toPiPromptProgressEvent maps assistant thinking and answer deltas", () => {
  assert.deepEqual(
    toPiPromptProgressEvent(
      {
        type: "message_update",
        assistantMessageEvent: {
          type: "thinking_delta",
          delta: "先检查上下文。"
        }
      },
      "run-1"
    ),
    {
      runId: "run-1",
      phase: "thinking",
      delta: "先检查上下文。"
    }
  );

  assert.deepEqual(
    toPiPromptProgressEvent(
      {
        type: "message_update",
        assistantMessageEvent: {
          type: "text_delta",
          delta: "我在。"
        }
      },
      "run-1"
    ),
    {
      runId: "run-1",
      phase: "answering",
      delta: "我在。"
    }
  );
});

test("toPiPromptProgressEvent maps assistant thinking boundaries", () => {
  assert.deepEqual(
    toPiPromptProgressEvent(
      {
        type: "message_update",
        assistantMessageEvent: {
          type: "thinking_start"
        }
      },
      "run-1"
    ),
    {
      runId: "run-1",
      phase: "thinking"
    }
  );

  assert.deepEqual(
    toPiPromptProgressEvent(
      {
        type: "message_update",
        assistantMessageEvent: {
          type: "thinking_end",
          content: "完整推理内容"
        }
      },
      "run-1"
    ),
    {
      runId: "run-1",
      phase: "thinking",
      text: "完整推理内容"
    }
  );
});

test("runIroriPiPrompt forwards streaming progress events", async () => {
  const progressEvents = [];

  const result = await runIroriPiPrompt({
    cwd: "/tmp/irori-workspace",
    modelSettings: {
      baseUrl: "https://api.openai.com/v1",
      modelName: "gpt-5.5"
    },
    runtimeToken: "sk-test",
    prompt: "你好",
    runId: "run-progress",
    onProgressEvent(event) {
      progressEvents.push(event);
    },
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
                type: "thinking_delta",
                delta: "先想一下。"
              }
            });
            onEvent({
              type: "message_update",
              assistantMessageEvent: {
                type: "text_delta",
                delta: "你好"
              }
            });
            onEvent({
              type: "message_update",
              assistantMessageEvent: {
                type: "text_end",
                content: "你好。"
              }
            });
          },
          dispose() {}
        }
      };
    }
  });

  assert.equal(result.text, "你好。");
  assert.deepEqual(progressEvents.filter((event) => event.delta || event.text !== undefined), [
    {
      runId: "run-progress",
      phase: "thinking",
      delta: "先想一下。"
    },
    {
      runId: "run-progress",
      phase: "answering",
      delta: "你好"
    },
    {
      runId: "run-progress",
      phase: "answering",
      text: "你好。"
    }
  ]);
});

test("runIroriPiPrompt emits status heartbeats while waiting for first model output", { timeout: 500 }, async () => {
  const progressEvents = [];

  const result = await runIroriPiPrompt({
    cwd: "/tmp/irori-workspace",
    modelSettings: {
      baseUrl: "https://api.openai.com/v1",
      modelName: "gpt-5.5"
    },
    runtimeToken: "sk-test",
    prompt: "你好",
    runId: "run-heartbeat",
    modelWaitHeartbeatMs: 5,
    onProgressEvent(event) {
      progressEvents.push(event);
    },
    createSession: async () => {
      let onEvent = () => {};

      return {
        session: {
          subscribe(callback) {
            onEvent = callback;
            return () => {};
          },
          async prompt() {
            await new Promise((resolve) => setTimeout(resolve, 20));
            onEvent({
              type: "message_update",
              assistantMessageEvent: {
                type: "text_delta",
                delta: "你好"
              }
            });
            onEvent({
              type: "message_update",
              assistantMessageEvent: {
                type: "text_end",
                content: "你好。"
              }
            });
          },
          dispose() {}
        }
      };
    }
  });

  assert.equal(result.text, "你好。");
  assert.ok(progressEvents.some((event) => event.statusCode === "preparingContext"));
  assert.ok(
    progressEvents.some(
      (event) => event.statusCode === "awaitingOutput" && typeof event.statusParams?.seconds === "number"
    )
  );
});

test("runIroriPiPrompt requires a token outside dry run", async () => {
  await assert.rejects(
    () =>
      runIroriPiPrompt({
        cwd: "/tmp/irori-workspace",
        modelSettings: {
          baseUrl: "https://api.openai.com/v1",
          modelName: "gpt-5.5"
        },
        prompt: "你好，示璃"
      }),
    /token/
  );
});

test("runIroriPiPrompt reports the real OpenAI-compatible request route", async () => {
  const result = await runIroriPiPrompt({
    cwd: "/tmp/irori-workspace",
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

test("runIroriPiPrompt forwards the skills root and allowed skill names to the session", async () => {
  let captured = null;

  await runIroriPiPrompt({
    cwd: "/tmp/irori-workspace",
    modelSettings: { baseUrl: "https://api.example.com/v1", modelName: "demo" },
    runtimeToken: "sk-test",
    prompt: "你好",
    skillsRootPath: "/tmp/skills",
    allowedSkillNames: ["tarot-reading", "weather-lookup"],
    createSession: async (options) => {
      captured = options;
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
              assistantMessageEvent: { type: "text_end", content: "OK" }
            });
          },
          dispose() {}
        }
      };
    }
  });

  assert.equal(captured.skillsRootPath, "/tmp/skills");
  assert.deepEqual(captured.allowedSkillNames, ["tarot-reading", "weather-lookup"]);
});

test("runIroriPiPrompt injects recalled memory and captures successful turns", async () => {
  let promptSentToPi = "";
  const capturedTurns = [];
  const result = await runIroriPiPrompt({
    cwd: "/tmp/irori-workspace",
    modelSettings: {
      baseUrl: "https://api.openai.com/v1",
      modelName: "gpt-5.5"
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

test("runIroriPiPrompt can recall memory for opening messages without capturing a turn", async () => {
  let promptSentToPi = "";
  let captureCount = 0;
  const result = await runIroriPiPrompt({
    cwd: "/tmp/irori-workspace",
    modelSettings: {
      baseUrl: "https://api.openai.com/v1",
      modelName: "gpt-5.5"
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

test("runIroriPiPrompt uses chat history memory when no backend is provided", async () => {
  let promptSentToPi = "";
  const result = await runIroriPiPrompt({
    cwd: "/tmp/irori-workspace",
    modelSettings: {
      baseUrl: "https://api.openai.com/v1",
      modelName: "gpt-5.5"
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

test("runIroriPiPrompt uses configured memory backend before chat history fallback", async () => {
  let promptSentToPi = "";
  const capturedTurns = [];
  const result = await runIroriPiPrompt({
    cwd: "/tmp/irori-workspace",
    modelSettings: {
      baseUrl: "https://api.openai.com/v1",
      modelName: "gpt-5.5"
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

test("runIroriPiPrompt applies tool policy settings to the Pi session", async () => {
  let sessionOptions;
  const result = await runIroriPiPrompt({
    cwd: "/tmp/irori-workspace",
    modelSettings: {
      baseUrl: "https://api.openai.com/v1",
      modelName: "gpt-5.5"
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

  assert.deepEqual(sessionOptions.tools, [
    "read",
    "grep",
    "ls",
    "memory_read",
    "memory_write",
    "fetch_content",
    "get_search_content",
    "web_search",
    "browser_view"
  ]);
  assert.deepEqual(sessionOptions.toolPolicy.builtinTools, ["read", "grep", "ls"]);
  assert.deepEqual(sessionOptions.toolPolicy.customTools, ["memory.read", "memory.write", "web.fetch", "web.search", "browser.view"]);
  assert.equal(sessionOptions.customTools.length, 3);
  assert.equal(sessionOptions.customTools[0].name, "memory_read");
  assert.equal(sessionOptions.customTools[1].name, "memory_write");
  assert.equal(sessionOptions.customTools[2].name, "browser_view");
  assert.deepEqual(result.toolPolicy.enabledTools, ["read", "grep", "ls", "memory.read", "memory.write", "web.fetch", "web.search", "browser.view"]);
  assert.deepEqual(result.toolPolicy.registeredCustomTools, ["memory.read", "memory.write", "web.fetch", "web.search", "browser.view"]);
});

test("runIroriPiPrompt forwards browser view tool events as prompt progress", async () => {
  const progressEvents = [];

  await runIroriPiPrompt({
    cwd: "/tmp/irori-workspace",
    modelSettings: {
      baseUrl: "https://api.openai.com/v1",
      modelName: "gpt-5.5"
    },
    runtimeToken: "sk-test",
    prompt: "用户：打开来源",
    runId: "run-browser",
    toolPolicySettings: {
      builtinTools: {},
      customTools: {
        "browser.view": true
      },
      confirmTools: {},
      protectedPaths: []
    },
    browserSnapshot: {
      currentUrl: "https://example.com/current",
      title: "Current page"
    },
    onProgressEvent(event) {
      progressEvents.push(event);
    },
    createSession: async (options) => {
      const browserView = options.customTools.find((tool) => tool.name === "browser_view");
      let onEvent = () => {};
      return {
        session: {
          subscribe(callback) {
            onEvent = callback;
            return () => {};
          },
          async prompt() {
            await browserView.execute("tool-call-1", {
              url: "https://example.com/source",
              title: "Source"
            });
            onEvent({
              type: "message_update",
              assistantMessageEvent: {
                type: "text_end",
                content: "已打开来源。"
              }
            });
          },
          dispose() {}
        }
      };
    }
  });

  assert.deepEqual(progressEvents.find((event) => event.phase === "browser"), {
    runId: "run-browser",
    phase: "browser",
    status: "打开右侧浏览器：https://example.com/source",
    browser: {
      action: "open",
      url: "https://example.com/source",
      title: "Source",
      source: "agent"
    }
  });
});

test("runIroriPiPrompt writes web access settings before creating the Pi session", async () => {
  const calls = [];

  await runIroriPiPrompt({
    cwd: "/tmp/irori-workspace",
    modelSettings: {
      baseUrl: "https://api.openai.com/v1",
      modelName: "gpt-5.5"
    },
    runtimeToken: "sk-test",
    prompt: "用户：搜一下今天的新闻",
    webAccessSettings: {
      provider: "perplexity",
      workflow: "none",
      noKeyFallback: true,
      perplexityApiKey: "pplx-secret"
    },
    writeWebAccessConfig: async ({ settings }) => {
      calls.push({ type: "web", settings });
    },
    createSession: async () => {
      calls.push({ type: "session" });
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
                content: "我会联网查询。"
              }
            });
          },
          dispose() {}
        }
      };
    }
  });

  assert.deepEqual(calls.map((call) => call.type), ["web", "session"]);
  assert.equal(calls[0].settings.provider, "perplexity");
  assert.equal(calls[0].settings.workflow, "none");
});

test("runIroriPiPrompt persists a per-run gate config, points the env at it, and removes it after the run", async () => {
  const calls = [];
  const removed = [];
  const previousEnv = process.env.IRORI_TOOL_GATE_CONFIG;
  delete process.env.IRORI_TOOL_GATE_CONFIG;

  try {
    await runIroriPiPrompt({
      cwd: "/tmp/irori-workspace",
      modelSettings: {
        baseUrl: "https://api.openai.com/v1",
        modelName: "gpt-5.5"
      },
      runtimeToken: "sk-test",
      prompt: "用户：派个子代理改代码",
      toolGateMode: "managed",
      toolGateConfigPath: "/tmp/irori-workspace/.pi/irori-tool-gate.json",
      writeToolGateConfig: async (config) => {
        calls.push({ type: "gate", config });
      },
      removeToolGateConfig: async (path) => {
        removed.push(path);
      },
      createSession: async () => {
        calls.push({ type: "session" });
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
                  content: "好。"
                }
              });
            },
            dispose() {}
          }
        };
      }
    });

    assert.deepEqual(calls.map((call) => call.type), ["gate", "session"]);
    assert.equal(calls[0].config.mode, "managed");
    // 并发 run 互不覆盖：写入的是按 run 派生的独立文件，不是共享的基础路径。
    const writtenPath = calls[0].config.configPath;
    assert.match(writtenPath, /^\/tmp\/irori-workspace\/\.pi\/irori-tool-gate\..+\.json$/);
    assert.notEqual(writtenPath, "/tmp/irori-workspace/.pi/irori-tool-gate.json");
    assert.ok(Array.isArray(calls[0].config.gatePolicy.allowedToolNames));
    // 子进程经 env 指针找到的就是本 run 的文件。
    assert.equal(process.env.IRORI_TOOL_GATE_CONFIG, writtenPath);
    // run 结束后临时围栏文件被清理。
    assert.deepEqual(removed, [writtenPath]);
  } finally {
    if (previousEnv === undefined) {
      delete process.env.IRORI_TOOL_GATE_CONFIG;
    } else {
      process.env.IRORI_TOOL_GATE_CONFIG = previousEnv;
    }
  }
});

test("perRunToolGateConfigPath derives unique sibling paths from the base path", () => {
  const first = perRunToolGateConfigPath("/data/irori-tool-gate.json", { pid: 42, token: "aaa" });
  const second = perRunToolGateConfigPath("/data/irori-tool-gate.json", { pid: 42, token: "bbb" });

  assert.equal(first, "/data/irori-tool-gate.42-aaa.json");
  assert.equal(second, "/data/irori-tool-gate.42-bbb.json");
  assert.notEqual(perRunToolGateConfigPath("/data/irori-tool-gate.json"), perRunToolGateConfigPath("/data/irori-tool-gate.json"));
  // 不以 .json 结尾的基础路径也能加后缀。
  assert.equal(perRunToolGateConfigPath("/data/gate", { pid: 1, token: "x" }), "/data/gate.1-x.json");
});

test("runIroriPiPrompt does not persist a gate config when no path is given", async () => {
  let gateWrites = 0;

  await runIroriPiPrompt({
    cwd: "/tmp/irori-workspace",
    modelSettings: {
      baseUrl: "https://api.openai.com/v1",
      modelName: "gpt-5.5"
    },
    runtimeToken: "sk-test",
    prompt: "用户：普通对话",
    writeToolGateConfig: async () => {
      gateWrites += 1;
    },
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
                content: "在的。"
              }
            });
          },
          dispose() {}
        }
      };
    }
  });

  assert.equal(gateWrites, 0);
});

test("runIroriPiPrompt times out idle model prompts and disposes the session", { timeout: 500 }, async () => {
  let disposed = false;
  let unsubscribed = false;

  await assert.rejects(
    () =>
      runIroriPiPrompt({
        cwd: "/tmp/irori-workspace",
        modelSettings: {
          baseUrl: "https://api.openai.com/v1",
          modelName: "gpt-5.5"
        },
        runtimeToken: "sk-test",
        prompt: "用户：这次模型一直不返回",
        promptTimeoutMs: 10,
        createSession: async () => ({
          session: {
            subscribe() {
              return () => {
                unsubscribed = true;
              };
            },
            async prompt() {
              return new Promise(() => {});
            },
            dispose() {
              disposed = true;
            }
          }
        })
      }),
    /等待模型活动超时/
  );

  assert.equal(unsubscribed, true);
  assert.equal(disposed, true);
});

test("runIroriPiPrompt treats promptTimeoutMs as an idle window: steady events keep a long run alive", { timeout: 1000 }, async () => {
  // 总时长（约 120ms）远超空闲窗口（30ms），但事件间隔都小于窗口，不应超时。
  const result = await runIroriPiPrompt({
    cwd: "/tmp/irori-workspace",
    modelSettings: {
      baseUrl: "https://api.openai.com/v1",
      modelName: "gpt-5.5"
    },
    runtimeToken: "sk-test",
    prompt: "用户：慢慢说",
    promptTimeoutMs: 30,
    createSession: async () => {
      let onEvent = () => {};

      return {
        session: {
          subscribe(callback) {
            onEvent = callback;
            return () => {};
          },
          async prompt() {
            for (let i = 0; i < 12; i += 1) {
              await new Promise((resolve) => setTimeout(resolve, 10));
              onEvent({
                type: "message_update",
                assistantMessageEvent: { type: "text_delta", delta: "字" }
              });
            }
            onEvent({
              type: "message_update",
              assistantMessageEvent: { type: "text_end", content: "说完了。" }
            });
          },
          dispose() {}
        }
      };
    }
  });

  assert.equal(result.text, "说完了。");
});

test("runIroriPiPrompt pauses the idle clock while a tool is executing (e.g. subagent delegation)", { timeout: 1000 }, async () => {
  // 工具执行（tool_execution_start → end）耗时远超空闲窗口，期间没有任何模型
  // 事件，也不应超时——子代理委派正是这种形态。
  const result = await runIroriPiPrompt({
    cwd: "/tmp/irori-workspace",
    modelSettings: {
      baseUrl: "https://api.openai.com/v1",
      modelName: "gpt-5.5"
    },
    runtimeToken: "sk-test",
    prompt: "用户：派个子代理",
    promptTimeoutMs: 20,
    createSession: async () => {
      let onEvent = () => {};

      return {
        session: {
          subscribe(callback) {
            onEvent = callback;
            return () => {};
          },
          async prompt() {
            onEvent({ type: "tool_execution_start", toolCallId: "t1", toolName: "subagent", args: {} });
            await new Promise((resolve) => setTimeout(resolve, 100));
            onEvent({ type: "tool_execution_end", toolCallId: "t1", toolName: "subagent" });
            onEvent({
              type: "message_update",
              assistantMessageEvent: { type: "text_end", content: "子代理跑完了。" }
            });
          },
          dispose() {}
        }
      };
    }
  });

  assert.equal(result.text, "子代理跑完了。");
});

test("runIroriPiPrompt pauses the idle clock while a confirmation waits on the user", { timeout: 1000 }, async () => {
  // 用户在确认面板上停留远超空闲窗口也不应超时。
  let confirmSeen = null;
  const result = await runIroriPiPrompt({
    cwd: "/tmp/irori-workspace",
    modelSettings: {
      baseUrl: "https://api.openai.com/v1",
      modelName: "gpt-5.5"
    },
    runtimeToken: "sk-test",
    prompt: "用户：写个文件",
    promptTimeoutMs: 20,
    onConfirm: async (confirmRequest) => {
      confirmSeen = confirmRequest;
      await new Promise((resolve) => setTimeout(resolve, 100));
      return true;
    },
    createSession: async (options) => {
      let onEvent = () => {};

      return {
        session: {
          subscribe(callback) {
            onEvent = callback;
            return () => {};
          },
          async prompt() {
            // 模拟围栏在工具执行前回询用户（runner 包装后的 onConfirm 会暂停计时）。
            const approved = await options.onConfirm({ toolName: "write", input: {}, reason: "需要确认" });
            assert.equal(approved, true);
            onEvent({
              type: "message_update",
              assistantMessageEvent: { type: "text_end", content: "已确认并完成。" }
            });
          },
          dispose() {}
        }
      };
    }
  });

  assert.equal(result.text, "已确认并完成。");
  assert.equal(confirmSeen.toolName, "write");
});

test("createPromptIdleWatchdog is inert without a finite positive window", async () => {
  const watchdog = createPromptIdleWatchdog(0);
  const value = await watchdog.race(Promise.resolve("ok"));

  assert.equal(value, "ok");
  // touch/pause/resume 必须可安全调用。
  watchdog.touch();
  watchdog.pause();
  watchdog.resume();
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

test("collectAssistantText prefers final text_end content over streamed deltas", () => {
  const text = collectAssistantText([
    {
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: "你"
      }
    },
    {
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: "你呢？"
      }
    },
    {
      type: "message_update",
      assistantMessageEvent: {
        type: "text_end",
        content: "你呢？"
      }
    }
  ]);

  assert.equal(text, "你呢？");
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
