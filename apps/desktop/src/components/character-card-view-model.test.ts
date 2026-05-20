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

test("buildCharacterCardViewModel uses conversational first messages", () => {
  assert.equal(
    buildCharacterCardViewModel("shili").firstMessage,
    "我在。今天想先聊聊，还是直接一起处理一件事？"
  );
  assert.equal(
    buildCharacterCardViewModel("lulin").firstMessage,
    "来了。把现场丢给我，我们先拆最烦的那一块。"
  );
  assert.equal(
    buildCharacterCardViewModel("shenyanzhou").firstMessage,
    "说吧，今天想判断哪件事？我先帮你把客户、钱、风险和下一步拆清楚。"
  );
});
