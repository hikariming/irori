import { createTencentDbMemoryBackend } from "../../../../packages/memory/src/runtime.mjs";

// The upstream package is an OpenClaw plugin with no in-process client factory,
// so the default points at our bundled gateway adapter, which spawns the engine's
// HTTP gateway (one per character) and speaks irori's memory-client contract.
const defaultTencentDbModuleName = new URL("./tencentdb-memory-client.mjs", import.meta.url).href;

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function hasMemoryClientMethods(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      (
        typeof value.captureConversationTurn === "function" ||
        typeof value.recallForPrompt === "function" ||
        typeof value.listMemories === "function" ||
        typeof value.deleteMemory === "function"
      )
  );
}

function factoryFromModule(memoryModule) {
  if (!memoryModule || typeof memoryModule !== "object") {
    return null;
  }

  return (
    memoryModule.createMemoryClient ??
    memoryModule.createTencentDbMemoryClient ??
    memoryModule.createTencentDBMemoryClient ??
    memoryModule.createTdaiMemoryClient ??
    null
  );
}

function tencentDbFactoryOptions(config) {
  const options = {};

  if (config.dataDir) {
    options.dataDir = config.dataDir;
  }
  if (config.rootDataDir) {
    options.rootDataDir = config.rootDataDir;
  }
  if (config.llm) {
    options.llm = config.llm;
  }
  if (config.embedding) {
    options.embedding = config.embedding;
  }

  return options;
}

export function buildMemoryRuntimeConfig({ requestConfig = {}, env = process.env } = {}) {
  requestConfig = requestConfig?.memoryBackendConfig ?? requestConfig ?? {};
  const requestTencentDb = requestConfig.tencentdb ?? {};
  const backend =
    nonEmptyString(requestConfig.backend) ??
    nonEmptyString(env.IRORI_MEMORY_BACKEND) ??
    "chat-history";

  const llm = resolveTencentDbLlm(requestTencentDb.llm, env);

  const tencentdb = {
    moduleName:
      nonEmptyString(requestTencentDb.moduleName) ??
      nonEmptyString(env.IRORI_TENCENTDB_MEMORY_MODULE) ??
      defaultTencentDbModuleName,
    dataDir:
      nonEmptyString(requestTencentDb.dataDir) ??
      nonEmptyString(env.IRORI_TENCENTDB_MEMORY_DATA_DIR),
    client: requestTencentDb.client
  };

  const rootDataDir =
    nonEmptyString(requestTencentDb.rootDataDir) ??
    nonEmptyString(env.IRORI_TENCENTDB_MEMORY_ROOT);
  if (rootDataDir) {
    tencentdb.rootDataDir = rootDataDir;
  }
  if (llm) {
    tencentdb.llm = llm;
  }
  if (requestTencentDb.embedding) {
    tencentdb.embedding = requestTencentDb.embedding;
  }

  return { backend, tencentdb };
}

function resolveTencentDbLlm(requestLlm, env) {
  const baseUrl =
    nonEmptyString(requestLlm?.baseUrl) ?? nonEmptyString(env.TDAI_LLM_BASE_URL);
  const apiKey =
    nonEmptyString(requestLlm?.apiKey) ?? nonEmptyString(env.TDAI_LLM_API_KEY);
  const model = nonEmptyString(requestLlm?.model) ?? nonEmptyString(env.TDAI_LLM_MODEL);

  if (!baseUrl && !apiKey && !model) {
    return undefined;
  }

  const llm = {};
  if (baseUrl) llm.baseUrl = baseUrl;
  if (apiKey) llm.apiKey = apiKey;
  if (model) llm.model = model;
  return llm;
}

export async function loadTencentDbMemoryClient({
  config,
  importModule = (moduleName) => import(moduleName)
}) {
  if (hasMemoryClientMethods(config.client)) {
    return config.client;
  }

  const memoryModule = await importModule(config.moduleName);

  if (hasMemoryClientMethods(memoryModule)) {
    return memoryModule;
  }

  const factory = factoryFromModule(memoryModule);

  if (typeof factory === "function") {
    const client = await factory(tencentDbFactoryOptions(config));

    if (hasMemoryClientMethods(client)) {
      return client;
    }
  }

  throw new Error(
    `TencentDB memory module "${config.moduleName}" did not expose a compatible memory client.`
  );
}

export async function resolveConfiguredMemoryBackend({
  config,
  env = process.env,
  importModule = (moduleName) => import(moduleName)
} = {}) {
  const runtimeConfig = buildMemoryRuntimeConfig({ requestConfig: config, env });

  if (runtimeConfig.backend === "chat-history" || runtimeConfig.backend === "none") {
    return null;
  }

  if (runtimeConfig.backend !== "tencentdb") {
    throw new Error(`Unsupported memory backend: ${runtimeConfig.backend}`);
  }

  let client;

  try {
    client = await loadTencentDbMemoryClient({
      config: runtimeConfig.tencentdb,
      importModule
    });
  } catch {
    return null;
  }

  return createTencentDbMemoryBackend({ client });
}
