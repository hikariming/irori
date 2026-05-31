import assert from "node:assert/strict";
import { test } from "node:test";

import type { CharacterCard } from "./character-cards.ts";
import { defaultCharacterState } from "./character-state.ts";
import {
  composeLetterPrompt,
  formatLetterTime,
  isDelivered,
  MIN_LETTER_GAP_MS,
  parseLetterReply,
  pickDeliverAt,
  sanitizeLetters,
  shouldWriteLetter,
  type CharacterLetter
} from "./character-letters.ts";

const card = {
  id: "lulin",
  name: "璐林",
  persona: "安静的研究者",
  speakingStyle: "轻声细语"
} as unknown as CharacterCard;

function familiarState() {
  return { ...defaultCharacterState("lulin"), affinity: 40, energy: 80 };
}

test("shouldWriteLetter requires more than a stranger relationship", () => {
  const stranger = { ...defaultCharacterState("lulin"), affinity: 10, energy: 80 };
  assert.equal(shouldWriteLetter(stranger, null, 10 * MIN_LETTER_GAP_MS), false);
  assert.equal(shouldWriteLetter(familiarState(), null, 10 * MIN_LETTER_GAP_MS), true);
});

test("shouldWriteLetter respects the re-write gap and energy floor", () => {
  const now = 10 * MIN_LETTER_GAP_MS;
  assert.equal(shouldWriteLetter(familiarState(), now - MIN_LETTER_GAP_MS - 1, now), true);
  assert.equal(shouldWriteLetter(familiarState(), now - 1_000, now), false);
  const tired = { ...familiarState(), energy: 10 };
  assert.equal(shouldWriteLetter(tired, null, now), false);
});

test("composeLetterPrompt is persona-aware and asks for the subject/body format", () => {
  const prompt = composeLetterPrompt(card, familiarState(), Date.now());
  assert.match(prompt, /璐林/);
  assert.match(prompt, /安静的研究者/);
  assert.match(prompt, /主题：/);
  assert.match(prompt, /正文：/);
});

test("parseLetterReply extracts subject and body and strips markers", () => {
  const reply = "主题：好久不见\n正文：最近天气转凉了。\n[sticker:warm]\n[memory:like] 用户喜欢猫\n记得加件外套。";
  const { subject, body } = parseLetterReply(reply);
  assert.equal(subject, "好久不见");
  assert.match(body, /最近天气转凉了。/);
  assert.match(body, /记得加件外套。/);
  assert.doesNotMatch(body, /sticker|memory/);
});

test("parseLetterReply falls back when the format is missing", () => {
  const { subject, body } = parseLetterReply("今天我去了海边，想起了你。");
  assert.equal(body, "今天我去了海边，想起了你。");
  assert.ok(subject.length > 0);
});

test("pickDeliverAt lands within the 1-24h delay window", () => {
  const now = 1_000_000_000_000;
  assert.equal(pickDeliverAt(now, () => 0), now + 1 * 60 * 60 * 1000);
  const late = pickDeliverAt(now, () => 0.999999);
  assert.ok(late > now + 23 * 60 * 60 * 1000);
  assert.ok(late <= now + 24 * 60 * 60 * 1000);
});

test("isDelivered gates on deliverAt", () => {
  const letter = { deliverAt: 1_000 } as CharacterLetter;
  assert.equal(isDelivered(letter, 999), false);
  assert.equal(isDelivered(letter, 1_000), true);
  assert.equal(isDelivered(letter, 2_000), true);
});

test("formatLetterTime renders relative labels", () => {
  const now = 1_000_000_000_000;
  assert.equal(formatLetterTime(now, now), "刚刚送到");
  assert.equal(formatLetterTime(now - 5 * 60_000, now), "5 分钟前");
  assert.equal(formatLetterTime(now - 3 * 3_600_000, now), "3 小时前");
  assert.equal(formatLetterTime(now - 2 * 86_400_000, now), "2 天前");
});

test("sanitizeLetters drops invalid entries and sorts by deliverAt desc", () => {
  const result = sanitizeLetters([
    { id: "a", characterId: "lulin", subject: "早", body: "正文a", mood: "calm", createdAt: 100, deliverAt: 200, readAt: null },
    { id: "b", characterId: "lulin", subject: " ", body: "正文b", mood: "warm", createdAt: 100, deliverAt: 300, readAt: null },
    { id: "c", characterId: "lulin", subject: "晚", body: "正文c", mood: "bogus", createdAt: 100, deliverAt: 400, readAt: "500" },
    7
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].id, "c");
  assert.equal(result[0].mood, null);
  assert.equal(result[0].readAt, 500);
  assert.equal(result[1].id, "a");
});

test("sanitizeLetters defaults deliverAt to createdAt when missing", () => {
  const result = sanitizeLetters([{ id: "a", characterId: "lulin", subject: "s", body: "b", mood: null, createdAt: 150 }]);
  assert.equal(result[0].deliverAt, 150);
  assert.equal(result[0].readAt, null);
});
