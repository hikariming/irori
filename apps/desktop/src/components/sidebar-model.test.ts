import assert from "node:assert/strict";
import { test } from "node:test";

import { activateCharacter, characters, getActiveCharacter } from "./sidebar-model.ts";

test("getActiveCharacter returns the selected character", () => {
  const active = getActiveCharacter([
    { id: "a", name: "A", status: "idle", tone: "quiet", active: false },
    { id: "b", name: "B", status: "online", tone: "warm", active: true }
  ]);

  assert.equal(active?.id, "b");
});

test("activateCharacter marks the requested character as active", () => {
  const nextCharacters = activateCharacter(characters, "lulin");

  assert.equal(getActiveCharacter(nextCharacters)?.id, "lulin");
  assert.equal(nextCharacters.find((character) => character.id === "shili")?.active, false);
});

test("sidebar second mock character uses Lu Lin", () => {
  assert.deepEqual(characters[1], {
    id: "lulin",
    name: "陆临",
    status: "idle",
    tone: "深夜护短",
    active: false,
    avatarSrc: "/characters/lulin.card/assets/avatar/avatar-circle.png"
  });
});

test("sidebar third mock character uses Shen Yanzhou", () => {
  assert.deepEqual(characters[2], {
    id: "shenyanzhou",
    name: "沈砚洲",
    status: "online",
    tone: "犀利反问",
    active: false,
    avatarSrc: "/characters/shenyanzhou.card/assets/avatar/avatar-circle.png"
  });
});
