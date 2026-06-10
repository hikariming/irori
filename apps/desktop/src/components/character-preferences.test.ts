import assert from "node:assert/strict";
import { test } from "node:test";

import {
  defaultCharacterPreference,
  getCharacterPreference,
  isCharacterVisibleInSidebar,
  sanitizeCharacterPreferences,
  setCharacterPreference
} from "./character-preferences.ts";

test("getCharacterPreference falls back to defaults for unknown characters", () => {
  assert.deepEqual(getCharacterPreference({}, "shili"), defaultCharacterPreference);
});

test("setCharacterPreference merges a patch without touching other characters", () => {
  const next = setCharacterPreference({ lulin: { enabled: true, showInSidebar: true } }, "shili", {
    showInSidebar: false
  });

  assert.deepEqual(next.shili, { enabled: true, showInSidebar: false });
  assert.deepEqual(next.lulin, { enabled: true, showInSidebar: true });
});

test("disabling keeps showInSidebar so re-enabling restores the prior choice", () => {
  const disabled = setCharacterPreference({}, "shili", { enabled: false });
  assert.deepEqual(disabled.shili, { enabled: false, showInSidebar: true });
  assert.equal(isCharacterVisibleInSidebar(disabled, "shili"), false);

  const reenabled = setCharacterPreference(disabled, "shili", { enabled: true });
  assert.equal(isCharacterVisibleInSidebar(reenabled, "shili"), true);
});

test("isCharacterVisibleInSidebar requires enabled and showInSidebar", () => {
  assert.equal(isCharacterVisibleInSidebar({}, "shili"), true);
  assert.equal(
    isCharacterVisibleInSidebar({ shili: { enabled: true, showInSidebar: false } }, "shili"),
    false
  );
  assert.equal(
    isCharacterVisibleInSidebar({ shili: { enabled: false, showInSidebar: true } }, "shili"),
    false
  );
});

test("sanitizeCharacterPreferences drops malformed entries and coerces missing fields", () => {
  const result = sanitizeCharacterPreferences({
    shili: { enabled: false, showInSidebar: true },
    lulin: { enabled: "yes" },
    broken: 42
  });

  assert.deepEqual(result.shili, { enabled: false, showInSidebar: true });
  assert.deepEqual(result.lulin, { enabled: true, showInSidebar: true });
  assert.equal("broken" in result, false);
});
