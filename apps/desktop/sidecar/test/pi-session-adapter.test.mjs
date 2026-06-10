import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir, readdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createAgentSession } from "@earendil-works/pi-coding-agent";

import * as piSessionAdapter from "../src/pi-session-adapter.mjs";
import {
  applyOpenAiCompatibleProviderRequestOverrides,
  buildPiSessionOptions
} from "../src/pi-session-adapter.mjs";
import { defaultOpenAiCompatibleSettings } from "../src/model-provider-resolver.mjs";

test("Pi SDK is available to the local agent", () => {
  assert.equal(typeof createAgentSession, "function");
});

test("buildPiSessionOptions wires auth, registry, session manager, cwd and selected model", () => {
  const options = buildPiSessionOptions({
    cwd: "/tmp/cockapoo-workspace",
    modelSettings: defaultOpenAiCompatibleSettings,
    authPath: "/tmp/cockapoo-auth/auth.json",
    runtimeToken: "sk-test"
  });

  assert.equal(options.cwd, "/tmp/cockapoo-workspace");
  assert.equal(options.model.provider, "openai-compatible");
  assert.equal(options.model.id, "gpt-5.5");
  assert.ok(options.authStorage);
  assert.ok(options.modelRegistry);
  assert.ok(options.sessionManager);
});

test("buildPiSessionOptions passes resolved tool allowlist and custom tool definitions to Pi", () => {
  const customTools = [
    {
      name: "memory_read",
      label: "Memory Read",
      description: "Read Cockapoo memory",
      parameters: {},
      execute: async () => ({ content: [{ type: "text", text: "" }] })
    }
  ];
  const options = buildPiSessionOptions({
    cwd: "/tmp/cockapoo-workspace",
    modelSettings: defaultOpenAiCompatibleSettings,
    authPath: "/tmp/cockapoo-auth/auth.json",
    runtimeToken: "sk-test",
    tools: ["read", "grep", "memory_read"],
    customTools
  });

  assert.deepEqual(options.tools, ["read", "grep", "memory_read"]);
  assert.equal(options.customTools, customTools);
});

test("resolvePiWebAccessPackageRoot locates the bundled pi-web-access package", () => {
  assert.equal(typeof piSessionAdapter.resolvePiWebAccessPackageRoot, "function");

  const packageRoot = piSessionAdapter.resolvePiWebAccessPackageRoot();

  assert.match(packageRoot, /pi-web-access/);
});

test("buildPiResourceLoaderOptions loads pi-web-access as a local extension package", () => {
  assert.equal(typeof piSessionAdapter.buildPiResourceLoaderOptions, "function");

  const options = piSessionAdapter.buildPiResourceLoaderOptions({
    cwd: "/tmp/cockapoo-workspace",
    agentDir: "/tmp/pi-agent",
    extensionFactories: ["provider-override", "tool-gate"],
    webAccessPackageRoot: "/tmp/pi-web-access"
  });

  assert.deepEqual(options.additionalExtensionPaths, ["/tmp/pi-web-access"]);
  assert.deepEqual(options.extensionFactories, ["provider-override", "tool-gate"]);
});

test("resolvePiSubagentsPackageRoot locates the bundled pi-subagents package", () => {
  assert.equal(typeof piSessionAdapter.resolvePiSubagentsPackageRoot, "function");

  const packageRoot = piSessionAdapter.resolvePiSubagentsPackageRoot();

  assert.match(packageRoot, /pi-subagents/);
});

test("resolveCockapooToolGatePackageRoot points at the local gate extension package", () => {
  assert.equal(typeof piSessionAdapter.resolveCockapooToolGatePackageRoot, "function");

  const packageRoot = piSessionAdapter.resolveCockapooToolGatePackageRoot();

  assert.match(packageRoot, /extensions\/cockapoo-tool-gate$/);
});

test("buildPiResourceLoaderOptions appends opt-in subagent package roots after web access", () => {
  const options = piSessionAdapter.buildPiResourceLoaderOptions({
    cwd: "/tmp/cockapoo-workspace",
    agentDir: "/tmp/pi-agent",
    extensionFactories: [],
    webAccessPackageRoot: "/tmp/pi-web-access",
    additionalPackageRoots: ["/tmp/pi-subagents"]
  });

  assert.deepEqual(options.additionalExtensionPaths, ["/tmp/pi-web-access", "/tmp/pi-subagents"]);
});

