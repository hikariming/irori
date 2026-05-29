import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildDraftModelProfile,
  buildProfileFromPreset,
  buildInitialModelSettings,
  deleteModelProfile,
  detectPresetProvider,
  formatOpenAiCompatibleRequestPreview,
  formatOpenAiCompatibleRoute,
  getActiveModelProfile,
  isModelConfigured,
  mergeSavedModelSettings,
  normalizeOpenAiCompatibleSettings,
  presetProviders,
  redactToken,
  setActiveModelProfile,
  shouldMakeSavedProfileActive,
  upsertModelProfile
} from "./model-settings-controller.ts";

test("mergeSavedModelSettings migrates legacy settings into an active default profile", () => {
  const settings = mergeSavedModelSettings(buildInitialModelSettings(), {
    baseUrl: " http://localhost:11434/v1/ ",
    hasToken: true,
    modelName: "qwen3-coder",
    tokenHint: "saved"
  });

  assert.equal(settings.activeModelId, "default");
  assert.deepEqual(settings.profiles, [
    {
      id: "default",
      name: "qwen3-coder",
      baseUrl: "http://localhost:11434/v1",
      hasToken: true,
      modelName: "qwen3-coder",
      tokenHint: "saved"
    }
  ]);
  assert.deepEqual(Object.keys(settings).sort(), ["activeModelId", "profiles"]);
});

test("mergeSavedModelSettings tolerates partial registry profiles", () => {
  const settings = mergeSavedModelSettings(buildInitialModelSettings(), {
    activeModelId: "glm",
    profiles: [
      {
        id: "glm",
        modelName: "glm-5.1",
        hasToken: true
      }
    ]
  });

  assert.equal(settings.activeModelId, "glm");
  assert.deepEqual(settings.profiles, [
    {
      id: "glm",
      name: "glm-5.1",
      baseUrl: "https://api.openai.com/v1",
      hasToken: true,
      modelName: "glm-5.1",
      tokenHint: undefined
    }
  ]);
});

test("mergeSavedModelSettings preserves profiles when registry input only changes activeModelId", () => {
  const settings = upsertModelProfile(
    buildInitialModelSettings(),
    {
      id: "local",
      name: "Local",
      baseUrl: "http://localhost:11434/v1",
      hasToken: true,
      modelName: "qwen3-coder"
    },
    { makeActive: false }
  );

  const merged = mergeSavedModelSettings(settings, { activeModelId: "local" });

  assert.equal(merged.activeModelId, "local");
  assert.equal(merged.profiles.length, 2);
  assert.deepEqual(
    merged.profiles.map((profile) => profile.id),
    ["default", "local"]
  );
  assert.equal(getActiveModelProfile(merged).id, "local");
});

test("getActiveModelProfile falls back to the first profile if activeModelId is missing", () => {
  const settings = {
    activeModelId: "missing",
    profiles: [
      {
        id: "first",
        name: "First",
        baseUrl: "https://first.example/v1",
        hasToken: true,
        modelName: "first-model"
      },
      {
        id: "second",
        name: "Second",
        baseUrl: "https://second.example/v1",
        hasToken: true,
        modelName: "second-model"
      }
    ]
  };

  assert.equal(getActiveModelProfile(settings).id, "first");
});

test("isModelConfigured requires active profile endpoint, model name, and saved token", () => {
  const configured = mergeSavedModelSettings(buildInitialModelSettings(), {
    activeModelId: "local",
    profiles: [
      {
        id: "local",
        name: "Local",
        baseUrl: "http://localhost:11434/v1",
        hasToken: true,
        modelName: "qwen3-coder"
      }
    ]
  });

  assert.equal(isModelConfigured(buildInitialModelSettings()), false);
  assert.equal(isModelConfigured(configured), true);
  assert.equal(
    isModelConfigured({
      ...configured,
      profiles: [{ ...configured.profiles[0], modelName: "" }]
    }),
    false
  );
});

test("upsertModelProfile normalizes baseUrl, adds or updates a profile, and can make it active", () => {
  const initial = buildInitialModelSettings();
  const added = upsertModelProfile(
    initial,
    {
      id: "local",
      name: "Local",
      baseUrl: " http://localhost:11434/v1/qwen3-coder/ ",
      hasToken: true,
      modelName: "qwen3-coder",
      tokenHint: "saved"
    },
    { makeActive: true }
  );

  assert.equal(added.activeModelId, "local");
  assert.equal(added.profiles.find((profile) => profile.id === "local")?.baseUrl, "http://localhost:11434/v1");

  const updated = upsertModelProfile(added, {
    id: "local",
    name: "Updated Local",
    baseUrl: "http://localhost:11434/v1/chat/completions",
    hasToken: false,
    modelName: "qwen3-coder"
  });

  assert.equal(updated.activeModelId, "local");
  assert.equal(updated.profiles.length, added.profiles.length);
  assert.deepEqual(updated.profiles.find((profile) => profile.id === "local"), {
    id: "local",
    name: "Updated Local",
    baseUrl: "http://localhost:11434/v1",
    hasToken: false,
    modelName: "qwen3-coder",
    tokenHint: undefined
  });
});

test("setActiveModelProfile switches only to existing profile ids", () => {
  const settings = upsertModelProfile(
    buildInitialModelSettings(),
    {
      id: "local",
      name: "Local",
      baseUrl: "http://localhost:11434/v1",
      hasToken: true,
      modelName: "qwen3-coder"
    },
    { makeActive: false }
  );

  assert.equal(setActiveModelProfile(settings, "local").activeModelId, "local");
  assert.equal(setActiveModelProfile(settings, "missing").activeModelId, "default");
});

