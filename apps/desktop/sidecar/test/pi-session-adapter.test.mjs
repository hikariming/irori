import assert from "node:assert/strict";
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