test("buildPiResourceLoaderOptions drops a missing web access root but keeps additional roots", () => {
  const options = piSessionAdapter.buildPiResourceLoaderOptions({
    cwd: "/tmp/cockapoo-workspace",
    agentDir: "/tmp/pi-agent",
    extensionFactories: [],
    webAccessPackageRoot: "",
    additionalPackageRoots: ["/tmp/pi-subagents"]
  });

  assert.deepEqual(options.additionalExtensionPaths, ["/tmp/pi-subagents"]);
});

test("buildPiResourceLoaderOptions exposes the skills root when a path is given", () => {
  const withRoot = piSessionAdapter.buildPiResourceLoaderOptions({
    cwd: "/tmp/cockapoo-workspace",
    agentDir: "/tmp/pi-agent",
    extensionFactories: [],
    webAccessPackageRoot: "/tmp/pi-web-access",
    skillsRootPath: "/tmp/skills",
    allowedSkillNames: ["tarot-reading"]
  });
  assert.deepEqual(withRoot.additionalSkillPaths, ["/tmp/skills"]);

  const withoutRoot = piSessionAdapter.buildPiResourceLoaderOptions({
    cwd: "/tmp/cockapoo-workspace",
    agentDir: "/tmp/pi-agent",
    extensionFactories: [],
    webAccessPackageRoot: "/tmp/pi-web-access"
  });
  assert.deepEqual(withoutRoot.additionalSkillPaths, []);
});

test("skillsOverride whitelists only the character's assigned skills", () => {
  const base = {
    skills: [
      { name: "tarot-reading" },
      { name: "weather-lookup" },
      { name: "secret-admin" }
    ],
    diagnostics: ["keep-me"]
  };

  const allowed = piSessionAdapter.buildPiResourceLoaderOptions({
    cwd: "/tmp/cockapoo-workspace",
    agentDir: "/tmp/pi-agent",
    extensionFactories: [],
    webAccessPackageRoot: "/tmp/pi-web-access",
    skillsRootPath: "/tmp/skills",
    allowedSkillNames: ["tarot-reading", "weather-lookup"]
  }).skillsOverride(base);

  assert.deepEqual(
    allowed.skills.map((skill) => skill.name),
    ["tarot-reading", "weather-lookup"]
  );
  // diagnostics pass through untouched.
  assert.deepEqual(allowed.diagnostics, ["keep-me"]);
});

test("skillsOverride hides every skill when the character has none assigned", () => {
  const base = { skills: [{ name: "tarot-reading" }], diagnostics: [] };

  for (const allowedSkillNames of [undefined, [], null]) {
    const filtered = piSessionAdapter.buildPiResourceLoaderOptions({
      cwd: "/tmp/cockapoo-workspace",
      agentDir: "/tmp/pi-agent",
      extensionFactories: [],
      webAccessPackageRoot: "/tmp/pi-web-access",
      skillsRootPath: "/tmp/skills",
      allowedSkillNames
    }).skillsOverride(base);

    assert.deepEqual(filtered.skills, []);
  }
});

test("resolveBundledPiBinDir finds a dir that actually contains a pi executable", () => {
  // The pi CLI ships in the (pnpm) store; we should locate its bin dir.
  const binDir = piSessionAdapter.resolveBundledPiBinDir();
  assert.ok(binDir, "expected to resolve a bundled pi bin dir");
  assert.match(binDir, /\.bin$/);
});

test("ensureBundledPiOnPath idempotently prepends the bin dir", () => {
  const env = { PATH: "/usr/bin" };
  const added = piSessionAdapter.ensureBundledPiOnPath({ env, resolveBinDir: () => "/fake/.bin" });

  assert.equal(added, true);
  assert.equal(env.PATH, `/fake/.bin:/usr/bin`);

  // Second call must not duplicate the entry.
  piSessionAdapter.ensureBundledPiOnPath({ env, resolveBinDir: () => "/fake/.bin" });
  assert.equal(env.PATH, `/fake/.bin:/usr/bin`);
});

test("ensureBundledPiOnPath is a no-op when no bin dir is found", () => {
  const env = { PATH: "/usr/bin" };
  const added = piSessionAdapter.ensureBundledPiOnPath({ env, resolveBinDir: () => undefined });

  assert.equal(added, false);
  assert.equal(env.PATH, "/usr/bin");
});

test("resolveSubagentAgentDir defaults to an app-owned dir, never the user's ~/.pi/agent", () => {
  const dir = piSessionAdapter.resolveSubagentAgentDir({ env: {} });

  assert.equal(dir, join(homedir(), ".cockapoo", "pi-agent"));
  assert.doesNotMatch(dir, /\.pi\/agent/);
});

