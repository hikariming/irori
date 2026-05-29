export type PresetProvider = {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  modelSuggestions: { label: string; value: string }[];
  tokenPlaceholder: string;
  iconLabel: string;
  accentColor: string;
  group: "official" | "coding-plan";
};

export const presetProviders: PresetProvider[] = [
  // ── 官方 API ──
  {
    id: "openai",
    name: "OpenAI",
    description: "GPT-5.5 / GPT-4.1 / o3 等模型，需要海外网络。",
    baseUrl: "https://api.openai.com/v1",
    modelSuggestions: [
      { label: "GPT-5.5 (旗舰)", value: "gpt-5.5" },
      { label: "GPT-5.4 Mini", value: "gpt-5.4-mini" },
      { label: "GPT-4.1", value: "gpt-4.1" },
      { label: "GPT-4.1 Mini", value: "gpt-4.1-mini" },
      { label: "o3 (推理)", value: "o3" },
      { label: "o4-mini (推理)", value: "o4-mini" }
    ],
    tokenPlaceholder: "sk-...",
    iconLabel: "OA",
    accentColor: "#10a37f",
    group: "official"
  },
  {
    id: "zhipu",
    name: "智谱 GLM",
    description: "GLM-5.1 / GLM-5 旗舰模型，国内直连。",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    modelSuggestions: [
      { label: "GLM-5.1 (最新旗舰)", value: "glm-5.1" },
      { label: "GLM-5", value: "glm-5" },
      { label: "GLM-4.7 (编程)", value: "glm-4.7" },
      { label: "GLM-4-Plus", value: "glm-4-plus" },
      { label: "GLM-4-Flash (免费)", value: "glm-4-flash" }
    ],
    tokenPlaceholder: "请输入智谱 API Key",
    iconLabel: "智",
    accentColor: "#4338ca",
    group: "official"
  },
  {
    id: "alibaba",
    name: "阿里通义",
    description: "Qwen3.7-Max / Qwen3.5 系列，百炼平台。",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    modelSuggestions: [
      { label: "Qwen3.7-Max (最新)", value: "qwen3.7-max" },
      { label: "Qwen3.5-Plus", value: "qwen3.5-plus" },
      { label: "Qwen3-Max", value: "qwen3-max" },
      { label: "Qwen3-Coder", value: "qwen3-coder" },
      { label: "Qwen-Turbo (经济)", value: "qwen-turbo" }
    ],
    tokenPlaceholder: "sk-...",
    iconLabel: "通",
    accentColor: "#ff6a00",
    group: "official"
  },
  {
    id: "moonshot",
    name: "Kimi · 月之暗面",
    description: "Kimi K2.6 最新代码模型，256K 超长上下文。",
    baseUrl: "https://api.moonshot.cn/v1",
    modelSuggestions: [
      { label: "Kimi K2.6 (最新)", value: "kimi-k2.6" },
      { label: "Kimi K2.5", value: "kimi-k2.5" }
    ],
    tokenPlaceholder: "sk-...",
    iconLabel: "Ki",
    accentColor: "#1e1e2e",
    group: "official"
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    description: "V4 / R1 深度求索，高性价比推理模型。",
    baseUrl: "https://api.deepseek.com",
    modelSuggestions: [
      { label: "DeepSeek-V4-Pro (旗舰)", value: "deepseek-v4-pro" },
      { label: "DeepSeek-V4-Flash", value: "deepseek-v4-flash" },
      { label: "DeepSeek-R1 (推理)", value: "deepseek-reasoner" },
      { label: "DeepSeek-Chat", value: "deepseek-chat" }
    ],
    tokenPlaceholder: "sk-...",
    iconLabel: "DS",
    accentColor: "#4f46e5",
    group: "official"
  },
  {
    id: "baidu",
    name: "百度文心",
    description: "ERNIE 5.1 / 5.0 文心系列，千帆平台。",
    baseUrl: "https://qianfan.baidubce.com/v2",
    modelSuggestions: [
      { label: "ERNIE 5.1 (最新)", value: "ernie-5.1" },
      { label: "ERNIE 5.0", value: "ernie-5.0" },
      { label: "ERNIE 4.5", value: "ernie-4.5" },
      { label: "ERNIE-4.0-8K", value: "ernie-4.0-8k" },
      { label: "ERNIE-Speed (免费)", value: "ernie-speed-128k" }
    ],
    tokenPlaceholder: "请输入百度千帆 API Key",
    iconLabel: "文",
    accentColor: "#2932e1",
    group: "official"
  },
  {
    id: "bytedance",
    name: "字节豆包",
    description: "豆包 Seed 2.0 系列，火山引擎方舟平台。",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    modelSuggestions: [
      { label: "Doubao-Seed-2.0-Code", value: "doubao-seed-2.0-code" },
      { label: "Doubao-Seed-Code", value: "doubao-seed-code" },
      { label: "Doubao-Pro-128K", value: "doubao-pro-128k" },
      { label: "Doubao-Lite-128K", value: "doubao-lite-128k" }
    ],
    tokenPlaceholder: "请输入方舟平台 API Key",
    iconLabel: "豆",
    accentColor: "#00d4aa",
    group: "official"
  },

  // ── 编码套餐 (Coding Plan) ──
  {
    id: "zhipu-coding",
    name: "智谱 Coding Plan",
    description: "智谱编程套餐，GLM-5.1 / GLM-4.7 专属端点。",
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    modelSuggestions: [
      { label: "GLM-5.1 (编程旗舰)", value: "glm-5.1" },
      { label: "GLM-4.7 (编程主力)", value: "glm-4.7" },
      { label: "GLM-5", value: "glm-5" }
    ],
    tokenPlaceholder: "请输入智谱 Coding Plan API Key",
    iconLabel: "智",
    accentColor: "#4338ca",
    group: "coding-plan"
  },
  {
    id: "alibaba-coding",
    name: "百炼 Coding Plan",
    description: "阿里云百炼编程套餐，聚合多家顶尖模型。",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    modelSuggestions: [
      { label: "Qwen3.5-Plus", value: "qwen3.5-plus" },
      { label: "Qwen3-Coder", value: "qwen3-coder" },
      { label: "Kimi K2.5", value: "kimi-k2.5" },
      { label: "GLM-5", value: "glm-5" },
      { label: "DeepSeek-V3", value: "deepseek-v3" }
    ],
    tokenPlaceholder: "请输入百炼 Coding Plan API Key",
    iconLabel: "通",
    accentColor: "#ff6a00",
    group: "coding-plan"
  },
  {
    id: "bytedance-coding",
    name: "方舟 Coding Plan",
    description: "火山方舟编程套餐，豆包 Seed 2.0 代码模型。",
    baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
    modelSuggestions: [
      { label: "Doubao-Seed-2.0-Code", value: "doubao-seed-2.0-code" },
      { label: "Doubao-Seed-Code", value: "doubao-seed-code" },
      { label: "GLM-5.1", value: "glm-5.1" },
      { label: "MiniMax-M2.7", value: "minimax-m2.7" }
    ],
    tokenPlaceholder: "请输入方舟 Coding Plan API Key",
    iconLabel: "豆",
    accentColor: "#00d4aa",
    group: "coding-plan"
  },

  // ── 自定义 ──
  {
    id: "custom",
    name: "自定义供应商",
    description: "任意 OpenAI 兼容接口，手动填写 Base URL。",
    baseUrl: "",
    modelSuggestions: [],
    tokenPlaceholder: "请输入 API Key",
    iconLabel: "+",
    accentColor: "#6b7280",
    group: "official"
  }
];

