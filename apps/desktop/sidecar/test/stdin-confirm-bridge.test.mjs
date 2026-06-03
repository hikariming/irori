import assert from "node:assert/strict";
import { test } from "node:test";

import { createStdinConfirmBridge } from "../src/stdin-confirm-bridge.mjs";

test("requestConfirm emits a confirm_request and resolves on the matching response", async () => {
  const written = [];
  const bridge = createStdinConfirmBridge({ runId: "run-1", write: (message) => written.push(message) });

  const pending = bridge.requestConfirm({ toolName: "edit", input: { path: "src/app.ts" }, reason: "需要确认" });

  assert.equal(written.length, 1);
  assert.equal(written[0].type, "confirm_request");
  assert.equal(written[0].runId, "run-1");
  assert.equal(written[0].tool.name, "edit");
  assert.equal(written[0].tool.target, "src/app.ts");

  bridge.handleLine(JSON.stringify({ type: "confirm_response", confirmId: written[0].confirmId, approved: true }));

  assert.equal(await pending, true);
});

test("a rejected response resolves false", async () => {
  const written = [];
  const bridge = createStdinConfirmBridge({ runId: "run-1", write: (message) => written.push(message) });

  const pending = bridge.requestConfirm({ toolName: "bash", input: { command: "rm -rf build" } });
  bridge.handleLine(JSON.stringify({ type: "confirm_response", confirmId: written[0].confirmId, approved: false }));

  assert.equal(await pending, false);
  assert.equal(written[0].tool.target, "rm -rf build");
});

test("handleLine ignores noise and unmatched confirm ids", async () => {
  const written = [];
  const bridge = createStdinConfirmBridge({ runId: "run-1", write: (message) => written.push(message) });

  const pending = bridge.requestConfirm({ toolName: "edit", input: { path: "src/app.ts" } });

  bridge.handleLine("not json");
  bridge.handleLine(JSON.stringify({ type: "progress" }));
  bridge.handleLine(JSON.stringify({ type: "confirm_response", confirmId: "other", approved: true }));

  let settled = false;
  pending.then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);

  bridge.handleLine(JSON.stringify({ type: "confirm_response", confirmId: written[0].confirmId, approved: true }));
  assert.equal(await pending, true);
});
