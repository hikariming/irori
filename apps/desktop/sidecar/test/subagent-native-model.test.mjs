import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  injectAgentFrontmatter,
  injectAgentModel,
  materializeSubagentModelOverrides,
  resolveNativePiProvider
} from "../src/subagent-native-model.mjs";

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
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