test("shouldMakeSavedProfileActive activates a saved non-current draft", () => {
  const settings = upsertModelProfile(
    buildInitialModelSettings(),
    {
      id: "moonshot",
      name: "Kimi",
      baseUrl: "https://api.moonshot.cn/v1",
      hasToken: true,
      modelName: "kimi-k2.6"
    },
    { makeActive: false }
  );
  const draft = settings.profiles.find((profile) => profile.id === "moonshot");

  assert.ok(draft);
  assert.equal(settings.activeModelId, "default");
  assert.equal(shouldMakeSavedProfileActive(settings, draft), true);
});

test("shouldMakeSavedProfileActive keeps the active profile active while saving edits", () => {
  const settings = buildInitialModelSettings();
  const draft = {
    ...getActiveModelProfile(settings),
    modelName: "gpt-5.5"
  };

  assert.equal(shouldMakeSavedProfileActive(settings, draft), true);
});

test("deleteModelProfile removes a profile, keeps the last one, and selects a remaining active profile", () => {
  const settings = upsertModelProfile(
    buildInitialModelSettings(),
    {
      id: "local",
      name: "Local",
      baseUrl: "http://localhost:11434/v1",
      hasToken: true,
      modelName: "qwen3-coder"
    },
    { makeActive: true }
  );

  const deleted = deleteModelProfile(settings, "local");
  assert.equal(deleted.profiles.some((profile) => profile.id === "local"), false);
  assert.equal(deleted.activeModelId, "default");

  const unchanged = deleteModelProfile(buildInitialModelSettings(), "default");
  assert.equal(unchanged.profiles.length, 1);
  assert.equal(unchanged.activeModelId, "default");
});

test("formatOpenAiCompatibleRequestPreview works for a profile", () => {
  const preview = formatOpenAiCompatibleRequestPreview({
    id: "glm",
    name: "GLM",
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    hasToken: true,
    modelName: "glm-5.1"
  });

  assert.equal(preview, "POST https://open.bigmodel.cn/api/coding/paas/v4/chat/completions · body.model = glm-5.1");
});

test("formatOpenAiCompatibleRoute works for registry settings", () => {
  const route = formatOpenAiCompatibleRoute(
    mergeSavedModelSettings(buildInitialModelSettings(), {
      activeModelId: "glm",
      profiles: [
        {
          id: "glm",
          name: "GLM",
          baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4/glm-5.1",
          hasToken: true,
          modelName: "glm-5.1"
        }
      ]
    })
  );

  assert.equal(route, "POST https://open.bigmodel.cn/api/coding/paas/v4/chat/completions · body.model = glm-5.1");
});

test("buildDraftModelProfile returns a stable new editable profile shape", () => {
  assert.deepEqual(buildDraftModelProfile("new-profile"), {
    id: "new-profile",
    name: "新模型",
    baseUrl: "https://api.openai.com/v1",
    hasToken: false,
    modelName: "",
    tokenHint: undefined
  });
});

test("buildProfileFromPreset links a preset model to the editable profile fields", () => {
  const preset = presetProviders.find((provider) => provider.id === "zhipu-coding");
  assert.ok(preset);

  const profile = buildProfileFromPreset(preset, "glm-4.7");

  assert.match(profile.id, /^zhipu-coding-/);
  assert.equal(profile.name, "智谱 Coding Plan · glm-4.7");
  assert.equal(profile.baseUrl, "https://open.bigmodel.cn/api/coding/paas/v4");
  assert.equal(profile.modelName, "glm-4.7");
  assert.equal(profile.hasToken, false);
});

test("buildProfileFromPreset preserves saved token metadata when updating an existing profile", () => {
  const preset = presetProviders.find((provider) => provider.id === "openai");
  assert.ok(preset);

  const profile = buildProfileFromPreset(preset, "gpt-5.4-mini", "default", {
    id: "default",
    name: "OpenAI GPT-5.5",
    baseUrl: "https://api.openai.com/v1",
    hasToken: true,
    modelName: "gpt-5.5",
    tokenHint: "••••1234"
  });

  assert.equal(profile.id, "default");
  assert.equal(profile.name, "OpenAI · gpt-5.4-mini");
  assert.equal(profile.hasToken, true);
  assert.equal(profile.tokenHint, "••••1234");
});

test("detectPresetProvider prefers exact coding plan profiles over same-domain official providers", () => {
  assert.equal(
    detectPresetProvider({
      id: "zhipu-coding-123",
      name: "智谱 Coding Plan · glm-5.1",
      baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
      hasToken: false,
      modelName: "glm-5.1"
    })?.id,
    "zhipu-coding"
  );
  assert.equal(
    detectPresetProvider({
      id: "bytedance-coding-123",
      name: "方舟 Coding Plan · doubao-seed-2.0-code",
      baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
      hasToken: false,
      modelName: "doubao-seed-2.0-code"
    })?.id,
    "bytedance-coding"
  );
  assert.equal(
    detectPresetProvider({
      id: "alibaba-coding-123",
      name: "百炼 Coding Plan · qwen3.5-plus",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      hasToken: false,
      modelName: "qwen3.5-plus"
    })?.id,
    "alibaba-coding"
  );
});

test("redactToken preserves current saved token hint behavior", () => {
  assert.equal(redactToken("sk-1234567890"), "••••7890");
  assert.equal(redactToken("abc"), "已保存");
});

test("normalizeOpenAiCompatibleSettings preserves current endpoint normalization behavior", () => {
  const settings = normalizeOpenAiCompatibleSettings({
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4/GLM-5.1",
    modelName: "glm-5.1"
  });

  assert.equal(settings.baseUrl, "https://open.bigmodel.cn/api/coding/paas/v4");
  assert.equal(settings.modelName, "glm-5.1");
});
