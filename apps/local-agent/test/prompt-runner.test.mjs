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
