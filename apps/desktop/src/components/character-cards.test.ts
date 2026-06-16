import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildCharacterChatPreview,
  characterPromptName,
  localizeCharacterCard,
  parseCharacterCard,
  type CharacterCard
} from "./character-cards.ts";
import { requiredStickerIds } from "./chat-model.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadFixtureCard(characterId: string): Promise<CharacterCard> {
  const path = resolve(
    __dirname,
    `../../public/characters/${characterId}.card/card.json`
  );
  const raw = JSON.parse(await readFile(path, "utf8"));
  return parseCharacterCard(characterId, raw);
}

test("parseCharacterCard maps identity and resolves asset paths", async () => {
  const card = await loadFixtureCard("shili");

  assert.equal(card.id, "shili");
  assert.equal(card.name, "示璃");
  assert.equal(card.sourceName, "示璃");
  assert.equal(card.localizedNames.en, "Shili");
  assert.equal(card.assets.avatar, "/characters/shili.card/assets/avatar/avatar-circle.png");
  assert.equal(card.assets.portrait, "/characters/shili.card/assets/portraits/neutral.png");
  assert.equal(card.assets.background, "/characters/shili.card/assets/backgrounds/default.png");
});

test("localizeCharacterCard uses localized names without changing the prompt name", async () => {
  const card = await loadFixtureCard("shili");
  const localized = localizeCharacterCard(card, "en-US");

  assert.equal(localized.name, "Shili");
  assert.equal(localized.sourceName, "示璃");
  assert.equal(characterPromptName(localized), "示璃");
});

test("parseCharacterCard exposes the required nine stickers in order", async () => {
  const card = await loadFixtureCard("shili");

  assert.deepEqual(
    card.stickers.map((sticker) => sticker.id),
    requiredStickerIds
  );
  assert.equal(card.stickers[0].src, "/characters/shili.card/assets/stickers/neutral.png");
});

test("buildCharacterChatPreview projects a card into chat preview shape", async () => {
  const card = await loadFixtureCard("lulin");
  const preview = buildCharacterChatPreview(card);

  assert.equal(preview.character.id, "lulin");
  assert.equal(preview.character.name, card.name);
  assert.equal(preview.assets.avatar, card.assets.avatar);
  assert.deepEqual(preview.stickers, card.stickers);
  assert.deepEqual(preview.messages, []);
});
