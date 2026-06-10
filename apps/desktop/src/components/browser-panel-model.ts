export type BrowserPanelSource = "agent" | "user";

export type BrowserPanelStatus = "empty" | "loading" | "ready" | "error";

export type BrowserOpenRequest = {
  action: "open";
  url: string;
  title?: string;
  reason?: string;
  source: BrowserPanelSource;
};

export type BrowserPanelState = {
  currentUrl: string;
  urlInput: string;
  title: string;
  status: BrowserPanelStatus;
  lastSource?: BrowserPanelSource;
  reason?: string;
  error?: string;
  updatedAt?: number;
};

export type BrowserPanelSnapshot = {
  currentUrl: string;
  title?: string;
  status: Exclude<BrowserPanelStatus, "empty">;
};

export function createInitialBrowserState(): BrowserPanelState {
  return {
    currentUrl: "",
    urlInput: "",
    title: "",
    status: "empty"
  };
}

export function normalizeBrowserUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    if (!url.hostname) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function applyBrowserOpenRequest(
  state: BrowserPanelState,
  request: BrowserOpenRequest,
  now = Date.now()
): BrowserPanelState {
  const url = normalizeBrowserUrl(request.url);

  if (!url) {
    return {
      ...state,
      urlInput: request.url,
      status: state.currentUrl ? "error" : "empty",
      error: "URL 无效"
    };
  }

  return {
    currentUrl: url,
    urlInput: url,
    title: request.title?.trim() ?? "",
    status: "loading",
    lastSource: request.source,
    reason: request.reason?.trim() || undefined,
    error: undefined,
    updatedAt: now
  };
}

export function markBrowserReady(state: BrowserPanelState): BrowserPanelState {
  if (!state.currentUrl) {
    return state;
  }

  return {
    ...state,
    status: "ready",
    error: undefined
  };
}

export function updateBrowserInput(state: BrowserPanelState, value: string): BrowserPanelState {
  return {
    ...state,
    urlInput: value
  };
}

export function buildBrowserSnapshot(state: BrowserPanelState): BrowserPanelSnapshot | null {
  if (!state.currentUrl || state.status === "empty") {
    return null;
  }

  return {
    currentUrl: state.currentUrl,
    ...(state.title ? { title: state.title } : {}),
    status: state.status === "error" ? "error" : state.status
  };
}
