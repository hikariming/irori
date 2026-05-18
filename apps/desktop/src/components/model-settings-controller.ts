export type SavedModelSettings = {
  baseUrl: string;
  hasToken: boolean;
  modelName: string;
  tokenHint?: string;
};

export type ModelSettingsState = SavedModelSettings;

export const defaultModelSettings: ModelSettingsState = {
  baseUrl: "https://api.openai.com/v1",
  hasToken: false,
  modelName: "gpt-5.2",
  tokenHint: undefined
};

export function redactToken(token: string) {
  if (token.length < 8) {
    return "已保存";
  }

  return `••••${token.slice(-4)}`;
}

export function buildInitialModelSettings(): ModelSettingsState {
  return { ...defaultModelSettings };
}

export function mergeSavedModelSettings(
  current: ModelSettingsState,
  saved?: Partial<SavedModelSettings> | null
): ModelSettingsState {
  if (!saved) {
    return current;
  }

  return {
    ...current,
    baseUrl: saved.baseUrl ?? current.baseUrl,
    hasToken: saved.hasToken ?? current.hasToken,
    modelName: saved.modelName ?? current.modelName,
    tokenHint: saved.tokenHint ?? current.tokenHint
  };
}

export function markTokenSaved(current: ModelSettingsState, token: string): ModelSettingsState {
  return {
    ...current,
    hasToken: true,
    tokenHint: redactToken(token)
  };
}

export function isModelConfigured(settings: ModelSettingsState) {
  return Boolean(settings.baseUrl.trim() && settings.modelName.trim() && settings.hasToken);
}

type OpenAiCompatibleSettingsInput = {
  baseUrl: string;
  modelName: string;
};

export function normalizeOpenAiCompatibleSettings(settings: OpenAiCompatibleSettingsInput) {
  let baseUrl = settings.baseUrl.trim().replace(/\/+$/, "");
  const modelName = settings.modelName.trim();
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

export function formatOpenAiCompatibleRequestPreview(settings: ModelSettingsState | OpenAiCompatibleSettingsInput) {
  const normalized = normalizeOpenAiCompatibleSettings(settings);

  return `POST ${normalized.baseUrl}/chat/completions · body.model = ${normalized.modelName}`;
}

export function formatOpenAiCompatibleRoute(settings: ModelSettingsState) {
  return formatOpenAiCompatibleRequestPreview(settings);
}
