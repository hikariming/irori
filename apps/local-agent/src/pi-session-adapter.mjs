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

export async function createCockapooPiSession(options) {
  const sessionOptions = buildPiSessionOptions(options);
  const agentDir = getAgentDir();
  const extensionFactories = [
    createProviderRequestOverrideExtension(options?.modelSettings ?? defaultOpenAiCompatibleSettings)
  ];

  if (options?.gatePolicy) {
    extensionFactories.push(createToolPolicyGateExtension({
      gatePolicy: options.gatePolicy,
      mode: options.gateMode,
      onToolEvent: options.onToolEvent,
      onConfirm: options.onConfirm,
      confirmFallback: options.confirmFallback
    }));
  }

  const resourceLoader = new DefaultResourceLoader({
    cwd: sessionOptions.cwd,
    agentDir,
    extensionFactories
  });

  await resourceLoader.reload();

  return createAgentSession({
    ...sessionOptions,
    agentDir,
    resourceLoader
  });
}
