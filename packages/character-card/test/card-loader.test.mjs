import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { loadCharacterCardFromDirectory, requiredStickerIds } from "../src/index.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(__dirname, "../../../characters/shili.card");

test("loadCharacterCardFromDirectory loads and validates a full character card", async () => {
  const card = await loadCharacterCardFromDirectory(fixtureDir);

  assert.equal(card.id, "shili");
  assert.equal(card.name, "示璃");
  assert.equal(card.assets.stickers.length, 9);
  assert.deepEqual(
    card.assets.stickers.map((sticker) => sticker.id),
    requiredStickerIds
  );
  assert.equal(card.assets.avatar, "assets/avatar/avatar-circle.png");
  assert.equal(card.assets.portrait, "assets/portraits/neutral.png");
  assert.equal(card.assets.background, "assets/backgrounds/default.png");
});
