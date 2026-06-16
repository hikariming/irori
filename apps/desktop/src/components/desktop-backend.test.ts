import assert from "node:assert/strict";
import { test } from "node:test";

import { createPreviewBackend } from "./desktop-backend.ts";

test("preview backend saves a model profile and returns registry state", async () => {
  const backend = createPreviewBackend();

  const settings = await backend.saveModelSettings({
    profileId: "default",
    name: "Local Qwen",
    baseUrl: "http://localhost:11434/v1",
    modelName: "qwen3-coder",
    token: "sk-preview-123456",
    makeActive: true
  });
  const profile = settings.profiles.find((item) => item.id === "default");

  assert.equal(settings.activeModelId, "default");
  assert.equal(profile?.name, "Local Qwen");
  assert.equal(profile?.baseUrl, "http://localhost:11434/v1");
  assert.equal(profile?.modelName, "qwen3-coder");
  assert.equal(profile?.hasToken, true);
  assert.equal(profile?.tokenHint, "••••3456");
});

test("preview backend round-trips advanced settings and defaults subagents off", async () => {
  const backend = createPreviewBackend();

  assert.equal((await backend.loadAdvancedSettings()).enableSubagents, false);

  const saved = await backend.saveAdvancedSettings({ enableSubagents: true });
  assert.equal(saved.enableSubagents, true);
  assert.equal((await backend.loadAdvancedSettings()).enableSubagents, true);
});

test("preview backend clears all debug memory data", async () => {
  const backend = createPreviewBackend();
  const session = await backend.createChatSession({ characterId: "shili", title: "debug" });
  await backend.appendChatMessage({
    sessionId: session.id,
    speaker: "user",
    author: "你",
    text: "remember this"
  });
  await backend.saveCharacterStates({
    shili: {
      affinity: 80,
      trust: 75,
      mood: "focused",
      energy: 42,
      lastInteractionAt: 123,
      introducedAt: 123,
      impressions: [{ id: "m1", text: "用户喜欢调试", weight: 1, createdAt: 123, updatedAt: 123 }]
    }
  });
  await backend.addCharacterMoment({ characterId: "shili", text: "调试动态" });
  await backend.addCharacterLetter({
    characterId: "shili",
    subject: "调试信",
    body: "调试内容",
    deliverAt: new Date().toISOString()
  });
  await backend.createScheduledTask({
    characterId: "shili",
    title: "调试任务",
    prompt: "run",
    scheduleKind: "daily",
    scheduleSpec: "20:00",
    enabled: true
  });

  await backend.clearMemoryData();

  assert.deepEqual(await backend.loadCharacterStates(), {});
  assert.deepEqual(await backend.listChatSessions(), []);
  assert.deepEqual(await backend.listCharacterMoments(), []);
  assert.deepEqual(await backend.listCharacterLetters(), []);
  assert.deepEqual(await backend.listScheduledTasks(), []);
});

test("preview backend clears all debug configuration data", async () => {
  const backend = createPreviewBackend();
  await backend.saveModelSettings({
    profileId: "local",
    name: "Local",
    baseUrl: "http://localhost:11434/v1",
    modelName: "qwen3-coder",
    token: "sk-local-abcdef",
    makeActive: true
  });
  await backend.saveWebAccessSettings({
    provider: "perplexity",
    workflow: "summary-review",
    noKeyFallback: false,
    allowBrowserCookies: true,
    perplexityApiKey: "pplx-secret-abcdef"
  });
  await backend.saveToolPolicySettings({
    builtinTools: { read: true, grep: false, find: false, ls: true, bash: false, edit: false, write: false },
    customTools: { "memory.read": false, "memory.write": false, "web.fetch": false, "web.search": false, "browser.view": false, "browser.action": false },
    confirmTools: { bash: false, edit: false, write: false, "memory.write": false, "browser.action": false },
    protectedPaths: ["secret"]
  });
  await backend.saveAdvancedSettings({ enableSubagents: true });
  await backend.saveReviewMode("all");
  await backend.saveMissedTaskPolicy("skip");
  await backend.createSkill({
    name: "debug-skill",
    description: "debug",
    body: "# debug",
    disableModelInvocation: false,
    allowedTools: ["memory.read"]
  });

  await backend.clearConfigurationData();

  const model = await backend.loadModelSettings();
  assert.equal(model.activeModelId, "default");
  assert.equal(model.profiles.length, 1);
  assert.equal(model.profiles[0].hasToken, false);
  assert.equal((await backend.getWebAccessSettings()).provider, "auto");
  assert.equal((await backend.getWebAccessSettings()).perplexityHasKey, false);
  assert.equal((await backend.getToolPolicySettings()).builtinTools.bash, true);
  assert.equal((await backend.loadAdvancedSettings()).enableSubagents, false);
  assert.equal(await backend.loadReviewMode(), "default");
  assert.equal(await backend.loadMissedTaskPolicy(), "catchup");
  assert.deepEqual(await backend.listSkills(), []);
});

