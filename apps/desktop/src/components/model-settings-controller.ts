export type SavedModelProfile = {
  id: string;
  name: string;
  baseUrl: string;
  hasToken: boolean;
  modelName: string;
  tokenHint?: string;
};

type SavedModelProfileInput = Partial<SavedModelProfile>;
type SavedModelSettingsInput = {
  activeModelId?: string;
  profiles?: SavedModelProfileInput[];
};

export type LegacySavedModelSettings = {
  baseUrl: string;
  hasToken: boolean;
  modelName: string;
  tokenHint?: string;
};

export type SavedModelSettings = {
  activeModelId: string;
  profiles: SavedModelProfile[];
};

export type ModelSettingsState = SavedModelSettings;

export const defaultModelProfile: SavedModelProfile = {
  id: "default",
  name: "gpt-5.2",
  baseUrl: "https://api.openai.com/v1",
  hasToken: false,
  modelName: "gpt-5.2",
  tokenHint: undefined
};

export const defaultModelSettings: ModelSettingsState = normalizeModelSettings("default", [defaultModelProfile]);

type OpenAiCompatibleSettingsInput = {
  baseUrl: string;
  modelName: string;
};

function cloneProfile(profile: SavedModelProfile): SavedModelProfile {
  return {
    id: profile.id,
    name: profile.name,
    baseUrl: profile.baseUrl,
    hasToken: profile.hasToken,
    modelName: profile.modelName,
    tokenHint: profile.tokenHint
  };
}

function isRegistrySettings(settings: SavedModelSettingsInput | Partial<LegacySavedModelSettings>): settings is SavedModelSettingsInput {
  return "activeModelId" in settings || Array.isArray((settings as SavedModelSettingsInput).profiles);
}

function completeModelProfile(profile: SavedModelProfileInput, fallback: SavedModelProfile = defaultModelProfile): SavedModelProfile {
  const modelName = profile.modelName ?? fallback.modelName;
  const name = profile.name ?? modelName;

  return {
    id: profile.id ?? fallback.id,
    name,
    baseUrl: profile.baseUrl ?? fallback.baseUrl,
    hasToken: profile.hasToken ?? fallback.hasToken,
    modelName,
    tokenHint: profile.tokenHint ?? fallback.tokenHint
  };
}

function normalizeModelSettings(activeModelId: string, profiles: SavedModelProfileInput[]): ModelSettingsState {
  const normalizedProfiles = profiles.length > 0
    ? profiles.map((profile) => normalizeModelProfile(completeModelProfile(profile)))
    : [cloneProfile(defaultModelProfile)];
  const activeProfile = normalizedProfiles.find((profile) => profile.id === activeModelId) ?? normalizedProfiles[0];

  return {
    activeModelId: activeProfile.id,
    profiles: normalizedProfiles
  };
}

export function redactToken(token: string) {
  if (token.length < 8) {
    return "已保存";
  }

  return `••••${token.slice(-4)}`;
}

export function buildInitialModelSettings(): ModelSettingsState {
  return normalizeModelSettings(defaultModelSettings.activeModelId, defaultModelSettings.profiles);
}

export function buildDraftModelProfile(id: string): SavedModelProfile {
  return {
    id,
    name: "新模型",
    baseUrl: defaultModelProfile.baseUrl,
    hasToken: false,
    modelName: "",
    tokenHint: undefined
  };
}

export function normalizeModelProfile(profile: SavedModelProfile): SavedModelProfile {
  const normalized = normalizeOpenAiCompatibleSettings(profile);
  const modelName = normalized.modelName;
  const name = profile.name.trim();

  return {
    id: profile.id.trim(),
    name: name || modelName,
    baseUrl: normalized.baseUrl,
    hasToken: profile.hasToken,
    modelName,
    tokenHint: profile.tokenHint
  };
}

