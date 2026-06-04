import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { normalizeOpenAiCompatibleSettings } from "./model-provider-resolver.mjs";

// A subagent child is an independent `pi` CLI process: it resolves its model
// from a pi-native provider and reads that provider's API key from an env var.
// Our sidecar talks to providers through a synthetic "openai-compatible" model
// (baseUrl + in-memory runtime key) that the child cannot see. For providers pi
// supports natively we can bridge: map the configured baseUrl to pi's provider
// id + env var, pass the key via env (no secret on disk), and pin the child
// agents to `provider/model` so they don't fall back to pi's own default.
//
// Keyed by a substring of the configured baseUrl. Extend as needed.
export const nativeProviderMap = [
  { match: "api.deepseek.com", providerId: "deepseek", envVar: "DEEPSEEK_API_KEY" },
  { match: "api.moonshot.", providerId: "moonshot", envVar: "MOONSHOT_API_KEY" },
  { match: "api.mistral.ai", providerId: "mistral", envVar: "MISTRAL_API_KEY" },
  { match: "api.x.ai", providerId: "xai", envVar: "XAI_API_KEY" },
  { match: "openrouter.ai", providerId: "openrouter", envVar: "OPENROUTER_API_KEY" },
  { match: "api.groq.com", providerId: "groq", envVar: "GROQ_API_KEY" }
];

// Resolve a pi-native provider mapping for the configured model, or null when the
// endpoint isn't one pi supports natively (then we can't bridge subagents over env).
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

  const written = [];
  for (const name of agents) {
    const src = join(packageAgentsDir, `${name}.md`);
    if (!exists(src)) {
      continue;
    }
    const overridden = injectAgentFrontmatter(readFile(src, "utf-8"), { model: modelRef, extensions });
    writeFile(join(outDir, `${name}.md`), overridden);
    written.push(name);
  }
  return written;
}
