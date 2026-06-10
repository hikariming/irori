import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import {
  defaultProtectedPaths,
  gateAutonomyModes
} from "../../../../packages/safety/src/runtime.mjs";

// Where the sidecar drops the gate policy so subagent child processes — which
// run in their own pi process and cannot inherit the parent's in-memory closure
// gate — can load the SAME fence via the cockapoo-tool-gate extension.
export const defaultToolGateConfigPath = join(homedir(), ".pi", "cockapoo-tool-gate.json");

// Env var a child process reads to find the config the parent just wrote.
export const toolGateConfigEnvVar = "COCKAPOO_TOOL_GATE_CONFIG";

const gateModes = new Set(gateAutonomyModes);

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const result = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function normalizeMode(value) {
  return typeof value === "string" && gateModes.has(value) ? value : "confirm";
}

// Turn a runtime gatePolicy + mode into a plain, serializable config object.
export function buildToolGateConfig({ gatePolicy = {}, mode } = {}) {
  const protectedPaths = normalizeStringList(gatePolicy.protectedPaths);

  return {
    mode: normalizeMode(mode),
    gatePolicy: {
      allowedToolNames: normalizeStringList(gatePolicy.allowedToolNames),
      confirmToolNames: normalizeStringList(gatePolicy.confirmToolNames),
      protectedPaths: protectedPaths.length > 0 ? protectedPaths : [...defaultProtectedPaths]
    }
  };
}

// Fail-closed default: an empty allowlist makes evaluateToolCall block every
// tool, so a missing/corrupt config never silently opens the fence.
function failClosedConfig() {
  return {
    mode: "confirm",
    gatePolicy: {
      allowedToolNames: [],
      confirmToolNames: [],
      protectedPaths: [...defaultProtectedPaths]
    }
  };
}

function parseConfig(raw) {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return failClosedConfig();
  }
  return buildToolGateConfig({ gatePolicy: parsed.gatePolicy ?? {}, mode: parsed.mode });
}

// Synchronous read so a path-loaded extension can resolve the fence at startup
// without an async factory. Any read/parse failure falls back to fail-closed.
export function readToolGateConfigSync(configPath = defaultToolGateConfigPath) {
  try {
    if (!existsSync(configPath)) {
      return failClosedConfig();
    }
    return parseConfig(readFileSync(configPath, "utf-8"));
  } catch {
    return failClosedConfig();
  }
}

async function readExistingConfig(path) {
  if (!existsSync(path)) {
    return {};
  }

  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    // 损坏的旧配置不该让之后的每次对话都失败；当作空配置，下面的原子写覆盖自愈。
    return {};
  }
}

// Persist the gate config, preserving any unknown keys already in the file
// (mirrors writePiWebAccessConfig so co-located tooling keys survive).
export async function writeToolGateConfig({
  gatePolicy,
  mode,
  configPath = defaultToolGateConfigPath
} = {}) {
  const existing = await readExistingConfig(configPath);
  const next = {
    ...existing,
    ...buildToolGateConfig({ gatePolicy, mode })
  };

  await mkdir(dirname(configPath), { recursive: true });
  // Atomic write (temp + rename) so a child reading the fence mid-write can
  // never see a half-written file (it would fail closed and block every tool).
  const tmp = `${configPath}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`);
  await rename(tmp, configPath);

  return next;
}
