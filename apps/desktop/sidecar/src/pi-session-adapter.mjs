import { existsSync } from "node:fs";
import { createRequire } from "node:module";
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
import { closureGateActiveFlag } from "./extensions/cockapoo-tool-gate.mjs";
import {
  materializeSubagentModelOverrides,
  resolveNativePiProvider
} from "./subagent-native-model.mjs";

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

// The Cockapoo gate is a local extension package (not on npm), resolved by path
// relative to this module so subagent children can inherit the same fence.
export function resolveCockapooToolGatePackageRoot() {
  return fileURLToPath(new URL("../extensions/cockapoo-tool-gate", import.meta.url));
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
  additionalPackageRoots = []
}) {
  return {
    cwd,
    agentDir,
    additionalExtensionPaths: [webAccessPackageRoot, ...additionalPackageRoots].filter(Boolean),
    extensionFactories
  };
}

export async function createCockapooPiSession(options) {
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
  // a fence is configured, also load the Cockapoo gate package so children
  // inherit the SAME evaluateToolCall fence the parent enforces.
  const additionalPackageRoots = [];
  if (options?.enableSubagents) {
    // pi-subagents spawns children via `pi` on PATH; make the bundled one findable.
    ensureBundledPiOnPath();
    const subagentsRoot = resolvePiSubagentsPackageRoot();
    additionalPackageRoots.push(subagentsRoot);
    if (options?.gatePolicy) {
      additionalPackageRoots.push(resolveCockapooToolGatePackageRoot());
    }

    // Bridge our synthetic openai-compatible model to a pi-native provider so the
    // spawned child can authenticate: pass the key via env (no secret on disk),
    // and pin the child agents to `provider/model` so they don't fall back to
    // pi's own default model.
    const native = resolveNativePiProvider(options?.modelSettings ?? defaultOpenAiCompatibleSettings);
    if (native && options?.runtimeToken) {
      process.env[native.envVar] = options.runtimeToken;
      try {
        materializeSubagentModelOverrides({
          packageAgentsDir: join(subagentsRoot, "agents"),
          agentDir,
          modelRef: native.modelRef,
          // Pin the gate INTO each child — children don't inherit it otherwise.
          extensions: options?.gatePolicy ? resolveCockapooToolGatePackageRoot() : undefined
        });
      } catch {
        // Best-effort: if we can't write overrides the child falls back to its
        // default model (and will surface a clear auth error), which is no worse
        // than before.
      }
    }
  }

  const resourceLoader = new DefaultResourceLoader(buildPiResourceLoaderOptions({
    cwd: sessionOptions.cwd,
    agentDir,
    extensionFactories,
    additionalPackageRoots
  }));

  await resourceLoader.reload();

  return createAgentSession({
    ...sessionOptions,
    agentDir,
    resourceLoader
  });
}
