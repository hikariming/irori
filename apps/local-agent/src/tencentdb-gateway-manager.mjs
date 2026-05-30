import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { spawn as nodeSpawn } from "node:child_process";
import { createRequire } from "node:module";

const defaultPackageName = "@tencentdb-agent-memory/memory-tencentdb";
const runtimeFileName = "gateway.runtime.json";

function noopLogger() {
  return { debug() {}, info() {}, warn() {}, error() {} };
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Each character gets its own dataDir — that is the engine's only isolation
 * boundary, because L1/L2/L3 recall pools every memory in a dataDir globally
 * and ignores session_key. So per-character memory == per-character dataDir
 * == per-character gateway process.
 */
export function characterDataDir(rootDataDir, characterId) {
  const safe = String(characterId).replace(/[^A-Za-z0-9._-]/g, "_") || "default";
  return path.join(rootDataDir, safe);
}

function allocatePort(host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : undefined;
      server.close(() => {
        if (port) {
          resolve(port);
        } else {
          reject(new Error("Failed to allocate a free port for the TDAI gateway."));
        }
      });
    });
  });
}

function findPackageDir(requireFn, packageName) {
  // exports map only exposes ".", so resolve the main entry then walk up to the
  // directory that actually owns package.json for this package.
  const entry = requireFn.resolve(packageName);
  let dir = path.dirname(entry);

  for (let depth = 0; depth < 8; depth += 1) {
    const manifestPath = path.join(dir, "package.json");
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
        if (manifest?.name === packageName) {
          return dir;
        }
      } catch {
        // ignore unreadable manifests and keep walking up
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  throw new Error(`Could not locate the install directory for "${packageName}".`);
}

function readRuntimeFile(dataDir) {
  try {
    const raw = fs.readFileSync(path.join(dataDir, runtimeFileName), "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.port === "number") {
      return parsed;
    }
  } catch {
    // missing or malformed runtime file — treat as no running gateway
  }
  return null;
}

function writeRuntimeFile(dataDir, info) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, runtimeFileName), JSON.stringify(info, null, 2));
}

function gatewayEnv({ dataDir, port, host, llm, extraEnv }) {
  const env = {
    ...process.env,
    TDAI_DATA_DIR: dataDir,
    TDAI_GATEWAY_PORT: String(port),
    TDAI_GATEWAY_HOST: host
  };

  if (llm) {
    if (nonEmptyString(llm.baseUrl)) env.TDAI_LLM_BASE_URL = llm.baseUrl;
    if (nonEmptyString(llm.apiKey)) env.TDAI_LLM_API_KEY = llm.apiKey;
    if (nonEmptyString(llm.model)) env.TDAI_LLM_MODEL = llm.model;
    if (llm.maxTokens != null) env.TDAI_LLM_MAX_TOKENS = String(llm.maxTokens);
    if (llm.timeoutMs != null) env.TDAI_LLM_TIMEOUT_MS = String(llm.timeoutMs);
  }

  return { ...env, ...(extraEnv ?? {}) };
}

/**
 * Manages one long-lived TDAI gateway process per character.
 *
 * Gateways are spawned detached so they survive the short-lived per-prompt
 * `pi-prompt` invocation and are reused on the next prompt (discovered via a
 * runtime file under each character's dataDir).
 */
export function createGatewayManager(options = {}) {
  const {
    rootDataDir,
    host = "127.0.0.1",
    llm,
    packageName = defaultPackageName,
    healthTimeoutMs = 30_000,
    healthIntervalMs = 500,
    extraEnv,
    spawn = nodeSpawn,
    fetchImpl = globalThis.fetch,
    allocatePortImpl = allocatePort,
    requireFn = createRequire(import.meta.url),
    logger = noopLogger()
  } = options;

  if (!nonEmptyString(rootDataDir)) {
    throw new Error("createGatewayManager requires a rootDataDir.");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("createGatewayManager requires a fetch implementation.");
  }

  // characterId -> Promise<string baseUrl>; prevents double-spawn within a process.
  const pending = new Map();

  async function healthy(baseUrl) {
    try {
      const response = await fetchImpl(`${baseUrl}/health`, { method: "GET" });
      if (!response.ok) {
        return false;
      }
      const body = await response.json();
      return body?.status === "ok" || body?.status === "degraded";
    } catch {
      return false;
    }
  }

  async function waitForHealth(baseUrl) {
    const deadline = Date.now() + healthTimeoutMs;
    while (Date.now() < deadline) {
      if (await healthy(baseUrl)) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, healthIntervalMs));
    }
    return false;
  }

  async function startGateway(characterId) {
    const dataDir = characterDataDir(rootDataDir, characterId);
    fs.mkdirSync(dataDir, { recursive: true });

    // Reuse an already-running gateway recorded in the runtime file.
    const existing = readRuntimeFile(dataDir);
    if (existing) {
      const baseUrl = `http://${host}:${existing.port}`;
      if (await healthy(baseUrl)) {
        logger.debug?.(`[tdai-manager] Reusing gateway for ${characterId} at ${baseUrl}`);
        return baseUrl;
      }
    }

    const port = await allocatePortImpl(host);
    const baseUrl = `http://${host}:${port}`;
    const pkgDir = findPackageDir(requireFn, packageName);
    const tsxBin = path.join(pkgDir, "node_modules", ".bin", "tsx");
    const entry = path.join(pkgDir, "src", "gateway", "server.ts");
    const command = fs.existsSync(tsxBin) ? tsxBin : "npx";
    const args = command === "npx" ? ["tsx", entry] : [entry];

    const logsDir = path.join(dataDir, "logs");
    fs.mkdirSync(logsDir, { recursive: true });
    const out = fs.openSync(path.join(logsDir, "gateway.stdout.log"), "a");
    const err = fs.openSync(path.join(logsDir, "gateway.stderr.log"), "a");

    logger.info?.(`[tdai-manager] Starting gateway for ${characterId} on ${baseUrl} (dataDir=${dataDir})`);
    const child = spawn(command, args, {
      cwd: pkgDir,
      env: gatewayEnv({ dataDir, port, host, llm, extraEnv }),
      detached: true,
      stdio: ["ignore", out, err]
    });
    child.unref?.();

    writeRuntimeFile(dataDir, { port, host, pid: child.pid, startedAt: new Date().toISOString() });

    const ready = await waitForHealth(baseUrl);
    if (!ready) {
      throw new Error(`TDAI gateway for "${characterId}" did not become healthy within ${healthTimeoutMs}ms.`);
    }

    logger.info?.(`[tdai-manager] Gateway for ${characterId} ready at ${baseUrl}`);
    return baseUrl;
  }

  return {
    async getBaseUrl(characterId) {
      const key = String(characterId ?? "default");
      if (!pending.has(key)) {
        const promise = startGateway(key).catch((error) => {
          pending.delete(key);
          throw error;
        });
        pending.set(key, promise);
      }
      return pending.get(key);
    }
  };
}
