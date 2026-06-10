import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { delimiter, dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager
} from "@earendil-works/pi-coding-agent";

import {
  defaultOpenAiCompatibleSettings,
  normalizeOpenAiCompatibleSettings,
  openAiCompatibleProviderId,
  resolvePiModel
} from "./model-provider-resolver.mjs";
import { createToolPolicyGateExtension } from "./tool-policy-gate.mjs";
import { closureGateActiveFlag } from "./extensions/irori-tool-gate.mjs";
import {
  clearSubagentModelsJson,
  materializeSubagentModelOverrides,
  materializeSubagentModelsJson,
  resolveNativePiProvider,
  subagentApiKeyEnvVar,
  subagentBridgeModelRef
} from "./subagent-native-model.mjs";
// note: clearSubagentModelOverrides retained in subagent-native-model for callers/tests;
// the adapter overwrites stale agent .md pins on every run via materialize, so it
// no longer needs an explicit clear here.

const require = createRequire(import.meta.url);
const piWebAccessPackageName = "pi-web-access";
const piSubagentsPackageName = "pi-subagents";

const kimiPreservedThinkingModelIds = new Set([
  "kimi-k2.5",
  "kimi-k2.6",
  "kimi-k2-thinking",
  "kimi-k2-thinking-turbo",
  "kimi-thinking-preview"
]);

function modelNameMatchesId(modelName, modelId) {
  return modelName === modelId || modelName.endsWith(`/${modelId}`) || modelName.endsWith(`.${modelId}`);
}

