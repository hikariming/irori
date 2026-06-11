import assert from "node:assert/strict";
import { test } from "node:test";

import { buildSettingsTabs } from "./settings-model.ts";
import {
  defaultAdvancedSettings,
  sanitizeAdvancedSettings
} from "./advanced-settings-model.ts";

// 文案已抽到 i18n（settings:tabs.<id>.*），这里只校验 id 与顺序。
test("buildSettingsTabs puts model access first", () => {
  const tabs = buildSettingsTabs();

  assert.equal(tabs[0]?.id, "model-provider");
});

test("buildSettingsTabs includes web access before safety permissions", () => {
  const tabs = buildSettingsTabs();
  const webAccessIndex = tabs.findIndex((tab) => tab.id === "web-access");
  const safetyIndex = tabs.findIndex((tab) => tab.id === "safety");

  assert.ok(webAccessIndex > 0);
  assert.ok(safetyIndex > webAccessIndex);
});

test("buildSettingsTabs ends with the advanced capability tab", () => {
  const tabs = buildSettingsTabs();
  const advanced = tabs.find((tab) => tab.id === "advanced");

  assert.ok(advanced);
  assert.equal(tabs[tabs.length - 1]?.id, "advanced");
});

test("sanitizeAdvancedSettings defaults subagents off and coerces non-boolean input", () => {
  assert.deepEqual(sanitizeAdvancedSettings(undefined), defaultAdvancedSettings);
  assert.equal(defaultAdvancedSettings.enableSubagents, false);
  assert.equal(sanitizeAdvancedSettings({ enableSubagents: "yes" }).enableSubagents, false);
  assert.equal(sanitizeAdvancedSettings({ enableSubagents: true }).enableSubagents, true);
});
