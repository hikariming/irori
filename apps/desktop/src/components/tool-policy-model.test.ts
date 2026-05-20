import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildToolPolicySettingsViewModel,
  defaultToolPolicySettings,
  toggleToolPolicyItem
} from "./tool-policy-model.ts";

test("buildToolPolicySettingsViewModel summarizes one global permission policy", () => {
  const viewModel = buildToolPolicySettingsViewModel(defaultToolPolicySettings);

  assert.deepEqual(viewModel.enabledTools.map((tool) => tool.id), [
    "read",
    "grep",
    "find",
    "ls",
    "bash",
    "edit",
    "write",
    "memory.read",
    "memory.write",
    "web.fetch",
    "web.search",
    "browser.view",
    "browser.action"
  ]);
  assert.deepEqual(viewModel.confirmTools.map((tool) => tool.id), ["bash", "edit", "write", "memory.write", "browser.action"]);
  assert.match(viewModel.protectedPathsPreview, /\.env/);
});

test("toggleToolPolicyItem updates global settings without mutating input", () => {
  const next = toggleToolPolicyItem({
    settings: defaultToolPolicySettings,
    group: "customTools",
    toolId: "web.fetch"
  });

  assert.equal(defaultToolPolicySettings.customTools["web.fetch"], true);
  assert.equal(next.customTools["web.fetch"], false);
});