function isOfficialKimiThinkingModel(settings = defaultOpenAiCompatibleSettings) {
  const normalized = normalizeOpenAiCompatibleSettings(settings);
  const baseUrl = normalized.baseUrl.toLowerCase();
  const modelName = normalized.modelName.toLowerCase();

  if (!baseUrl.includes("api.moonshot.")) {
    return false;
  }

  for (const modelId of kimiPreservedThinkingModelIds) {
    if (modelNameMatchesId(modelName, modelId)) {
      return true;
    }
  }

  return false;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function applyOpenAiCompatibleProviderRequestOverrides(payload, modelSettings = defaultOpenAiCompatibleSettings) {
  if (!isPlainObject(payload) || !isOfficialKimiThinkingModel(modelSettings)) {
    return payload;
  }

  const existingThinking = isPlainObject(payload.thinking) ? payload.thinking : {};

  return {
    ...payload,
    thinking: {
      ...existingThinking,
      type: "enabled",
      keep: existingThinking.keep ?? "all"
    }
  };
}

function createProviderRequestOverrideExtension(modelSettings) {
  return (pi) => {
    pi.on("before_provider_request", (event) =>
      applyOpenAiCompatibleProviderRequestOverrides(event.payload, modelSettings)
    );
  };
}

export function buildPiSessionOptions({
  cwd,
  modelSettings = defaultOpenAiCompatibleSettings,
  authPath,
  runtimeToken,
  sessionMode = "memory",
  thinkingLevel = "medium",
  tools,
  customTools
}) {
  const authStorage = AuthStorage.create(authPath);

  if (runtimeToken) {
    authStorage.setRuntimeApiKey(openAiCompatibleProviderId, runtimeToken);
  }

  const modelRegistry = ModelRegistry.inMemory(authStorage);
  const sessionManager =
    sessionMode === "persistent" ? SessionManager.create(cwd) : SessionManager.inMemory();
  const model = resolvePiModel(modelSettings);

  return {
    cwd,
    authStorage,
    modelRegistry,
    sessionManager,
    thinkingLevel,
    model,
    tools,
    customTools
  };
}

export function resolvePiWebAccessPackageRoot({ requireFn = require } = {}) {
  return dirname(requireFn.resolve(`${piWebAccessPackageName}/package.json`));
}

export function resolvePiSubagentsPackageRoot({ requireFn = require } = {}) {
  return dirname(requireFn.resolve(`${piSubagentsPackageName}/package.json`));
}

// The Irori gate is a local extension package (not on npm), resolved by path
// relative to this module so subagent children can inherit the same fence.
export function resolveIroriToolGatePackageRoot() {
  return fileURLToPath(new URL("../extensions/irori-tool-gate", import.meta.url));
}

// Both the `pi` CLI (child processes) and pi-subagents' parent-side extension
// resolve their agent dir from this env var (ENV_AGENT_DIR in pi's config).
export const piAgentDirEnvVar = "PI_CODING_AGENT_DIR";

// App-owned agent dir for subagent children. The model bridge (models.json,
// agents/*.md pins) is materialized HERE instead of the user's global
// ~/.pi/agent, so the bridge can never overwrite or delete a pi CLI user's
// own config. Children are pointed at it via piAgentDirEnvVar.
export function resolveSubagentAgentDir({ env = process.env } = {}) {
  return env.IRORI_SUBAGENT_AGENT_DIR || join(homedir(), ".irori", "pi-agent");
}

// Materialize the subagent model bridge into the app-owned agent dir and point
// child processes (and pi-subagents' agent discovery) at it through the env.
// Returns the dir the bridge was written to.
export function configureSubagentBridge({
  modelSettings = defaultOpenAiCompatibleSettings,
  runtimeToken,
  subagentsRoot,
  gateExtensionRoot,
  env = process.env,
  agentDir = resolveSubagentAgentDir({ env })
} = {}) {
  // The parent session keeps the agent dir it was created with; only code that
  // re-resolves the dir from the env (pi-subagents in-process, spawned `pi`
  // children) follows this pointer.
  env[piAgentDirEnvVar] = agentDir;

  const native = resolveNativePiProvider(modelSettings);

  if (native) {
    env[native.envVar] = runtimeToken;
    // Drop any stale models.json bridge left by a previous non-native session.
    clearSubagentModelsJson({ agentDir });
  } else {
    env[subagentApiKeyEnvVar] = runtimeToken;
    try {
      materializeSubagentModelsJson({ agentDir, settings: modelSettings });
    } catch {
      // Best-effort: without the bridge the child can't authenticate and will
      // surface a clear auth error, which is no worse than before.
    }
  }

  try {
    materializeSubagentModelOverrides({
      packageAgentsDir: join(subagentsRoot, "agents"),
      agentDir,
      modelRef: native ? native.modelRef : subagentBridgeModelRef(modelSettings),
      // Pin the gate INTO each child — children don't inherit it otherwise.
      extensions: gateExtensionRoot
    });
  } catch {
    // Best-effort: if we can't write overrides the child falls back to its
    // default model (and will surface a clear auth error), no worse than before.
  }

  return agentDir;
}

// pi-subagents spawns children by exec'ing the `pi` CLI (hardcoded on non-Windows).
// We embed the SDK as a library, so `pi` is not on PATH — but the SDK ships one
// in the (pnpm) store. Locate the bin dir that actually contains an executable
// `pi`, so we can put it on PATH before delegation.
export function resolveBundledPiBinDir({ existsFn = existsSync } = {}) {
  const candidates = [];

  try {
    const subagentsRoot = resolvePiSubagentsPackageRoot();
    const marker = `${sep}.pnpm${sep}`;
    const idx = subagentsRoot.indexOf(marker);
    if (idx !== -1) {
      // pnpm shared bin: <store>/.pnpm/node_modules/.bin
      candidates.push(join(subagentsRoot.slice(0, idx), ".pnpm", "node_modules", ".bin"));
    }
    // Walk up from the package looking for a flat node_modules/.bin (npm/yarn).
    let dir = subagentsRoot;
    while (dir !== dirname(dir)) {
      if (dir.endsWith(`${sep}node_modules`)) {
        candidates.push(join(dir, ".bin"));
      }
      dir = dirname(dir);
    }
  } catch {
    // pi-subagents not installed — nothing to resolve.
  }

  for (const dir of candidates) {
    if (existsFn(join(dir, "pi"))) {
      return dir;
    }
  }
  return undefined;
}

// Idempotently prepend the bundled pi bin dir to PATH so child `spawn("pi")` resolves.
export function ensureBundledPiOnPath({ env = process.env, resolveBinDir = resolveBundledPiBinDir } = {}) {
  const binDir = resolveBinDir();
  if (!binDir) {
    return false;
  }

  const current = env.PATH ?? "";
  const segments = current.split(delimiter);
  if (!segments.includes(binDir)) {
    env.PATH = current ? `${binDir}${delimiter}${current}` : binDir;
  }
  return true;
}

export function buildPiResourceLoaderOptions({
  cwd,
  agentDir,
  extensionFactories,
  webAccessPackageRoot = resolvePiWebAccessPackageRoot(),
  additionalPackageRoots = [],
  skillsRootPath,
  allowedSkillNames
}) {
  // Access control: pi loads every skill it can discover, then we whitelist-filter
  // to only the skills the current character is configured to know. With nothing
  // assigned the set is empty, so no skill leaks into the prompt or /skill:name.
  const allowed = new Set(Array.isArray(allowedSkillNames) ? allowedSkillNames : []);

  return {
    cwd,
    agentDir,
    additionalExtensionPaths: [webAccessPackageRoot, ...additionalPackageRoots].filter(Boolean),
    additionalSkillPaths: skillsRootPath ? [skillsRootPath] : [],
    skillsOverride: (base) => ({
      ...base,
      skills: base.skills.filter((skill) => allowed.has(skill.name))
    }),
    extensionFactories
  };
}

export async function createIroriPiSession(options) {
  const sessionOptions = buildPiSessionOptions(options);
  const agentDir = getAgentDir();
  const extensionFactories = [
    createProviderRequestOverrideExtension(options?.modelSettings ?? defaultOpenAiCompatibleSettings)
  ];

  if (options?.gatePolicy) {
    // Mark this (parent) process so the loadable gate package no-ops here and
    // only enforces inside subagent child processes.
    globalThis[closureGateActiveFlag] = true;
    extensionFactories.push(createToolPolicyGateExtension({
      gatePolicy: options.gatePolicy,
      mode: options.gateMode,
      onToolEvent: options.onToolEvent,
      onConfirm: options.onConfirm,
      confirmFallback: options.confirmFallback
    }));
  }

  // Opt-in: load pi-subagents as a local extension package (same mechanism as
  // pi-web-access) so the companion can delegate to scout/worker/reviewer. When
  // a fence is configured, also load the Irori gate package so children
  // inherit the SAME evaluateToolCall fence the parent enforces.
  const additionalPackageRoots = [];
  if (options?.enableSubagents && options?.runtimeToken) {
    // A subagent child is an independent `pi` process that must authenticate on its
    // own. We bridge our in-memory openai-compatible model to the child two ways:
    //   1. Native fast path — endpoints pi supports first-class: pin the child to
    //      pi's own `provider/model` and pass the key via that provider's env var.
    //   2. Universal models.json bridge — for everything else (default OpenAI,
    //      self-hosted/proxy endpoints, …): write a models.json registering the
    //      parent's exact openai-compatible model as a custom provider, with the key
    //      read from an env var (name on disk, secret only in env). The parent uses
    //      an in-memory registry that ignores models.json, so this only affects
    //      children. Either way the key is passed by env and never written to disk.
    //
    // The bridge lands in an app-owned agent dir (resolveSubagentAgentDir) that
    // children pick up via PI_CODING_AGENT_DIR — never in the user's ~/.pi/agent.

    // pi-subagents spawns children via `pi` on PATH; make the bundled one findable.
    ensureBundledPiOnPath();
    const subagentsRoot = resolvePiSubagentsPackageRoot();
    additionalPackageRoots.push(subagentsRoot);
    if (options?.gatePolicy) {
      additionalPackageRoots.push(resolveIroriToolGatePackageRoot());
    }

    configureSubagentBridge({
      modelSettings: options?.modelSettings ?? defaultOpenAiCompatibleSettings,
      runtimeToken: options.runtimeToken,
      subagentsRoot,
      gateExtensionRoot: options?.gatePolicy ? resolveIroriToolGatePackageRoot() : undefined
    });
  }

  const resourceLoader = new DefaultResourceLoader(buildPiResourceLoaderOptions({
    cwd: sessionOptions.cwd,
    agentDir,
    extensionFactories,
    additionalPackageRoots,
    skillsRootPath: options?.skillsRootPath,
    allowedSkillNames: options?.allowedSkillNames
  }));

  await resourceLoader.reload();

  return createAgentSession({
    ...sessionOptions,
    agentDir,
    resourceLoader
  });
}
