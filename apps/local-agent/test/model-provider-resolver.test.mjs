import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildOpenAiCompatibleModel,
  defaultOpenAiCompatibleSettings,
  formatOpenAiCompatibleRequestPreview,
  normalizeOpenAiCompatibleSettings,
  resolvePiModel
} from "../src/model-provider-resolver.mjs";

test("buildOpenAiCompatibleModel maps endpoint settings to a Pi custom model", () => {
  const model = buildOpenAiCompatibleModel({
    baseUrl: "http://localhost:11434/v1",
    modelName: "qwen3-coder"
  });

  assert.equal(model.provider, "openai-compatible");
  assert.equal(model.id, "qwen3-coder");
  assert.equal(model.api, "openai-completions");
  assert.equal(model.baseUrl, "http://localhost:11434/v1");
  assert.deepEqual(model.input, ["text"]);
  assert.equal(model.reasoning, false);
  assert.equal(model.contextWindow, 128000);
  assert.equal(model.maxTokens, 16384);
  assert.deepEqual(model.cost, {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0
  });
});

test("resolvePiModel returns the OpenAI-compatible custom model", () => {
  const model = resolvePiModel(defaultOpenAiCompatibleSettings);

  assert.equal(model.provider, "openai-compatible");
  assert.equal(model.id, "gpt-5.2");
});

test("resolvePiModel requires a model name", () => {
  assert.throws(() => resolvePiModel({ baseUrl: "http://localhost:11434/v1", modelName: "" }), /model name/);
});

test("formatOpenAiCompatibleRequestPreview keeps model in the OpenAI-compatible body", () => {
  assert.equal(
    formatOpenAiCompatibleRequestPreview({
      baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
      modelName: "glm-5.1"
    }),
    "POST https://open.bigmodel.cn/api/coding/paas/v4/chat/completions · body.model = glm-5.1"
  );
});

test("normalizeOpenAiCompatibleSettings strips a duplicated model suffix from base URL", () => {
  assert.deepEqual(
    normalizeOpenAiCompatibleSettings({
      baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4/GLM-5.1",
      modelName: "glm-5.1"
    }),
    {
      baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
      modelName: "glm-5.1"
    }
  );
});
