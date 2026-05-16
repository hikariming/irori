import assert from "node:assert/strict";
import { test } from "node:test";

import { getActiveCharacter } from "./sidebar-model.ts";

test("getActiveCharacter returns the selected character", () => {
  const active = getActiveCharacter([
    { id: "a", name: "A", status: "idle", tone: "quiet", active: false },
    { id: "b", name: "B", status: "online", tone: "warm", active: true }
  ]);

  assert.equal(active?.id, "b");
});