test("resolveSubagentAgentDir honors the COCKAPOO_SUBAGENT_AGENT_DIR override", () => {
  const dir = piSessionAdapter.resolveSubagentAgentDir({
    env: { COCKAPOO_SUBAGENT_AGENT_DIR: "/custom/agent-dir" }
  });

  assert.equal(dir, "/custom/agent-dir");
});

test("configureSubagentBridge materializes the models.json bridge in the app-owned dir and points children at it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cockapoo-subagent-bridge-"));
  const subagentsRoot = join(dir, "pi-subagents");
  const agentDir = join(dir, "cockapoo-agent");
  await mkdir(join(subagentsRoot, "agents"), { recursive: true });
  await writeFile(join(subagentsRoot, "agents", "worker.md"), "---\nname: worker\n---\nWorker body.\n");
  const env = {};

  try {
    const written = piSessionAdapter.configureSubagentBridge({
      modelSettings: { baseUrl: "https://my-llm.internal/v1", modelName: "house-model" },
      runtimeToken: "sk-secret",
      subagentsRoot,
      gateExtensionRoot: "/abs/cockapoo-tool-gate",
      env,
      agentDir
    });

    assert.equal(written, agentDir);
    // 子进程与 pi-subagents 的 agent 发现都跟随这个 env 指针。
    assert.equal(env.PI_CODING_AGENT_DIR, agentDir);
    // 通用桥：key 经 env 传递，磁盘上只有 env 变量名。
    assert.equal(env.COCKAPOO_SUBAGENT_API_KEY, "sk-secret");
    const models = JSON.parse(await readFile(join(agentDir, "models.json"), "utf-8"));
    assert.equal(models.providers["openai-compatible"].baseUrl, "https://my-llm.internal/v1");
    const worker = await readFile(join(agentDir, "agents", "worker.md"), "utf-8");
    assert.match(worker, /model: openai-compatible\/house-model/);
    assert.match(worker, /extensions: \/abs\/cockapoo-tool-gate/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("configureSubagentBridge native fast path passes the key via the provider env var and drops a stale bridge", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cockapoo-subagent-native-"));
  const subagentsRoot = join(dir, "pi-subagents");
  const agentDir = join(dir, "cockapoo-agent");
  await mkdir(join(subagentsRoot, "agents"), { recursive: true });
  await writeFile(join(subagentsRoot, "agents", "worker.md"), "---\nname: worker\n---\nWorker body.\n");
  await mkdir(agentDir, { recursive: true });
  // 上一次非 native 会话遗留的 models.json 桥必须被清掉。
  await writeFile(join(agentDir, "models.json"), "{}");
  const env = {};

  try {
    piSessionAdapter.configureSubagentBridge({
      modelSettings: { baseUrl: "https://api.deepseek.com/v1", modelName: "deepseek-v4-pro" },
      runtimeToken: "sk-secret",
      subagentsRoot,
      env,
      agentDir
    });

    assert.equal(env.PI_CODING_AGENT_DIR, agentDir);
    assert.equal(env.DEEPSEEK_API_KEY, "sk-secret");
    assert.equal(env.COCKAPOO_SUBAGENT_API_KEY, undefined);
    assert.deepEqual((await readdir(agentDir)).filter((name) => name === "models.json"), []);
    const worker = await readFile(join(agentDir, "agents", "worker.md"), "utf-8");
    assert.match(worker, /model: deepseek\/deepseek-v4-pro/);
    // 没有围栏时不强行给子代理 pin 扩展。
    assert.doesNotMatch(worker, /extensions:/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("applyOpenAiCompatibleProviderRequestOverrides enables preserved thinking for Kimi requests", () => {
  const payload = applyOpenAiCompatibleProviderRequestOverrides(
    {
      model: "kimi-k2.6",
      messages: [],
      stream: true
    },
    {
      baseUrl: "https://api.moonshot.cn/v1",
      modelName: "kimi-k2.6"
    }
  );

  assert.deepEqual(payload.thinking, {
    type: "enabled",
    keep: "all"
  });
});

test("applyOpenAiCompatibleProviderRequestOverrides leaves non-Kimi requests unchanged", () => {
  const originalPayload = {
    model: "deepseek-chat",
    messages: [],
    stream: true
  };
  const payload = applyOpenAiCompatibleProviderRequestOverrides(originalPayload, {
    baseUrl: "https://api.deepseek.com",
    modelName: "deepseek-chat"
  });

  assert.equal(payload, originalPayload);
});
