import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildOpenAiCompatibleModel,
  normalizeOpenAiCompatibleSettings,
  openAiCompatibleProviderId
} from "./model-provider-resolver.mjs";

// A subagent child is an independent `pi` CLI process: it resolves its model
// from a pi-native provider and reads that provider's API key from an env var.
// Our sidecar talks to providers through a synthetic "openai-compatible" model
// (baseUrl + in-memory runtime key) that the child cannot see. For providers pi
// supports natively we can bridge: map the configured baseUrl to pi's provider
// id + env var, pass the key via env (no secret on disk), and pin the child
// agents to `provider/model` so they don't fall back to pi's own default.
//
// Fast path: endpoints pi supports as first-class native providers. For these we
// pin the child to pi's own `provider/model` and pass the key via the provider's
// conventional env var. Every entry here has been live-verified. Anything NOT in
// this list still works via the universal `models.json` bridge below (which mirrors
// the parent's exact openai-compatible request), so this map is an optimization,
// not a gate — keep it conservative.
export const nativeProviderMap = [
  { match: "api.deepseek.com", providerId: "deepseek", envVar: "DEEPSEEK_API_KEY" },
  { match: "api.moonshot.", providerId: "moonshot", envVar: "MOONSHOT_API_KEY" },
  { match: "api.mistral.ai", providerId: "mistral", envVar: "MISTRAL_API_KEY" },
  { match: "api.x.ai", providerId: "xai", envVar: "XAI_API_KEY" },
  { match: "openrouter.ai", providerId: "openrouter", envVar: "OPENROUTER_API_KEY" },
  { match: "api.groq.com", providerId: "groq", envVar: "GROQ_API_KEY" }
];

// The env var name a child reads its key from when using the models.json bridge.
// We write this NAME (not the secret) into models.json and set the value in the
// child's environment, so the key never touches disk.
export const subagentApiKeyEnvVar = "COCKAPOO_SUBAGENT_API_KEY";

// Resolve a pi-native provider mapping for the configured model, or null when the
// endpoint isn't one pi supports natively (then we bridge via models.json instead).
export function resolveNativePiProvider(settings) {
  const normalized = normalizeOpenAiCompatibleSettings(settings);
  const baseUrl = normalized.baseUrl.toLowerCase();
  const entry = nativeProviderMap.find((candidate) => baseUrl.includes(candidate.match));
  if (!entry) {
    return null;
  }

  return {
    providerId: entry.providerId,
    envVar: entry.envVar,
    modelId: normalized.modelName,
    modelRef: `${entry.providerId}/${normalized.modelName}`
  };
}

// The model ref a child subagent is pinned to when using the models.json bridge:
// the custom provider key (`openai-compatible`) + the configured model id.
export function subagentBridgeModelRef(settings) {
  const normalized = normalizeOpenAiCompatibleSettings(settings);
  return `${openAiCompatibleProviderId}/${normalized.modelName}`;
}

// Build a pi `models.json` config that registers the parent's exact
// openai-compatible model as a custom provider the child `pi` process can use.
// `apiKeyEnvVar` is stored as the *name* of an env var (pi's resolveConfigValue
// reads it from the environment at request time) so the secret never lands on disk.
export function buildSubagentModelsConfig({ settings, apiKeyEnvVar = subagentApiKeyEnvVar } = {}) {
  const model = buildOpenAiCompatibleModel(settings);
  // The provider id is the JSON key; drop it from the per-model entry.
  const { provider, ...modelEntry } = model;
  return {
    providers: {
      [provider]: {
        baseUrl: model.baseUrl,
        apiKey: apiKeyEnvVar,
        api: model.api,
        models: [modelEntry]
      }
    }
  };
}

// Write the models.json bridge into the (child-shared) agent dir. The parent uses
// an in-memory registry that ignores models.json, so this only affects spawned
// children. Atomic write (temp + rename) avoids a child reading a half-written file.
export function materializeSubagentModelsJson({
  agentDir,
  settings,
  apiKeyEnvVar = subagentApiKeyEnvVar,
  deps = {}
} = {}) {
  const writeFile = deps.writeFileSync ?? writeFileSync;
  const rename = deps.renameSync ?? renameSync;
  const mkdir = deps.mkdirSync ?? mkdirSync;

  mkdir(agentDir, { recursive: true });
  const config = buildSubagentModelsConfig({ settings, apiKeyEnvVar });
  const target = join(agentDir, "models.json");
  const tmp = `${target}.${process.pid}.tmp`;
  writeFile(tmp, JSON.stringify(config, null, 2));
  rename(tmp, target);
  return target;
}

