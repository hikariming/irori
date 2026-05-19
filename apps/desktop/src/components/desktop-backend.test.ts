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

test("preview backend accepts session id on Pi prompt requests", async () => {
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
        prompt: "继续做记忆",
        sessionId: "session-1"
      }),
    /浏览器预览不会调用真实 LLM/
  );
});

test("preview backend exposes memory status", async () => {
  const backend = createPreviewBackend();
  const status = await backend.getMemoryStatus();

  assert.equal(status.configuredBackend, "tencentdb");
  assert.equal(status.fallbackBackend, "chat-history");
  assert.match(status.memoryDir, /memory-tdai/);
  assert.equal(status.tencentDbPackageAvailable, true);
});

test("preview backend stores chat sessions and messages in memory", async () => {
  const backend = createPreviewBackend();
  const session = await backend.createChatSession({
    characterId: "shili",
    title: "本地历史"
  });

  await backend.appendChatMessage({
    sessionId: session.id,
    speaker: "user",
    author: "你",
    text: "先把聊天历史存起来",
    mode: "agent"
  });
  await backend.appendChatMessage({
    sessionId: session.id,
    speaker: "character",
    author: "示璃",
    text: "好，我先处理 SQLite。",
    stickerId: "focused",
    modelRoute: "https://api.openai.com/v1/gpt-5.2",
    providerId: "openai-compatible"
  });

  const sessions = await backend.listChatSessions();
  const detail = await backend.getChatSession(session.id);

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, session.id);
  assert.equal(sessions[0].lastMessagePreview, "好，我先处理 SQLite。");
  assert.equal(detail.messages.length, 2);
  assert.equal(detail.messages[0].speaker, "user");
  assert.equal(detail.messages[0].mode, "agent");
  assert.equal(detail.messages[1].speaker, "character");
  assert.equal(detail.messages[1].sticker?.id, "focused");
});
