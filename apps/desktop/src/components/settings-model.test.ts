import assert from "node:assert/strict";
import { test } from "node:test";

import { buildSettingsTabs } from "./settings-model.ts";

test("buildSettingsTabs puts model access first", () => {
  const tabs = buildSettingsTabs();

  assert.equal(tabs[0]?.id, "model-provider");
  assert.equal(tabs[0]?.label, "模型接入");
  assert.match(tabs[0]?.description ?? "", /多模型配置/);
});