export function getPresetProvider(id: string): PresetProvider | undefined {
  return presetProviders.find((provider) => provider.id === id);
}

export function buildProfileFromPreset(
  preset: PresetProvider,
  modelValue?: string,
  profileId = `${preset.id}-${Date.now()}`,
  existingProfile?: Pick<SavedModelProfile, "hasToken" | "tokenHint">
): SavedModelProfile {
  const model = modelValue ?? preset.modelSuggestions[0]?.value ?? "";

  return {
    id: profileId,
    name: `${preset.name} · ${model || "新模型"}`,
    baseUrl: preset.baseUrl,
    hasToken: existingProfile?.hasToken ?? false,
    modelName: model,
    tokenHint: existingProfile?.tokenHint
  };
}

function normalizedPresetBaseUrl(baseUrl: string) {
  return baseUrl.trim().toLowerCase().replace(/\/+$/, "");
}

function presetHost(baseUrl: string) {
  return normalizedPresetBaseUrl(baseUrl).replace(/^https?:\/\//, "").split("/")[0];
}

function presetMatchesProfileId(preset: PresetProvider, profileId: string) {
  return profileId === preset.id || profileId.startsWith(`${preset.id}-`);
}

export function detectPresetProvider(target: string | Partial<SavedModelProfile>): PresetProvider | undefined {
  const baseUrl = typeof target === "string" ? target : (target.baseUrl ?? "");

  if (typeof target !== "string") {
    const profileId = (target.id ?? "").trim().toLowerCase();
    const profileName = (target.name ?? "").trim().toLowerCase();
    const providersBySpecificId = [...presetProviders].sort((left, right) => right.id.length - left.id.length);
    const idMatchedProvider = providersBySpecificId.find((preset) => presetMatchesProfileId(preset, profileId));

    if (idMatchedProvider) {
      return idMatchedProvider;
    }

    const nameMatchedProvider = presetProviders.find((preset) => {
      const presetName = preset.name.toLowerCase();
      return profileName === presetName || profileName.startsWith(`${presetName} ·`);
    });

    if (nameMatchedProvider) {
      return nameMatchedProvider;
    }
  }

  if (!baseUrl.trim()) {
    return undefined;
  }

  const normalized = normalizedPresetBaseUrl(baseUrl);
  const providersWithBaseUrl = presetProviders.filter((preset) => preset.baseUrl);
  const exactMatch = providersWithBaseUrl.find((preset) => normalizedPresetBaseUrl(preset.baseUrl) === normalized);

  if (exactMatch) {
    return exactMatch;
  }

  const longestPrefixMatch = [...providersWithBaseUrl]
    .sort((left, right) => normalizedPresetBaseUrl(right.baseUrl).length - normalizedPresetBaseUrl(left.baseUrl).length)
    .find((preset) => {
      const presetNormalized = normalizedPresetBaseUrl(preset.baseUrl);
      return normalized.startsWith(`${presetNormalized}/`);
    });

  if (longestPrefixMatch) {
    return longestPrefixMatch;
  }

  const targetHost = presetHost(baseUrl);

  return providersWithBaseUrl.find((preset) => presetHost(preset.baseUrl) === targetHost);
}

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
  name: "GPT-5.5",
  baseUrl: "https://api.openai.com/v1",
  hasToken: false,
  modelName: "gpt-5.5",
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

export function shouldMakeSavedProfileActive(settings: SavedModelSettings, profile: SavedModelProfile): boolean {
  const activeProfile = getActiveModelProfile(settings);

  return profile.id !== activeProfile.id || profile.id === settings.activeModelId;
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
