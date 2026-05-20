import assert from "node:assert/strict";
import { test } from "node:test";

import { createAgentSession } from "@earendil-works/pi-coding-agent";

import { buildPiSessionOptions } from "../src/pi-session-adapter.mjs";
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
  assert.equal(options.model.id, "gpt-5.2");
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
