import assert from "node:assert/strict";
import { test } from "node:test";

import { buildCharacterCardViewModel } from "./character-card-view-model.ts";

test("buildCharacterCardViewModel exposes shili card assets for settings render", () => {
  const viewModel = buildCharacterCardViewModel();

  assert.equal(viewModel.name, "示璃");
  assert.match(viewModel.storyBackground, /父母都是大学教授/);
  assert.match(viewModel.storyBackground, /清华大学/);
  assert.doesNotMatch(viewModel.storyBackground, /诞生在 Cockapoo Pi Companion/);
  assert.equal(viewModel.interactionPrinciples.length >= 3, true);
  assert.equal(viewModel.immersionCues.length >= 3, true);
  assert.equal(viewModel.stickers.length, 9);
  assert.equal(viewModel.avatar.endsWith("avatar-circle.png"), true);
  assert.equal(viewModel.portrait.endsWith("neutral.png"), true);
  assert.equal(viewModel.background.endsWith("default.png"), true);
});
