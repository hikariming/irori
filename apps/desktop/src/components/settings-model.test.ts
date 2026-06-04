import assert from "node:assert/strict";
import { test } from "node:test";

import { buildSettingsTabs } from "./settings-model.ts";
import {
  defaultAdvancedSettings,
  sanitizeAdvancedSettings
} from "./advanced-settings-model.ts";

test("buildSettingsTabs puts model access first", () => {
  const tabs = buildSettingsTabs();

  assert.equal(tabs[0]?.id, "model-provider");
  assert.equal(tabs[0]?.label, "模型接入");
  assert.match(tabs[0]?.description ?? "", /多模型配置/);
});

test("buildSettingsTabs includes web access before safety permissions", () => {
  const tabs = buildSettingsTabs();
  const webAccessIndex = tabs.findIndex((tab) => tab.id === "web-access");
  const safetyIndex = tabs.findIndex((tab) => tab.id === "safety");

  assert.ok(webAccessIndex > 0);
  assert.ok(safetyIndex > webAccessIndex);
  assert.equal(tabs[webAccessIndex]?.label, "联网");
  assert.match(tabs[webAccessIndex]?.description ?? "", /Exa|Perplexity|Gemini/);
});

test("buildSettingsTabs ends with the advanced capability tab", () => {
  const tabs = buildSettingsTabs();
  const advanced = tabs.find((tab) => tab.id === "advanced");

  assert.ok(advanced);
  assert.equal(advanced?.label, "高级");
  assert.match(advanced?.description ?? "", /子代理|Agent/);
});

test("sanitizeAdvancedSettings defaults subagents off and coerces non-boolean input", () => {
  assert.deepEqual(sanitizeAdvancedSettings(undefined), defaultAdvancedSettings);
  assert.equal(defaultAdvancedSettings.enableSubagents, false);
  assert.equal(sanitizeAdvancedSettings({ enableSubagents: "yes" }).enableSubagents, false);
  assert.equal(sanitizeAdvancedSettings({ enableSubagents: true }).enableSubagents, true);
});