test("preview backend saves web access settings without returning raw keys", async () => {
  const backend = createPreviewBackend();

  const initial = await backend.getWebAccessSettings();
  assert.equal(initial.provider, "auto");
  assert.equal(initial.workflow, "none");
  assert.equal(initial.noKeyFallback, true);
  assert.equal(initial.perplexityHasKey, false);

  const saved = await backend.saveWebAccessSettings({
    provider: "perplexity",
    workflow: "summary-review",
    noKeyFallback: true,
    allowBrowserCookies: true,
    perplexityApiKey: "pplx-secret-abcdef"
  });

  assert.equal(saved.provider, "perplexity");
  assert.equal(saved.workflow, "summary-review");
  assert.equal(saved.allowBrowserCookies, true);
  assert.equal(saved.perplexityHasKey, true);
  assert.equal(saved.perplexityKeyHint, "••••cdef");
  assert.equal("perplexityApiKey" in saved, false);

  const preserved = await backend.saveWebAccessSettings({
    provider: "auto",
    workflow: "none",
    noKeyFallback: true,
    allowBrowserCookies: false,
    perplexityApiKey: ""
  });

  assert.equal(preserved.provider, "auto");
  assert.equal(preserved.perplexityHasKey, true);
  assert.equal(preserved.perplexityKeyHint, "••••cdef");
});

test("preview backend saves a second model profile and switches active profile", async () => {
  const backend = createPreviewBackend();

  await backend.saveModelSettings({
    profileId: "default",
    name: "Cloud",
    baseUrl: "https://api.openai.com/v1",
    modelName: "gpt-5.5",
    token: "sk-cloud-123456",
    makeActive: true
  });
  await backend.saveModelSettings({
    profileId: "local",
    name: "Local",
    baseUrl: "http://localhost:11434/v1",
    modelName: "qwen3-coder",
    token: "sk-local-abcdef",
    makeActive: false
  });

  const settings = await backend.setActiveModelProfile("local");

  assert.equal(settings.activeModelId, "local");
  assert.deepEqual(
    settings.profiles.map((profile) => profile.id),
    ["default", "local"]
  );
});

test("preview backend preserves a saved profile token when saving without a token", async () => {
  const backend = createPreviewBackend();

  await backend.saveModelSettings({
    profileId: "local",
    name: "Local",
    baseUrl: "http://localhost:11434/v1",
    modelName: "qwen3-coder",
    token: "sk-local-abcdef",
    makeActive: true
  });

  const settings = await backend.saveModelSettings({
    profileId: "local",
    name: "Renamed Local",
    baseUrl: "http://localhost:11434/v1/qwen3-coder",
    modelName: "qwen3-coder",
    token: "",
    makeActive: true
  });
  const profile = settings.profiles.find((item) => item.id === "local");

  assert.equal(profile?.name, "Renamed Local");
  assert.equal(profile?.baseUrl, "http://localhost:11434/v1");
  assert.equal(profile?.hasToken, true);
  assert.equal(profile?.tokenHint, "••••cdef");
});

test("preview backend deletes the active model profile and selects a remaining profile", async () => {
  const backend = createPreviewBackend();

  await backend.saveModelSettings({
    profileId: "default",
    name: "Cloud",
    baseUrl: "https://api.openai.com/v1",
    modelName: "gpt-5.5",
    token: "sk-cloud-123456",
    makeActive: false
  });
  await backend.saveModelSettings({
    profileId: "local",
    name: "Local",
    baseUrl: "http://localhost:11434/v1",
    modelName: "qwen3-coder",
    token: "sk-local-abcdef",
    makeActive: true
  });

  const settings = await backend.deleteModelProfile("local");

  assert.equal(settings.activeModelId, "default");
  assert.equal(settings.profiles.some((profile) => profile.id === "local"), false);
});

