import { createTencentDbMemoryBackend } from "../../../packages/memory/src/index.ts";

const defaultTencentDbModuleName = "@tencentdb-agent-memory/memory-tencentdb";

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

  return options;
}

export function buildMemoryRuntimeConfig({ requestConfig = {}, env = process.env } = {}) {
  requestConfig = requestConfig?.memoryBackendConfig ?? requestConfig ?? {};
  const requestTencentDb = requestConfig.tencentdb ?? {};
  const backend =
    nonEmptyString(requestConfig.backend) ??
    nonEmptyString(env.COCKAPOO_MEMORY_BACKEND) ??
    "chat-history";

  return {
    backend,
    tencentdb: {
      moduleName:
        nonEmptyString(requestTencentDb.moduleName) ??
        nonEmptyString(env.COCKAPOO_TENCENTDB_MEMORY_MODULE) ??
        defaultTencentDbModuleName,
      dataDir:
        nonEmptyString(requestTencentDb.dataDir) ??
        nonEmptyString(env.COCKAPOO_TENCENTDB_MEMORY_DATA_DIR),
      client: requestTencentDb.client
    }
  };
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
