import { AuthStorage, createAgentSession, ModelRegistry, SessionManager } from "@earendil-works/pi-coding-agent";

import {
  defaultOpenAiCompatibleSettings,
  openAiCompatibleProviderId,
  resolvePiModel
} from "./model-provider-resolver.mjs";

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
  return createAgentSession(buildPiSessionOptions(options));
}
