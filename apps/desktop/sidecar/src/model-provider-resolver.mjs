export const openAiCompatibleProviderId = "openai-compatible";

export const defaultOpenAiCompatibleSettings = {
  baseUrl: "https://api.openai.com/v1",
  modelName: "gpt-5.5"
};

export function normalizeOpenAiCompatibleSettings(settings = defaultOpenAiCompatibleSettings) {
  let baseUrl = (settings.baseUrl ?? defaultOpenAiCompatibleSettings.baseUrl).trim().replace(/\/+$/, "");
  const modelName = (settings.modelName ?? defaultOpenAiCompatibleSettings.modelName).trim();
  const lowerBaseUrl = baseUrl.toLowerCase();
  const lowerModelName = modelName.toLowerCase();

  if (lowerModelName && lowerBaseUrl.endsWith(`/${lowerModelName}`)) {
    baseUrl = baseUrl.slice(0, -(modelName.length + 1));
  }

  if (baseUrl.toLowerCase().endsWith("/chat/completions")) {
    baseUrl = baseUrl.slice(0, -"/chat/completions".length);
  }

  return {
    baseUrl,
    modelName
  };
}

const kimiReasoningModelIds = new Set([
  "kimi-k2.5",
  "kimi-k2.6",
  "kimi-k2-thinking",
  "kimi-k2-thinking-turbo",
  "kimi-thinking-preview"
]);

const deepSeekOfficialReasoningModelIds = new Set([
  "deepseek-v4-pro",
  "deepseek-v4-flash",
  "deepseek-reasoner"
]);

const deepSeekDashScopeReasoningModelIds = new Set([
  "deepseek-v3",
  "deepseek-v4",
  "deepseek-v4-pro",
  "deepseek-v4-flash"
]);

const qwenReasoningModelIds = new Set([
  "qwen3.5-plus",
  "qwen3.5-flash",
  "qwen3.6-plus",
  "qwen3.7-max",
  "qwen3-max",
  "qwen3-max-preview"
]);

const glmReasoningModelIds = new Set([
  "glm-4.7",
  "glm-4.7-flash",
  "glm-4.7-flashx",
  "glm-5",
  "glm-5-turbo",
  "glm-5.1",
  "glm-5v-turbo"
]);

const deepSeekThinkingLevelMap = {
  minimal: null,
  low: null,
  medium: null,
  high: "high",
  xhigh: "max"
};

function modelNameMatchesId(modelName, modelId) {
  return modelName === modelId || modelName.endsWith(`/${modelId}`) || modelName.endsWith(`.${modelId}`);
}

function modelNameMatchesAnyId(modelName, modelIds) {
  for (const modelId of modelIds) {
    if (modelNameMatchesId(modelName, modelId)) {
      return true;
    }
  }

  return false;
}

function baseUrlMatchesAny(baseUrl, fragments) {
  return fragments.some((fragment) => baseUrl.includes(fragment));
}

export function resolveOpenAiCompatibleReasoningMetadata(settings = defaultOpenAiCompatibleSettings) {
  const normalized = normalizeOpenAiCompatibleSettings(settings);
  const baseUrl = normalized.baseUrl.toLowerCase();
  const modelName = normalized.modelName.toLowerCase();

  if (modelNameMatchesAnyId(modelName, kimiReasoningModelIds)) {
    return {};
  }

  if (
    baseUrlMatchesAny(baseUrl, ["api.deepseek.com"]) &&
    modelNameMatchesAnyId(modelName, deepSeekOfficialReasoningModelIds)
  ) {
    return {
      thinkingLevelMap: deepSeekThinkingLevelMap,
      compat: {
        requiresReasoningContentOnAssistantMessages: true,
        thinkingFormat: "deepseek"
      }
    };
  }

  if (
    baseUrlMatchesAny(baseUrl, ["dashscope.aliyuncs.com"]) &&
    (modelNameMatchesAnyId(modelName, qwenReasoningModelIds) ||
      modelNameMatchesAnyId(modelName, deepSeekDashScopeReasoningModelIds))
  ) {
    return {
      compat: {
        thinkingFormat: "qwen"
      }
    };
  }

  if (
    baseUrlMatchesAny(baseUrl, ["open.bigmodel.cn", "api.z.ai"]) &&
    modelNameMatchesAnyId(modelName, glmReasoningModelIds)
  ) {
    return {
      compat: {
        thinkingFormat: "zai",
        zaiToolStream: true
      }
    };
  }

  return null;
}

export function supportsOpenAiCompatibleReasoning(settings = defaultOpenAiCompatibleSettings) {
  return resolveOpenAiCompatibleReasoningMetadata(settings) !== null;
}

export function buildOpenAiCompatibleModel(settings = defaultOpenAiCompatibleSettings) {
  const normalized = normalizeOpenAiCompatibleSettings(settings);
  const reasoningMetadata = resolveOpenAiCompatibleReasoningMetadata(normalized);

  if (!normalized.baseUrl) {
    throw new Error("OpenAI-compatible base URL is required.");
  }

  if (!normalized.modelName) {
    throw new Error("OpenAI-compatible model name is required.");
  }

  return {
    provider: openAiCompatibleProviderId,
    id: normalized.modelName,
    name: normalized.modelName,
    api: "openai-completions",
    baseUrl: normalized.baseUrl,
    // Reasoning is enabled by default so the SDK both sends thinking-enabling
    // params and surfaces any reasoning_content the server streams back. The
    // base compat below keeps supportsReasoningEffort=false, so plain OpenAI
    // endpoints receive no unsupported params; known providers still get their
    // specific thinkingFormat/thinkingLevelMap from the metadata below.
    reasoning: true,
    thinkingLevelMap: reasoningMetadata?.thinkingLevelMap,
    input: ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0
    },
    contextWindow: 128000,
    maxTokens: 16384,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: false,
      maxTokensField: "max_tokens",
      ...reasoningMetadata?.compat
    }
  };
}

export function resolvePiModel(settings = defaultOpenAiCompatibleSettings) {
  return buildOpenAiCompatibleModel(settings);
}

export function formatOpenAiCompatibleRoute(settings = defaultOpenAiCompatibleSettings) {
  return formatOpenAiCompatibleRequestPreview(settings);
}

export function formatOpenAiCompatibleRequestPreview(settings = defaultOpenAiCompatibleSettings) {
  const normalized = normalizeOpenAiCompatibleSettings(settings);

  return `POST ${normalized.baseUrl}/chat/completions · body.model = ${normalized.modelName}`;
}
