import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultProtectedPaths } from "../../../../packages/safety/src/runtime.mjs";
import { createToolPolicyGateExtension } from "../src/tool-policy-gate.mjs";

const gatePolicy = {
  allowedToolNames: ["read", "bash", "edit", "write", "memory_read", "memory_write"],
  confirmToolNames: ["bash", "edit", "write", "memory_write"],
  protectedPaths: defaultProtectedPaths
};

function captureHandler(factory) {
  let handler;
  const pi = {
    on(eventName, fn) {
      if (eventName === "tool_call") {
        handler = fn;
      }
    }
  };
  factory(pi);
  if (!handler) {
    throw new Error("extension did not register a tool_call handler");
  }
  return handler;
}

test("allows read-only calls and reports them", async () => {
  const events = [];
  const handler = captureHandler(createToolPolicyGateExtension({
    gatePolicy,
    onToolEvent: (event) => events.push(event)
  }));

  const result = await handler({ toolName: "read", input: { path: "src/app.ts" } });

  assert.equal(result, undefined);
  assert.equal(events[0].status, "allowed");
});

test("blocks protected-path writes with a reason", async () => {
  const handler = captureHandler(createToolPolicyGateExtension({ gatePolicy }));
  const result = await handler({ toolName: "edit", input: { path: ".env" } });

  assert.equal(result.block, true);
  assert.match(result.reason, /受保护路径/);
});

test("confirm decisions block by default when no confirm channel exists", async () => {
  const events = [];
  const handler = captureHandler(createToolPolicyGateExtension({
    gatePolicy,
    onToolEvent: (event) => events.push(event)
  }));

  const result = await handler({ toolName: "edit", input: { path: "src/app.ts" } });

  assert.equal(result.block, true);
  assert.equal(events.at(-1).status, "needs_confirmation");
});

test("confirm decisions route to onConfirm and honour approval", async () => {
  const approveHandler = captureHandler(createToolPolicyGateExtension({
    gatePolicy,
    onConfirm: async () => true
  }));
  assert.equal(await approveHandler({ toolName: "edit", input: { path: "src/app.ts" } }), undefined);

  const rejectHandler = captureHandler(createToolPolicyGateExtension({
    gatePolicy,
    onConfirm: async () => false
  }));
  const rejected = await rejectHandler({ toolName: "edit", input: { path: "src/app.ts" } });
  assert.equal(rejected.block, true);
});

test("confirmFallback allow lets confirm decisions through", async () => {
  const handler = captureHandler(createToolPolicyGateExtension({
    gatePolicy,
    confirmFallback: "allow"
  }));

  assert.equal(await handler({ toolName: "edit", input: { path: "src/app.ts" } }), undefined);
});

test("managed mode auto-runs non-dangerous bash but still blocks rm -rf", async () => {
  const handler = captureHandler(createToolPolicyGateExtension({ gatePolicy, mode: "managed" }));

  assert.equal(await handler({ toolName: "bash", input: { command: "npm test" } }), undefined);
  const dangerous = await handler({ toolName: "bash", input: { command: "rm -rf /" } });
  assert.equal(dangerous.block, true);
});