export function mergeSavedModelSettings(
  current: ModelSettingsState,
  saved?: SavedModelSettingsInput | Partial<LegacySavedModelSettings> | null
): ModelSettingsState {
  if (!saved) {
    return normalizeModelSettings(current.activeModelId, current.profiles);
  }

  if (isRegistrySettings(saved)) {
    const profiles: SavedModelProfileInput[] = saved.profiles?.length ? saved.profiles : current.profiles.map(cloneProfile);
    const activeModelId = saved.activeModelId ?? current.activeModelId;

    return normalizeModelSettings(activeModelId, profiles);
  }

  const legacy = saved as Partial<LegacySavedModelSettings>;
  const fallbackProfile = getActiveModelProfile(current);
  const modelName = legacy.modelName ?? fallbackProfile.modelName;
  const migratedProfile = normalizeModelProfile({
    id: "default",
    name: modelName,
    baseUrl: legacy.baseUrl ?? fallbackProfile.baseUrl,
    hasToken: legacy.hasToken ?? fallbackProfile.hasToken,
    modelName,
    tokenHint: legacy.tokenHint ?? fallbackProfile.tokenHint
  });

  return normalizeModelSettings("default", [migratedProfile]);
}

export function getActiveModelProfile(settings: SavedModelSettings): SavedModelProfile {
  const firstProfile = settings.profiles[0] ?? cloneProfile(defaultModelProfile);
  return settings.profiles.find((profile) => profile.id === settings.activeModelId) ?? firstProfile;
}

export function setActiveModelProfile(settings: SavedModelSettings, profileId: string): ModelSettingsState {
  if (!settings.profiles.some((profile) => profile.id === profileId)) {
    return normalizeModelSettings(settings.activeModelId, settings.profiles);
  }

  return normalizeModelSettings(profileId, settings.profiles);
}

export function upsertModelProfile(
  settings: SavedModelSettings,
  profile: SavedModelProfile,
  options: { makeActive?: boolean } = {}
): ModelSettingsState {
  const normalizedProfile = normalizeModelProfile(profile);
  const nextProfiles = settings.profiles.some((item) => item.id === normalizedProfile.id)
    ? settings.profiles.map((item) => (item.id === normalizedProfile.id ? normalizedProfile : cloneProfile(item)))
    : [...settings.profiles.map(cloneProfile), normalizedProfile];
  const activeModelId = options.makeActive ? normalizedProfile.id : settings.activeModelId;

  return normalizeModelSettings(activeModelId, nextProfiles);
}

export function deleteModelProfile(settings: SavedModelSettings, profileId: string): ModelSettingsState {
  if (settings.profiles.length <= 1) {
    return normalizeModelSettings(settings.activeModelId, settings.profiles);
  }

  const nextProfiles = settings.profiles.filter((profile) => profile.id !== profileId);

  if (nextProfiles.length === settings.profiles.length) {
    return normalizeModelSettings(settings.activeModelId, settings.profiles);
  }

  const activeModelId = profileId === settings.activeModelId ? nextProfiles[0].id : settings.activeModelId;

  return normalizeModelSettings(activeModelId, nextProfiles);
}

export function markTokenSaved<T extends SavedModelProfile | ModelSettingsState>(current: T, token: string): T {
  const tokenHint = redactToken(token);

  if (isRegistrySettings(current)) {
    const activeProfile = getActiveModelProfile(current);
    const legacyInput = current as SavedModelSettings & Partial<LegacySavedModelSettings>;
    const nextProfile = {
      ...activeProfile,
      baseUrl: legacyInput.baseUrl ?? activeProfile.baseUrl,
      modelName: legacyInput.modelName ?? activeProfile.modelName,
      hasToken: true,
      tokenHint
    };

    return upsertModelProfile(current, nextProfile, { makeActive: true }) as T;
  }

  return {
    ...current,
    hasToken: true,
    tokenHint
  };
}

export function isModelConfigured(settings: SavedModelSettings) {
  const profile = getActiveModelProfile(settings);

  return Boolean(profile.baseUrl.trim() && profile.modelName.trim() && profile.hasToken);
}

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

export function formatOpenAiCompatibleRequestPreview(
  settings: SavedModelProfile | SavedModelSettings | LegacySavedModelSettings | OpenAiCompatibleSettingsInput
) {
  const profile = isRegistrySettings(settings) ? getActiveModelProfile(settings) : settings;
  const normalized = normalizeOpenAiCompatibleSettings(profile);

  return `POST ${normalized.baseUrl}/chat/completions · body.model = ${normalized.modelName}`;
}

export function formatOpenAiCompatibleRoute(settings: SavedModelProfile | SavedModelSettings | LegacySavedModelSettings | OpenAiCompatibleSettingsInput) {
  return formatOpenAiCompatibleRequestPreview(settings);
}
