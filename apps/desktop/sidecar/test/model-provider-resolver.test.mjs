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
  assert.equal(model.reasoning, true);
  assert.equal(model.compat.thinkingFormat, undefined);
  assert.equal(model.contextWindow, 128000);
  assert.equal(model.maxTokens, 16384);
  assert.deepEqual(model.cost, {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0
  });
});

test("buildOpenAiCompatibleModel preserves reasoning support for Moonshot Kimi thinking models", () => {
  for (const modelName of ["kimi-k2.5", "kimi-k2.6", "kimi-k2-thinking", "kimi-thinking-preview"]) {
    const model = buildOpenAiCompatibleModel({
      baseUrl: "https://api.moonshot.cn/v1",
      modelName
    });

    assert.equal(model.provider, "openai-compatible");
    assert.equal(model.id, modelName);
    assert.equal(model.baseUrl, "https://api.moonshot.cn/v1");
    assert.equal(model.reasoning, true);
    assert.equal(model.compat.supportsReasoningEffort, false);
    assert.equal(model.compat.maxTokensField, "max_tokens");
  }
});

test("buildOpenAiCompatibleModel leaves non-thinking Kimi models without a provider thinking format", () => {
  const model = buildOpenAiCompatibleModel({
    baseUrl: "https://api.moonshot.cn/v1",
    modelName: "kimi-k2-0905-preview"
  });

  assert.equal(model.reasoning, true);
  assert.equal(model.compat.thinkingFormat, undefined);
});

test("buildOpenAiCompatibleModel enables DeepSeek thinking metadata for current reasoning models", () => {
  for (const modelName of ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-reasoner"]) {
    const model = buildOpenAiCompatibleModel({
      baseUrl: "https://api.deepseek.com",
      modelName
    });

    assert.equal(model.reasoning, true);
    assert.equal(model.compat.thinkingFormat, "deepseek");
    assert.equal(model.compat.requiresReasoningContentOnAssistantMessages, true);
    assert.deepEqual(model.thinkingLevelMap, {
      minimal: null,
      low: null,
      medium: null,
      high: "high",
      xhigh: "max"
    });
  }
});

test("buildOpenAiCompatibleModel leaves non-thinking DeepSeek chat without a provider thinking format", () => {
  const model = buildOpenAiCompatibleModel({
    baseUrl: "https://api.deepseek.com",
    modelName: "deepseek-chat"
  });

  assert.equal(model.reasoning, true);
  assert.equal(model.compat.thinkingFormat, undefined);
});

test("buildOpenAiCompatibleModel enables Qwen thinking metadata for DashScope thinking models", () => {
  for (const modelName of ["qwen3.7-max", "qwen3.5-plus", "qwen3-max", "deepseek-v3"]) {
    const model = buildOpenAiCompatibleModel({
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      modelName
    });

    assert.equal(model.reasoning, true);
    assert.equal(model.compat.thinkingFormat, "qwen");
  }
});

test("buildOpenAiCompatibleModel leaves non-thinking Qwen models without a provider thinking format", () => {
  const model = buildOpenAiCompatibleModel({
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    modelName: "qwen-turbo"
  });

  assert.equal(model.reasoning, true);
  assert.equal(model.compat.thinkingFormat, undefined);
});

test("buildOpenAiCompatibleModel enables GLM thinking metadata for Zhipu models", () => {
  for (const modelName of ["glm-5.1", "glm-5", "glm-4.7"]) {
    const model = buildOpenAiCompatibleModel({
      baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
      modelName
    });

    assert.equal(model.reasoning, true);
    assert.equal(model.compat.thinkingFormat, "zai");
    assert.equal(model.compat.zaiToolStream, true);
  }
});

test("buildOpenAiCompatibleModel leaves non-thinking GLM models without a provider thinking format", () => {
  const model = buildOpenAiCompatibleModel({
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    modelName: "glm-4-plus"
  });

  assert.equal(model.reasoning, true);
  assert.equal(model.compat.thinkingFormat, undefined);
});

test("resolvePiModel returns the OpenAI-compatible custom model", () => {
  const model = resolvePiModel(defaultOpenAiCompatibleSettings);

  assert.equal(model.provider, "openai-compatible");
  assert.equal(model.id, "gpt-5.5");
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
