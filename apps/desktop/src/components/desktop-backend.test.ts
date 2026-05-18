import assert from "node:assert/strict";
import { test } from "node:test";

import { createPreviewBackend } from "./desktop-backend.ts";

test("preview backend saves OpenAI-compatible endpoint settings", async () => {
  const backend = createPreviewBackend();

  await backend.saveModelSettings({
    baseUrl: "http://localhost:11434/v1",
    modelName: "qwen3-coder",
    token: "sk-preview-123456"
  });
  const settings = await backend.loadModelSettings();

  assert.equal(settings.baseUrl, "http://localhost:11434/v1");
  assert.equal(settings.modelName, "qwen3-coder");
  assert.equal(settings.hasToken, true);
  assert.equal(settings.tokenHint, "••••3456");
});

test("preview backend refuses to fake an LLM response after settings are saved", async () => {
  const backend = createPreviewBackend();
  await backend.saveModelSettings({
    baseUrl: "http://localhost:11434/v1",
    modelName: "qwen3-coder",
    token: "sk-preview-123456"
  });

  await assert.rejects(
    () =>
      backend.sendPiPrompt({
        characterId: "shili",
        mode: "companion",
        prompt: "今晚先做什么？",
        sessionPrompt: "角色卡：示璃\n用户：今晚先做什么？"
      }),
    /浏览器预览不会调用真实 LLM/
  );
});

test("preview backend refuses to fake a model test after settings are saved", async () => {
  const backend = createPreviewBackend();
  await backend.saveModelSettings({
    baseUrl: "http://localhost:11434/v1",
    modelName: "qwen3-coder",
    token: "sk-preview-123456"
  });

  await assert.rejects(
    () => backend.testModelConnection(),
    /浏览器预览不会调用真实 LLM/
  );
});

test("preview backend refuses to send before a token is saved", async () => {
  const backend = createPreviewBackend();

  await assert.rejects(
    () =>
      backend.sendPiPrompt({
        characterId: "shili",
        mode: "companion",
        prompt: "你好"
      }),
    /请先在模型供应商里保存 Token/
  );
});
