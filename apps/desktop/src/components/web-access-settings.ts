export type WebAccessProvider = "auto" | "exa" | "perplexity" | "gemini";
export type WebAccessWorkflow = "none" | "summary-review";
export type WebAccessProviderId = Exclude<WebAccessProvider, "auto">;

export type WebAccessSettingsState = {
  provider: WebAccessProvider;
  workflow: WebAccessWorkflow;
  noKeyFallback: boolean;
  allowBrowserCookies: boolean;
  exaHasKey: boolean;
  exaKeyHint?: string;
  perplexityHasKey: boolean;
  perplexityKeyHint?: string;
  geminiHasKey: boolean;
  geminiKeyHint?: string;
};

export type SaveWebAccessSettingsRequest = {
  provider: WebAccessProvider;
  workflow: WebAccessWorkflow;
  noKeyFallback: boolean;
  allowBrowserCookies: boolean;
  exaApiKey?: string;
  perplexityApiKey?: string;
  geminiApiKey?: string;
};

type WebAccessSettingsInput = Partial<WebAccessSettingsState> & Record<string, unknown>;

export type WebAccessKeyRow = {
  id: WebAccessProviderId;
  label: string;
  description: string;
  hasKey: boolean;
  status: string;
  placeholder: string;
};

export type WebAccessSettingsViewModel = {
  providerLabel: string;
  effectiveProviderLabel: string;
  workflowLabel: string;
  willFallbackWithoutKey: boolean;
  keyRows: WebAccessKeyRow[];
};

const providerLabels: Record<WebAccessProvider, string> = {
  auto: "Auto",
  exa: "Exa",
  perplexity: "Perplexity",
  gemini: "Gemini"
};

const workflowLabels: Record<WebAccessWorkflow, string> = {
  none: "直接返回",
  "summary-review": "浏览器审阅"
};

const keyRows: Array<Omit<WebAccessKeyRow, "hasKey" | "status"> & { key: keyof WebAccessSettingsState; hint: keyof WebAccessSettingsState }> = [
  {
    id: "exa",
    label: "Exa",
    description: "有 key 时使用 Exa API；无 key 时 pi-web-access 会尝试 Exa MCP fallback。",
    placeholder: "exa-...",
    key: "exaHasKey",
    hint: "exaKeyHint"
  },
  {
    id: "perplexity",
    label: "Perplexity",
    description: "使用 Perplexity Sonar 搜索，需要 API Key。",
    placeholder: "pplx-...",
    key: "perplexityHasKey",
    hint: "perplexityKeyHint"
  },
  {
    id: "gemini",
    label: "Gemini",
    description: "可使用 Gemini API Key；也可在允许浏览器 Cookie 后走已登录浏览器。",
    placeholder: "AIza...",
    key: "geminiHasKey",
    hint: "geminiKeyHint"
  }
];

export function redactedWebAccessKeyHint(key: string) {
  const normalized = key.trim();
  if (normalized.length < 8) {
    return "已保存";
  }

  return `••••${normalized.slice(-4)}`;
}

function normalizeProvider(value: unknown): WebAccessProvider {
  return value === "exa" || value === "perplexity" || value === "gemini" ? value : "auto";
}

function normalizeWorkflow(value: unknown): WebAccessWorkflow {
  return value === "summary-review" ? "summary-review" : "none";
}

function optionalHint(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function buildDefaultWebAccessSettings(): WebAccessSettingsState {
  return {
    provider: "auto",
    workflow: "none",
    noKeyFallback: true,
    allowBrowserCookies: false,
    exaHasKey: false,
    exaKeyHint: undefined,
    perplexityHasKey: false,
    perplexityKeyHint: undefined,
    geminiHasKey: false,
    geminiKeyHint: undefined
  };
}

export function mergeSavedWebAccessSettings(saved?: unknown): WebAccessSettingsState {
  const defaults = buildDefaultWebAccessSettings();

  if (!saved || typeof saved !== "object" || Array.isArray(saved)) {
    return defaults;
  }
  const input = saved as WebAccessSettingsInput;

  return {
    provider: normalizeProvider(input.provider),
    workflow: normalizeWorkflow(input.workflow),
    noKeyFallback: typeof input.noKeyFallback === "boolean" ? input.noKeyFallback : defaults.noKeyFallback,
    allowBrowserCookies: input.allowBrowserCookies === true,
    exaHasKey: input.exaHasKey === true,
    exaKeyHint: optionalHint(input.exaKeyHint),
    perplexityHasKey: input.perplexityHasKey === true,
    perplexityKeyHint: optionalHint(input.perplexityKeyHint),
    geminiHasKey: input.geminiHasKey === true,
    geminiKeyHint: optionalHint(input.geminiKeyHint)
  };
}

function savedKeyState(current: WebAccessSettingsState, key: string | undefined, hasField: keyof WebAccessSettingsState, hintField: keyof WebAccessSettingsState) {
  const normalized = key?.trim();
  if (normalized) {
    return {
      [hasField]: true,
      [hintField]: redactedWebAccessKeyHint(normalized)
    };
  }

  return {
    [hasField]: current[hasField],
    [hintField]: current[hintField]
  };
}

export function applyWebAccessSettingsRequest(
  current: WebAccessSettingsState,
  request: SaveWebAccessSettingsRequest
): WebAccessSettingsState {
  return mergeSavedWebAccessSettings({
    ...current,
    provider: request.provider,
    workflow: request.workflow,
    noKeyFallback: request.noKeyFallback,
    allowBrowserCookies: request.allowBrowserCookies,
    ...savedKeyState(current, request.exaApiKey, "exaHasKey", "exaKeyHint"),
    ...savedKeyState(current, request.perplexityApiKey, "perplexityHasKey", "perplexityKeyHint"),
    ...savedKeyState(current, request.geminiApiKey, "geminiHasKey", "geminiKeyHint")
  });
}

function providerHasKey(settings: WebAccessSettingsState, provider: WebAccessProvider) {
  if (provider === "exa") {
    return settings.exaHasKey;
  }
  if (provider === "perplexity") {
    return settings.perplexityHasKey;
  }
  if (provider === "gemini") {
    return settings.geminiHasKey || settings.allowBrowserCookies;
  }
  return true;
}

function effectiveProvider(settings: WebAccessSettingsState): WebAccessProvider {
  if (!settings.noKeyFallback || settings.provider === "auto") {
    return settings.provider;
  }

  return providerHasKey(settings, settings.provider) ? settings.provider : "auto";
}

export function buildWebAccessSettingsViewModel(settings: WebAccessSettingsState): WebAccessSettingsViewModel {
  const effective = effectiveProvider(settings);

  return {
    providerLabel: providerLabels[settings.provider],
    effectiveProviderLabel: providerLabels[effective],
    workflowLabel: workflowLabels[settings.workflow],
    willFallbackWithoutKey: settings.provider !== "auto" && settings.noKeyFallback && effective === "auto",
    keyRows: keyRows.map((row) => {
      const hasKey = settings[row.key] === true;
      const hint = settings[row.hint];

      return {
        id: row.id,
        label: row.label,
        description: row.description,
        placeholder: row.placeholder,
        hasKey,
        status: hasKey ? (typeof hint === "string" ? hint : "已保存") : "未保存"
      };
    })
  };
}
