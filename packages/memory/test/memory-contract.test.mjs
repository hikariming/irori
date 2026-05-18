import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultMemoryConfig, memoryKindLabels } from "../src/index.ts";

test("memory package exposes default config and stable labels", () => {
  assert.equal(defaultMemoryConfig.recall.maxResults, 5);
  assert.equal(defaultMemoryConfig.offload.enabled, false);
  assert.equal(memoryKindLabels.preference, "偏好");
  assert.equal(memoryKindLabels.relationship_note, "关系互动");
});