test("preview backend refuses to fake an LLM response after settings are saved", async () => {
  const backend = createPreviewBackend();
  await backend.saveModelSettings({
    profileId: "default",
    name: "Local Qwen",
    baseUrl: "http://localhost:11434/v1",
    modelName: "qwen3-coder",
    token: "sk-preview-123456"
  });

  await assert.rejects(
    () =>
      backend.sendPiPrompt({
        characterId: "shili",
        prompt: "今晚先做什么？",
        sessionPrompt: "角色卡：示璃\n用户：今晚先做什么？"
      }),
    /浏览器预览不会调用真实 LLM/
  );
});

test("preview backend refuses to fake a model test after settings are saved", async () => {
  const backend = createPreviewBackend();
  await backend.saveModelSettings({
    profileId: "default",
    name: "Local Qwen",
    baseUrl: "http://localhost:11434/v1",
    modelName: "qwen3-coder",
    token: "sk-preview-123456"
  });

  await assert.rejects(
    () => backend.testModelConnection(),
    /浏览器预览不会调用真实 LLM/
  );
});

test("preview backend exposes a no-op Pi prompt progress listener", async () => {
  const backend = createPreviewBackend();
  let called = false;

  const unlisten = await backend.onPiPromptProgress(() => {
    called = true;
  });

  unlisten();
  assert.equal(called, false);
});

test("preview backend accepts draft model test tokens before saving", async () => {
  const backend = createPreviewBackend();

  await assert.rejects(
    () =>
      backend.testModelConnection({
        profileId: "draft-local",
        name: "Draft Local",
        baseUrl: "http://localhost:11434/v1",
        modelName: "qwen3-coder",
        token: "sk-draft-123456"
      }),
    /浏览器预览不会调用真实 LLM/
  );
});

test("preview backend refuses to send before a token is saved", async () => {
  const backend = createPreviewBackend();

  await assert.rejects(
    () =>
      backend.sendPiPrompt({
        characterId: "shili",
        prompt: "你好"
      }),
    /请先完成模型接入/
  );
});

test("preview backend accepts session id on Pi prompt requests", async () => {
  const backend = createPreviewBackend();
  await backend.saveModelSettings({
    profileId: "default",
    name: "Local Qwen",
    baseUrl: "http://localhost:11434/v1",
    modelName: "qwen3-coder",
    token: "sk-preview-123456"
  });

  await assert.rejects(
    () =>
      backend.sendPiPrompt({
        characterId: "shili",
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

test("preview backend updates moment likes and comments", async () => {
  const backend = createPreviewBackend();
  const moment = await backend.addCharacterMoment({
    characterId: "lulin",
    text: "午后想喝杯咖啡"
  });

  const liked = await backend.toggleCharacterMomentLike({
    momentId: moment.id,
    actorType: "user",
    actorId: "self",
    liked: true
  });
  assert.equal(liked.likes.length, 1);
  assert.equal(liked.likes[0].actorId, "self");

  const commented = await backend.addCharacterMomentComment({
    momentId: moment.id,
    actorType: "character",
    actorId: "shili",
    text: "我也想喝。"
  });
  assert.equal(commented.comments.length, 1);
  assert.equal(commented.comments[0].text, "我也想喝。");

  const listed = await backend.listCharacterMoments();
  assert.equal(listed[0].likes.length, 1);
  assert.equal(listed[0].comments.length, 1);
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
    text: "先把聊天历史存起来"
  });
  await backend.appendChatMessage({
    sessionId: session.id,
    speaker: "character",
    author: "示璃",
    text: "好，我先处理 SQLite。",
    stickerId: "focused",
    modelRoute: "https://api.openai.com/v1/gpt-5.5",
    providerId: "openai-compatible"
  });

  const sessions = await backend.listChatSessions();
  const detail = await backend.getChatSession(session.id);

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, session.id);
  assert.equal(sessions[0].lastMessagePreview, "好，我先处理 SQLite。");
  assert.equal(detail.messages.length, 2);
  assert.equal(detail.messages[0].speaker, "user");
  assert.equal("mode" in detail.messages[0], false);
  assert.equal(detail.messages[1].speaker, "character");
  assert.equal(detail.messages[1].sticker?.id, "focused");
});
