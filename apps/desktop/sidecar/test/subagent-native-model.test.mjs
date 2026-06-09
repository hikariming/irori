import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { readdir } from "node:fs/promises";

import {
  buildSubagentModelsConfig,
  clearSubagentModelOverrides,
  clearSubagentModelsJson,
  injectAgentFrontmatter,
  injectAgentModel,
  materializeSubagentModelOverrides,
  materializeSubagentModelsJson,
  resolveNativePiProvider,
  subagentApiKeyEnvVar,
  subagentBridgeModelRef
} from "../src/subagent-native-model.mjs";

test("default OpenAI + self-hosted endpoints are not native (handled by the models.json bridge)", () => {
  // These intentionally fall through to the universal models.json bridge, which
  // mirrors the parent's exact openai-compatible request — so they must NOT be
  // claimed by the conservative native fast-path map.
  assert.equal(resolveNativePiProvider({ baseUrl: "https://api.openai.com/v1", modelName: "gpt-5" }), null);
  assert.equal(resolveNativePiProvider({ baseUrl: "https://my-llm.internal/v1", modelName: "x" }), null);
});

test("buildSubagentModelsConfig registers a custom provider with the key as an env-var NAME, not the secret", () => {
  const config = buildSubagentModelsConfig({
    settings: { baseUrl: "https://my-llm.internal/v1", modelName: "house-model" }
  });
  const provider = config.providers["openai-compatible"];

  assert.equal(provider.baseUrl, "https://my-llm.internal/v1");
  assert.equal(provider.api, "openai-completions");
  // Key must be the env var NAME (resolved from env at request time), never inlined.
  assert.equal(provider.apiKey, subagentApiKeyEnvVar);
  assert.equal(provider.models[0].id, "house-model");
  assert.equal(provider.models[0].provider, undefined); // provider is the JSON key

  // The serialized config must not contain a real-looking secret.
  assert.doesNotMatch(JSON.stringify(config), /sk-|secret|bearer/i);
});

test("subagentBridgeModelRef pins to the custom provider + model id", () => {
  assert.equal(
    subagentBridgeModelRef({ baseUrl: "https://my-llm.internal/v1", modelName: "house-model" }),
    "openai-compatible/house-model"
  );
});

test("materializeSubagentModelsJson writes models.json atomically; clear removes it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cockapoo-modelsjson-"));
  const agentDir = join(dir, "agentdir");
  try {
    const target = materializeSubagentModelsJson({
      agentDir,
      settings: { baseUrl: "https://my-llm.internal/v1", modelName: "house-model" }
    });
    assert.equal(target, join(agentDir, "models.json"));

    const written = JSON.parse(await readFile(target, "utf-8"));
    assert.equal(written.providers["openai-compatible"].baseUrl, "https://my-llm.internal/v1");
    assert.equal(written.providers["openai-compatible"].apiKey, subagentApiKeyEnvVar);

    // No temp file left behind by the atomic write.
    assert.deepEqual((await readdir(agentDir)).filter((name) => name.endsWith(".tmp")), []);

    assert.equal(clearSubagentModelsJson({ agentDir }), true);
    assert.deepEqual((await readdir(agentDir)).filter((name) => name === "models.json"), []);
    // Idempotent: clearing when absent must not throw.
    assert.equal(clearSubagentModelsJson({ agentDir }), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolveNativePiProvider maps a DeepSeek base URL to the native provider + env var", () => {
  const native = resolveNativePiProvider({ baseUrl: "https://api.deepseek.com/v1", modelName: "deepseek-v4-pro" });

  assert.equal(native.providerId, "deepseek");
  assert.equal(native.envVar, "DEEPSEEK_API_KEY");
  assert.equal(native.modelId, "deepseek-v4-pro");
  assert.equal(native.modelRef, "deepseek/deepseek-v4-pro");
});

test("resolveNativePiProvider returns null for an unknown openai-compatible endpoint", () => {
  assert.equal(resolveNativePiProvider({ baseUrl: "https://my-private-llm.internal/v1", modelName: "x" }), null);
});

test("injectAgentModel adds a model field to frontmatter that lacks one", () => {
  const md = "---\nname: worker\nthinking: high\n---\nBody text.\n";
  const out = injectAgentModel(md, "deepseek/deepseek-v4-pro");

  assert.match(out, /^---\nname: worker\nthinking: high\nmodel: deepseek\/deepseek-v4-pro\n---\n/);
  assert.match(out, /Body text\./);
});

