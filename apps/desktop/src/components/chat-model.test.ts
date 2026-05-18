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

test("buildCharacterChatPreview exposes the required nine sticker feelings", () => {
  const preview = buildCharacterChatPreview();

  assert.deepEqual(
    preview.stickers.map((sticker) => sticker.id),
    requiredStickerIds
  );
});
