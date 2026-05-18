export const openAiCompatibleProviderId = "openai-compatible";

export const defaultOpenAiCompatibleSettings = {
  baseUrl: "https://api.openai.com/v1",
  modelName: "gpt-5.2"
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

export function buildOpenAiCompatibleModel(settings = defaultOpenAiCompatibleSettings) {
  const normalized = normalizeOpenAiCompatibleSettings(settings);

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
    reasoning: false,
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
      maxTokensField: "max_tokens"
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
