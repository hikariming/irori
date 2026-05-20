import assert from "node:assert/strict";
import { test } from "node:test";

import {
  defaultToolPolicySettings,
  resolveToolPolicy
} from "../src/index.ts";

test("default policy enables all planned Pi and Cockapoo tools", () => {
  const policy = resolveToolPolicy({ settings: defaultToolPolicySettings });

  assert.deepEqual(policy.builtinTools, ["read", "grep", "find", "ls", "bash", "edit", "write"]);
  assert.deepEqual(policy.customTools, [
    "memory.read",
    "memory.write",
    "web.fetch",
    "web.search",
    "browser.view",
    "browser.action"
  ]);
});

test("default policy keeps dangerous tools behind confirmation", () => {
  const policy = resolveToolPolicy({ settings: defaultToolPolicySettings });

  assert.deepEqual(policy.alwaysConfirm, ["bash", "edit", "write", "memory.write", "browser.action"]);
});

test("disabled settings remove tools from resolved policy without modes", () => {
  const policy = resolveToolPolicy({
    settings: {
      ...defaultToolPolicySettings,
      customTools: {
        ...defaultToolPolicySettings.customTools,
        "memory.read": false
      },
      confirmTools: {
        ...defaultToolPolicySettings.confirmTools,
        "memory.write": false
      }
    }
  });

  assert.equal(policy.customTools.includes("memory.read"), false);
  assert.equal(policy.alwaysConfirm.includes("memory.write"), false);
});
