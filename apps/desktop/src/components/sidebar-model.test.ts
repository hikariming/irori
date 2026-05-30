import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { parseCharacterCard, type CharacterCard } from "./character-cards.ts";
import { activateCharacter, buildSidebarCharacters, getActiveCharacter } from "./sidebar-model.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadFixtureCard(characterId: string): Promise<CharacterCard> {
  const path = resolve(
    __dirname,
    `../../public/characters/${characterId}.card/card.json`
  );
  const raw = JSON.parse(await readFile(path, "utf8"));
  return parseCharacterCard(characterId, raw);
}

const cards = await Promise.all(
  ["shili", "lulin", "shenyanzhou"].map((id) => loadFixtureCard(id))
);

test("getActiveCharacter returns the selected character", () => {
  const active = getActiveCharacter([
    { id: "a", name: "A", status: "idle", tone: "quiet", active: false },
    { id: "b", name: "B", status: "online", tone: "warm", active: true }
  ]);

  assert.equal(active?.id, "b");
});

test("buildSidebarCharacters projects cards and marks the active one", () => {
  const items = buildSidebarCharacters(cards, "lulin");

  assert.deepEqual(
    items.map((item) => item.id),
    ["shili", "lulin", "shenyanzhou"]
  );
  assert.equal(getActiveCharacter(items)?.id, "lulin");
  assert.equal(items.find((item) => item.id === "shili")?.active, false);
});

test("buildSidebarCharacters maps name, tagline, and avatar from the card", () => {
  const items = buildSidebarCharacters(cards, "shili");
  const lulin = items.find((item) => item.id === "lulin");

  assert.equal(lulin?.name, "陆临");
  assert.equal(lulin?.tone, cards[1].tagline);
  assert.equal(lulin?.avatarSrc, "/characters/lulin.card/assets/avatar/avatar-circle.png");
});

test("activateCharacter marks the requested character as active", () => {
  const items = buildSidebarCharacters(cards, "shili");
  const next = activateCharacter(items, "lulin");

  assert.equal(getActiveCharacter(next)?.id, "lulin");
  assert.equal(next.find((item) => item.id === "shili")?.active, false);
});