test("injectAgentModel replaces an existing model field", () => {
  const md = "---\nname: worker\nmodel: old/model\n---\nBody.\n";
  const out = injectAgentModel(md, "deepseek/deepseek-v4-pro");

  assert.match(out, /model: deepseek\/deepseek-v4-pro/);
  assert.doesNotMatch(out, /old\/model/);
});

test("injectAgentModel leaves content without frontmatter untouched", () => {
  const md = "no frontmatter here";
  assert.equal(injectAgentModel(md, "deepseek/x"), md);
});

test("injectAgentFrontmatter sets multiple fields, adding or replacing", () => {
  const md = "---\nname: worker\nmodel: old/model\n---\nBody.\n";
  const out = injectAgentFrontmatter(md, { model: "deepseek/x", extensions: "/abs/gate" });

  assert.match(out, /model: deepseek\/x/);
  assert.match(out, /extensions: \/abs\/gate/);
  assert.doesNotMatch(out, /old\/model/);
});

test("injectAgentFrontmatter skips empty values", () => {
  const md = "---\nname: worker\n---\nBody.\n";
  const out = injectAgentFrontmatter(md, { model: "deepseek/x", extensions: undefined });

  assert.match(out, /model: deepseek\/x/);
  assert.doesNotMatch(out, /extensions:/);
});

test("materializeSubagentModelOverrides pins both model and gate extension", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cockapoo-agents-ext-"));
  const pkgAgents = join(dir, "pkg-agents");
  const agentDir = join(dir, "agentdir");
  await mkdir(pkgAgents, { recursive: true });
  await writeFile(join(pkgAgents, "worker.md"), "---\nname: worker\ntools: read, write\n---\nWorker body.\n");

  try {
    materializeSubagentModelOverrides({
      packageAgentsDir: pkgAgents,
      agentDir,
      modelRef: "deepseek/deepseek-v4-pro",
      extensions: "/abs/cockapoo-tool-gate",
      agents: ["worker"]
    });

    const worker = await readFile(join(agentDir, "agents", "worker.md"), "utf-8");
    assert.match(worker, /model: deepseek\/deepseek-v4-pro/);
    assert.match(worker, /extensions: \/abs\/cockapoo-tool-gate/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("materializeSubagentModelOverrides writes model-pinned copies into the agent dir", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cockapoo-agents-"));
  const pkgAgents = join(dir, "pkg-agents");
  const agentDir = join(dir, "agentdir");
  await mkdir(pkgAgents, { recursive: true });
  await writeFile(join(pkgAgents, "worker.md"), "---\nname: worker\ntools: read, bash\n---\nWorker body.\n");
  await writeFile(join(pkgAgents, "scout.md"), "---\nname: scout\n---\nScout body.\n");

  try {
    const written = materializeSubagentModelOverrides({
      packageAgentsDir: pkgAgents,
      agentDir,
      modelRef: "deepseek/deepseek-v4-pro",
      agents: ["worker", "scout", "missing-agent"]
    });

    assert.deepEqual(written, ["worker", "scout"]);

    const worker = await readFile(join(agentDir, "agents", "worker.md"), "utf-8");
    assert.match(worker, /model: deepseek\/deepseek-v4-pro/);
    assert.match(worker, /tools: read, bash/);
    assert.match(worker, /Worker body\./);

    // Atomic write must not leave temp files behind.
    const entries = await readdir(join(agentDir, "agents"));
    assert.deepEqual(entries.filter((name) => name.endsWith(".tmp")), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("clearSubagentModelOverrides removes stale pins; safe when none exist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cockapoo-agents-clear-"));
  const pkgAgents = join(dir, "pkg-agents");
  const agentDir = join(dir, "agentdir");
  await mkdir(pkgAgents, { recursive: true });
  await writeFile(join(pkgAgents, "worker.md"), "---\nname: worker\n---\nWorker body.\n");

  try {
    materializeSubagentModelOverrides({
      packageAgentsDir: pkgAgents,
      agentDir,
      modelRef: "deepseek/deepseek-v4-pro",
      agents: ["worker"]
    });
    assert.deepEqual(await readdir(join(agentDir, "agents")), ["worker.md"]);

    const removed = clearSubagentModelOverrides({ agentDir, agents: ["worker"] });
    assert.deepEqual(removed, ["worker"]);
    assert.deepEqual(await readdir(join(agentDir, "agents")), []);

    // Idempotent: clearing again (nothing to remove) must not throw.
    assert.deepEqual(clearSubagentModelOverrides({ agentDir, agents: ["worker"] }), ["worker"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
