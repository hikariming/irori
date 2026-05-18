import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildInitialModelSettings,
  formatOpenAiCompatibleRequestPreview,
  isModelConfigured,
  mergeSavedModelSettings,
  normalizeOpenAiCompatibleSettings,
  redactToken
} from "./model-settings-controller.ts";

test("mergeSavedModelSettings applies OpenAI-compatible endpoint settings", () => {
  const settings = mergeSavedModelSettings(buildInitialModelSettings(), {
    baseUrl: "http://localhost:11434/v1",
    hasToken: true,
    modelName: "qwen3-coder"
  });

  assert.equal(settings.baseUrl, "http://localhost:11434/v1");
  assert.equal(settings.modelName, "qwen3-coder");
  assert.equal(settings.hasToken, true);
});

test("redactToken only preserves a short suffix for saved token hints", () => {
  assert.equal(redactToken("sk-1234567890"), "••••7890");
  assert.equal(redactToken("abc"), "已保存");
});

test("isModelConfigured requires endpoint, model name, and saved token", () => {
  assert.equal(isModelConfigured(buildInitialModelSettings()), false);
  assert.equal(
    isModelConfigured({
      baseUrl: "http://localhost:11434/v1",
      hasToken: true,
      modelName: "qwen3-coder"
    }),
    true
  );
  assert.equal(
    isModelConfigured({
      baseUrl: "http://localhost:11434/v1",
      hasToken: true,
      modelName: ""
    }),
    false
  );
});

test("formatOpenAiCompatibleRequestPreview keeps model in the request body", () => {
  const preview = formatOpenAiCompatibleRequestPreview({
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    hasToken: true,
    modelName: "glm-5.1"
  });

  assert.equal(preview, "POST https://open.bigmodel.cn/api/coding/paas/v4/chat/completions · body.model = glm-5.1");
});

test("normalizeOpenAiCompatibleSettings removes model suffix from base URL", () => {
  const settings = normalizeOpenAiCompatibleSettings({
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4/GLM-5.1",
    modelName: "glm-5.1"
  });

  assert.equal(settings.baseUrl, "https://open.bigmodel.cn/api/coding/paas/v4");
  assert.equal(settings.modelName, "glm-5.1");
});
