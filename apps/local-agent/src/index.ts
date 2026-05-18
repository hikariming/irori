export const localAgentProcess = {
  role: "pi-sdk-host",
  responsibilities: ["session-lifecycle", "event-bridge", "tool-safety", "cockapoo-api-sync"]
} as const;

export { buildPiSessionOptions, createCockapooPiSession } from "./pi-session-adapter.mjs";
export {
  buildOpenAiCompatibleModel,
  defaultOpenAiCompatibleSettings,
  formatOpenAiCompatibleRoute,
  openAiCompatibleProviderId,
  resolvePiModel
} from "./model-provider-resolver.mjs";
export { runCockapooPiPrompt } from "./prompt-runner.mjs";
