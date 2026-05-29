import assert from "node:assert/strict";
import { test } from "node:test";

test("local-agent runtime modules load without requiring Node to import TypeScript source", async () => {
  const modules = await Promise.all([
    import("../src/configured-memory-backend.mjs"),
    import("../src/memory-bridge.mjs"),
    import("../src/tool-policy-runtime.mjs")
  ]);

  assert.equal(typeof modules[0].resolveConfiguredMemoryBackend, "function");
  assert.equal(typeof modules[1].buildPromptWithMemory, "function");
  assert.equal(typeof modules[2].buildToolRuntime, "function");
});
