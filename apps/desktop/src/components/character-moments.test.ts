import assert from "node:assert/strict";
import { test } from "node:test";

import type { CharacterCard } from "./character-cards.ts";
import { defaultCharacterState } from "./character-state.ts";
import {
  composeMomentPrompt,
  formatMomentTime,
  MIN_MOMENT_GAP_MS,
  moodLabel,
  parseMomentText,
  sanitizeMoments,
  shouldPostMoment
} from "./character-moments.ts";

const card = {
  id: "lulin",
  name: "璐林",
  persona: "安静的研究者",
  speakingStyle: "轻声细语"
} as unknown as CharacterCard;

test("shouldPostMoment requires the re-post gap to have elapsed", () => {
  const state = defaultCharacterState("lulin");
  const now = 10 * MIN_MOMENT_GAP_MS;
  assert.equal(shouldPostMoment(state, null, now), true);
  assert.equal(shouldPostMoment(state, now - MIN_MOMENT_GAP_MS - 1, now), true);
  assert.equal(shouldPostMoment(state, now - 1_000, now), false);
});

test("shouldPostMoment refuses to post when energy bottoms out", () => {
  const tired = { ...defaultCharacterState("lulin"), energy: 5 };
  assert.equal(shouldPostMoment(tired, null, 10 * MIN_MOMENT_GAP_MS), false);
});

test("composeMomentPrompt stays self-directed and persona-aware", () => {
  const prompt = composeMomentPrompt(card, defaultCharacterState("lulin"), Date.now());
  assert.match(prompt, /璐林/);
  assert.match(prompt, /安静的研究者/);
  assert.match(prompt, /只输出动态正文本身/);
});

test("parseMomentText strips markers, collapses blank lines and trims", () => {
  const cleaned = parseMomentText("今天天气真好\n\n[sticker:happy]\n[memory:like] 用户喜欢猫");
  assert.equal(cleaned, "今天天气真好");
});

test("parseMomentText truncates very long posts", () => {
  const long = "啊".repeat(200);
  const cleaned = parseMomentText(long);
  assert.ok(cleaned.length <= 141);
  assert.match(cleaned, /…$/);
});

test("formatMomentTime renders relative labels", () => {
  const now = 1_000_000_000_000;
  assert.equal(formatMomentTime(now, now), "刚刚");
  assert.equal(formatMomentTime(now - 5 * 60_000, now), "5 分钟前");
  assert.equal(formatMomentTime(now - 3 * 3_600_000, now), "3 小时前");
  assert.equal(formatMomentTime(now - 2 * 86_400_000, now), "2 天前");
});

test("moodLabel maps enum to readable label or null", () => {
  assert.equal(moodLabel("warm"), "温暖");
  assert.equal(moodLabel(null), null);
});

test("sanitizeMoments drops invalid entries and sorts newest first", () => {
  const result = sanitizeMoments([
    { id: "a", characterId: "lulin", text: "早", mood: "calm", createdAt: 100 },
    { id: "b", characterId: "lulin", text: "  ", mood: "warm", createdAt: 200 },
    { id: "c", characterId: "lulin", text: "晚", mood: "bogus", createdAt: 300 },
    42
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].id, "c");
  assert.equal(result[0].mood, null);
  assert.equal(result[1].id, "a");
});

test("sanitizeMoments accepts numeric-string createdAt", () => {
  const result = sanitizeMoments([{ id: "a", characterId: "lulin", text: "x", mood: null, createdAt: "150" }]);
  assert.equal(result[0].createdAt, 150);
});
