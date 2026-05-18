import assert from "node:assert/strict";
import { test } from "node:test";

import { buildSettingsTabs } from "./settings-model.ts";

test("buildSettingsTabs puts model providers first", () => {
  const tabs = buildSettingsTabs();

  assert.equal(tabs[0]?.id, "model-provider");
  assert.match(tabs[0]?.description ?? "", /OpenAI 兼容接口/);
});
