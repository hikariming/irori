import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const defaultPiWebAccessConfigPath = join(homedir(), ".pi", "web-search.json");

const providers = new Set(["auto", "exa", "perplexity", "gemini"]);
const workflows = new Set(["none", "summary-review"]);

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeProvider(value) {
  const normalized = normalizeString(value).toLowerCase();
  return providers.has(normalized) ? normalized : "auto";
}

function normalizeWorkflow(value) {
  const normalized = normalizeString(value).toLowerCase();
  return workflows.has(normalized) ? normalized : "none";
}

function normalizeKey(value) {
  const normalized = normalizeString(value);
  return normalized || undefined;
}

function hasProviderKey(settings, provider) {
  if (provider === "exa") {
    return Boolean(normalizeKey(settings?.exaApiKey));
  }
  if (provider === "perplexity") {
    return Boolean(normalizeKey(settings?.perplexityApiKey));
  }
  if (provider === "gemini") {
    return Boolean(normalizeKey(settings?.geminiApiKey));
  }
  return false;
}

function effectiveProvider(settings) {
  const provider = normalizeProvider(settings?.provider);

  if (settings?.noKeyFallback !== true) {
    return provider;
  }

  if (provider === "perplexity" && !hasProviderKey(settings, "perplexity")) {
    return "auto";
  }

  if (
    provider === "gemini" &&
    !hasProviderKey(settings, "gemini") &&
    settings?.allowBrowserCookies !== true
  ) {
    return "auto";
  }

  return provider;
}

export function buildPiWebAccessConfig(settings = {}) {
  const provider = effectiveProvider(settings);
  const config = {
    provider,
    searchProvider: provider,
    workflow: normalizeWorkflow(settings?.workflow),
    allowBrowserCookies: settings?.allowBrowserCookies === true
  };

  const exaApiKey = normalizeKey(settings?.exaApiKey);
  const perplexityApiKey = normalizeKey(settings?.perplexityApiKey);
  const geminiApiKey = normalizeKey(settings?.geminiApiKey);

  if (exaApiKey) {
    config.exaApiKey = exaApiKey;
  }
  if (perplexityApiKey) {
    config.perplexityApiKey = perplexityApiKey;
  }
  if (geminiApiKey) {
    config.geminiApiKey = geminiApiKey;
  }

  return config;
}

async function readExistingConfig(path) {
  if (!existsSync(path)) {
    return {};
  }

  const raw = await readFile(path, "utf-8");
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

export async function writePiWebAccessConfig({
  settings,
  configPath = defaultPiWebAccessConfigPath
} = {}) {
  const existing = await readExistingConfig(configPath);
  const next = {
    ...existing,
    ...buildPiWebAccessConfig(settings)
  };

  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`);

  return next;
}
