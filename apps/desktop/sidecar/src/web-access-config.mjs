import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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

  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    // 损坏的旧配置不该让之后的每次对话都失败；当作空配置，下面的原子写覆盖自愈。
    return {};
  }
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
  // Atomic write (temp + rename) so a crash mid-write can never leave a
  // half-written file behind for the next run to choke on.
  const tmp = `${configPath}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`);
  await rename(tmp, configPath);

  return next;
}
