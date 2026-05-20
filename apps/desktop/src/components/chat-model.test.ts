import assert from "node:assert/strict";
import { test } from "node:test";

import { buildCharacterChatPreview, requiredStickerIds } from "./chat-model.ts";

test("buildCharacterChatPreview maps character assets into chat messages", () => {
  const preview = buildCharacterChatPreview();

  assert.equal(preview.character.name, "示璃");
  assert.equal(preview.assets.avatar.endsWith("avatar-circle.png"), true);
  assert.equal(preview.assets.portrait.endsWith("neutral.png"), true);
  assert.equal(preview.assets.background.endsWith("default.png"), true);
  assert.deepEqual(preview.messages, []);
});

test("buildCharacterChatPreview maps Lu Lin into chat copy and assets", () => {
  const preview = buildCharacterChatPreview("lulin");

  assert.equal(preview.character.id, "lulin");
  assert.equal(preview.character.name, "陆临");
  assert.equal(preview.character.tagline, "深夜护短型本地搭档");
  assert.equal(preview.assets.avatar, "/characters/lulin.card/assets/avatar/avatar-circle.png");
  assert.equal(preview.assets.portrait, "/characters/lulin.card/assets/portraits/neutral.png");
  assert.equal(preview.assets.background, "/characters/lulin.card/assets/backgrounds/default.png");
  assert.equal(preview.stickers[0].src, "/characters/lulin.card/assets/stickers/neutral.png");
});

test("buildCharacterChatPreview exposes the required nine sticker feelings", () => {
  const preview = buildCharacterChatPreview();

  assert.deepEqual(
    preview.stickers.map((sticker) => sticker.id),
    requiredStickerIds
  );
});
