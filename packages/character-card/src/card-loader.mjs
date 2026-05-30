import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const requiredStickerIds = [
  "neutral",
  "happy",
  "thinking",
  "comfort",
  "shy",
  "focused",
  "surprised",
  "worried",
  "proud"
];

function assertObject(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Character card field ${path} must be an object.`);
  }
}

function assertString(value, path) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Character card field ${path} must be a non-empty string.`);
  }
}

function assertArray(value, path) {
  if (!Array.isArray(value)) {
    throw new Error(`Character card field ${path} must be an array.`);
  }
}

function validateRequiredStickerSet(stickers) {
  assertArray(stickers, "assets.stickers");

  const ids = stickers.map((sticker) => sticker.id);
  if (ids.length !== requiredStickerIds.length) {
    throw new Error(`Character card must include exactly ${requiredStickerIds.length} stickers.`);
  }

  for (const requiredId of requiredStickerIds) {
    if (!ids.includes(requiredId)) {
      throw new Error(`Character card is missing required sticker ${requiredId}.`);
    }
  }
}

export function validateCharacterCard(card) {
  assertObject(card, "root");
  assertString(card.id, "id");
  assertString(card.name, "name");
  assertObject(card.identity, "identity");
  assertString(card.identity.persona, "identity.persona");
  assertString(card.identity.speakingStyle, "identity.speakingStyle");
  assertString(card.identity.relationship, "identity.relationship");
  assertObject(card.assets, "assets");
  assertString(card.assets.avatar, "assets.avatar");
  assertString(card.assets.portrait, "assets.portrait");
  assertString(card.assets.background, "assets.background");
  validateRequiredStickerSet(card.assets.stickers);

  return card;
}

export async function loadCharacterCardFromDirectory(directory) {
  const source = await readFile(join(directory, "card.json"), "utf8");
  return validateCharacterCard(JSON.parse(source));
}