// Remove the models.json bridge (e.g. when switching to a native-provider model,
// so a child doesn't keep resolving the stale openai-compatible custom provider).
export function clearSubagentModelsJson({ agentDir, deps = {} } = {}) {
  const remove = deps.rmSync ?? rmSync;
  try {
    remove(join(agentDir, "models.json"), { force: true });
    return true;
  } catch {
    return false;
  }
}

// Set or replace one or more fields in a markdown agent's YAML frontmatter.
// Returns the input unchanged if there is no frontmatter block.
export function injectAgentFrontmatter(markdown, fields = {}) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return markdown;
  }

  let frontmatter = match[1];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    const re = new RegExp(`^${key}:.*$`, "m");
    if (re.test(frontmatter)) {
      frontmatter = frontmatter.replace(re, `${key}: ${value}`);
    } else {
      frontmatter = `${frontmatter}\n${key}: ${value}`;
    }
  }

  return markdown.replace(match[0], `---\n${frontmatter}\n---\n`);
}

// Convenience wrapper kept for the model-only case.
export function injectAgentModel(markdown, modelRef) {
  return injectAgentFrontmatter(markdown, { model: modelRef });
}

// The subagents whose model we pin. The single-writer worker is the one that
// matters most; the rest keep chains/parallel runs on the same provider.
export const managedSubagentNames = ["worker", "scout", "planner", "reviewer", "context-builder", "researcher"];

// Write app-managed copies of the bundled agents into the user-level agent dir
// (`<agentDir>/agents/`), with their model pinned to the native provider. These
// override the bundled defaults (project/user dirs win over builtin) without
// touching node_modules or the user's project repo. The API key is NOT written
// here — only the non-secret model id.
// `extensions` (optional): an absolute extension path (or comma-separated list)
// pinned into each child agent so the Cockapoo gate loads INSIDE the child —
// children do NOT inherit the parent's additionalExtensionPaths, so this is the
// only way the fence reaches them. pi-subagents always re-adds its own runtime
// extensions, so pinning here doesn't break delegation.
export function materializeSubagentModelOverrides({
  packageAgentsDir,
  agentDir,
  modelRef,
  extensions,
  agents = managedSubagentNames,
  deps = {}
} = {}) {
  const readFile = deps.readFileSync ?? readFileSync;
  const writeFile = deps.writeFileSync ?? writeFileSync;
  const mkdir = deps.mkdirSync ?? mkdirSync;
  const exists = deps.existsSync ?? existsSync;

  const outDir = join(agentDir, "agents");
  mkdir(outDir, { recursive: true });

  const rename = deps.renameSync ?? renameSync;

  const written = [];
  for (const name of agents) {
    const src = join(packageAgentsDir, `${name}.md`);
    if (!exists(src)) {
      continue;
    }
    const overridden = injectAgentFrontmatter(readFile(src, "utf-8"), { model: modelRef, extensions });
    // Write atomically (temp + rename) so a concurrent child process spawned by
    // pi-subagents can never read a half-written agent file — possible now that
    // the scheduler runs background prompts alongside an interactive chat.
    const target = join(outDir, `${name}.md`);
    const tmp = `${target}.${process.pid}.tmp`;
    writeFile(tmp, overridden);
    rename(tmp, target);
    written.push(name);
  }
  return written;
}

// Remove app-managed subagent model overrides. Called when the current model
// can't be bridged to a pi-native provider: a stale pin from a previous native
// session would otherwise make children target a provider whose key is no longer
// in the environment, so the child must fall back to its bundled default instead.
export function clearSubagentModelOverrides({
  agentDir,
  agents = managedSubagentNames,
  deps = {}
} = {}) {
  const remove = deps.rmSync ?? rmSync;
  const outDir = join(agentDir, "agents");
  const removed = [];
  for (const name of agents) {
    const target = join(outDir, `${name}.md`);
    try {
      remove(target, { force: true });
      removed.push(name);
    } catch {
      // Best-effort cleanup; a leftover file at worst reproduces today's behavior.
    }
  }
  return removed;
}
