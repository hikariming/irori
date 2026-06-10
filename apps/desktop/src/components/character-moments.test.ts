import assert from "node:assert/strict";
import { test } from "node:test";

import type { CharacterCard } from "./character-cards.ts";
import { defaultCharacterState } from "./character-state.ts";
import {
  composeMomentPrompt,
  composePeerCommentPrompt,
  formatMomentTime,
  hasMomentLike,
  MIN_MOMENT_GAP_MS,
  MOMENT_ANGLES,
  parseMomentText,
  peerReactionDecay,
  pickMomentAngle,
  PEER_REACTION_HALF_LIFE_MS,
  PEER_REACTION_MAX_AGE_MS,
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

test("pickMomentAngle is in-range and seed-reproducible", () => {
  assert.equal(pickMomentAngle(0).key, MOMENT_ANGLES[0].key);
  assert.equal(pickMomentAngle(0.999).key, MOMENT_ANGLES[MOMENT_ANGLES.length - 1].key);
  assert.ok(MOMENT_ANGLES.includes(pickMomentAngle(0.5)));
});

test("peerReactionDecay decays with age and hard-cuts old moments", () => {
  assert.equal(peerReactionDecay(0), 1);
  assert.equal(peerReactionDecay(-100), 1);
  assert.ok(Math.abs(peerReactionDecay(PEER_REACTION_HALF_LIFE_MS) - 0.5) < 1e-9);
  // 半衰期叠加：两个半衰期 ≈ 0.25
  assert.ok(Math.abs(peerReactionDecay(2 * PEER_REACTION_HALF_LIFE_MS) - 0.25) < 1e-9);
  // 超过硬截断（太久）→ 0，不再评论
  assert.equal(peerReactionDecay(PEER_REACTION_MAX_AGE_MS), 0);
  assert.equal(peerReactionDecay(PEER_REACTION_MAX_AGE_MS + 1), 0);
});

test("composePeerCommentPrompt is peer-voiced and references the author's moment", () => {
  const peer = { id: "cenji", name: "岑霁", persona: "冷静的调试师", speakingStyle: "干练吐槽" } as unknown as CharacterCard;
  const prompt = composePeerCommentPrompt(peer, defaultCharacterState("cenji"), "璐林", "午后的咖啡又凉了", Date.now());
  assert.match(prompt, /岑霁/);
  assert.match(prompt, /璐林/);
  assert.match(prompt, /午后的咖啡又凉了/);
  assert.match(prompt, /只输出这一句评论本身/);
  // 轻人设：评论 prompt 不应再灌入完整身份背景（避免端着人设、说得很违和）
  assert.doesNotMatch(prompt, /身份与背景/);
});

test("composeMomentPrompt injects angle, day events and anti-repeat recent moments", () => {
  const prompt = composeMomentPrompt(card, defaultCharacterState("lulin"), Date.now(), {
    angle: { key: "complain", hint: "吐槽一下刚遇到的小麻烦" },
    dayEvents: ["在厨房随便弄了点早饭", "在书桌前忙自己的事"],
    recentMoments: ["午后的咖啡还是凉了"]
  });
  assert.match(prompt, /吐槽一下刚遇到的小麻烦/);
  assert.match(prompt, /在厨房随便弄了点早饭/);
  assert.match(prompt, /别在内容或措辞上重复/);
  assert.match(prompt, /午后的咖啡还是凉了/);
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

test("sanitizeMoments drops invalid entries, strips mood from life-circle data, and sorts newest first", () => {
  const result = sanitizeMoments([
    { id: "a", characterId: "lulin", text: "早", mood: "calm", createdAt: 100 },
    { id: "b", characterId: "lulin", text: "  ", mood: "warm", createdAt: 200 },
    { id: "c", characterId: "lulin", text: "晚", mood: "bogus", createdAt: 300 },
    42
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].id, "c");
  assert.equal("mood" in result[0], false);
  assert.equal(result[1].id, "a");
});

test("sanitizeMoments accepts numeric-string createdAt", () => {
  const result = sanitizeMoments([{ id: "a", characterId: "lulin", text: "x", mood: null, createdAt: "150" }]);
  assert.equal(result[0].createdAt, 150);
});

test("sanitizeMoments keeps valid likes and comments newest first", () => {
  const result = sanitizeMoments([
    {
      id: "a",
      characterId: "lulin",
      text: "今天阳光很好",
      createdAt: 150,
      likes: [
        { actorType: "user", actorId: "self", createdAt: 200 },
        { actorType: "bot", actorId: "bad", createdAt: 210 },
        { actorType: "character", actorId: "", createdAt: 220 }
      ],
      comments: [
        { id: "old", actorType: "character", actorId: "shili", text: "确实", createdAt: 300 },
        { id: "empty", actorType: "user", actorId: "self", text: " ", createdAt: 400 },
        { id: "new", actorType: "user", actorId: "self", text: "我也喜欢这样的天。", createdAt: 500 }
      ]
    }
  ]);

  assert.equal(result[0].likes.length, 1);
  assert.deepEqual(result[0].likes[0], { actorType: "user", actorId: "self", createdAt: 200 });
  assert.equal(result[0].comments.length, 2);
  assert.equal(result[0].comments[0].id, "old");
  assert.equal(result[0].comments[1].id, "new");
});

test("hasMomentLike checks likes by actor identity", () => {
  const [moment] = sanitizeMoments([
    {
      id: "a",
      characterId: "lulin",
      text: "今天阳光很好",
      createdAt: 150,
      likes: [{ actorType: "user", actorId: "self", createdAt: 200 }]
    }
  ]);

  assert.equal(hasMomentLike(moment, { actorType: "user", actorId: "self" }), true);
  assert.equal(hasMomentLike(moment, { actorType: "character", actorId: "self" }), false);
});
