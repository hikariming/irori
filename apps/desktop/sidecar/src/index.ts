export const localAgentProcess = {
  role: "pi-sdk-host",
  responsibilities: ["session-lifecycle", "event-bridge", "tool-safety", "irori-api-sync"]
} as const;

export { buildPiSessionOptions, createIroriPiSession } from "./pi-session-adapter.mjs";
export {
  buildOpenAiCompatibleModel,
  defaultOpenAiCompatibleSettings,
  formatOpenAiCompatibleRoute,
  openAiCompatibleProviderId,
  resolvePiModel
} from "./model-provider-resolver.mjs";
export {
  buildMemoryRuntimeConfig,
  loadTencentDbMemoryClient,
  resolveConfiguredMemoryBackend
} from "./configured-memory-backend.mjs";
export { runIroriPiPrompt } from "./prompt-runner.mjs";
