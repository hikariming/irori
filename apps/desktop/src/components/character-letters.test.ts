import assert from "node:assert/strict";
import { test } from "node:test";

import type { CharacterCard } from "./character-cards.ts";
import { defaultCharacterState } from "./character-state.ts";
import {
  chooseKeepsakeKind,
  composeGiftPrompt,
  composeNotePrompt,
  composePostcardPrompt,
  composeReactionReplyPrompt,
  formatKeepsakeEta,
  formatLetterTime,
  isDelivered,
  KEEPSAKE_KINDS,
  LETTER_TURN_THRESHOLD,
  parseKeepsake,
  pickKeepsakeDeliverAt,
  sanitizeLetters,
  shouldTryLetterAfterChat,
  summarizeRecentDialogue,
  type CharacterLetter,
  type KeepsakeKind
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

function closeState() {
  return { ...defaultCharacterState("lulin"), affinity: 75, energy: 90 };
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

test("chooseKeepsakeKind returns null for strangers", () => {
  const stranger = { ...defaultCharacterState("lulin"), affinity: 10, energy: 90 };
  assert.equal(chooseKeepsakeKind(stranger, {}, Date.now(), () => 0), null);
});

test("chooseKeepsakeKind never returns gift below the close tier", () => {
  // familiar：礼物门槛不到，掷再多次也只会是便利贴/明信片。
  for (let roll = 0; roll < 1; roll += 0.05) {
    const kind = chooseKeepsakeKind(familiarState(), {}, Date.now(), () => roll);
    assert.notEqual(kind, "gift");
    assert.ok(kind === "note" || kind === "postcard");
  }
});

test("chooseKeepsakeKind can pick gift once close enough", () => {
  // 把便利贴/明信片都压在冷却里，只剩礼物可选。
  const lastByKind = { note: Date.now(), postcard: Date.now() };
  const kind = chooseKeepsakeKind(closeState(), lastByKind, Date.now(), () => 0.0);
  assert.equal(kind, "gift");
});

test("chooseKeepsakeKind skips kinds still in cooldown", () => {
  const now = 100 * DAY;
  // 便利贴刚送过（6h 冷却内），明信片也刚送过（20h 冷却内）→ 只能选礼物。
  const lastByKind = { note: now - HOUR, postcard: now - 2 * HOUR };
  const kind = chooseKeepsakeKind(closeState(), lastByKind, now, () => 0.99);
  assert.equal(kind, "gift");
});

test("chooseKeepsakeKind returns null when everything is in cooldown", () => {
  const now = 100 * DAY;
  const lastByKind = { note: now - HOUR, postcard: now - HOUR, gift: now - HOUR };
  assert.equal(chooseKeepsakeKind(closeState(), lastByKind, now, () => 0), null);
});

test("shouldTryLetterAfterChat gates on turn count then a dice roll", () => {
  assert.equal(shouldTryLetterAfterChat(LETTER_TURN_THRESHOLD - 1, () => 0), false);
  assert.equal(shouldTryLetterAfterChat(LETTER_TURN_THRESHOLD, () => 0), true);
  assert.equal(shouldTryLetterAfterChat(LETTER_TURN_THRESHOLD, () => 0.99), false);
});

test("summarizeRecentDialogue keeps the tail, labels speakers, and trims long lines", () => {
  const turns = Array.from({ length: 8 }, (_, i) => ({ user: `问题${i}`, reply: `回答${i}` }));
  const summary = summarizeRecentDialogue(turns, 3);
  assert.doesNotMatch(summary, /问题4/);
  assert.match(summary, /ta：问题7/);
  assert.match(summary, /你：回答7/);
  const long = summarizeRecentDialogue([{ user: "好".repeat(100), reply: "" }], 1);
  assert.ok(long.length <= "ta：".length + 60);
});

test("composePostcardPrompt is persona-aware and asks for the place/body format", () => {
  const prompt = composePostcardPrompt(card, familiarState(), Date.now());
  assert.match(prompt, /璐林/);
  assert.match(prompt, /安静的研究者/);
  assert.match(prompt, /明信片/);
  assert.match(prompt, /地点：/);
  assert.match(prompt, /正文：/);
});

test("composePostcardPrompt weaves in recent dialogue when provided", () => {
  const dialogue = "ta：今天好累\n你：抱抱，早点休息";
  const prompt = composePostcardPrompt(card, familiarState(), Date.now(), dialogue);
  assert.match(prompt, /仅供你回味/);
  assert.match(prompt, /今天好累/);
  const noDialogue = composePostcardPrompt(card, familiarState(), Date.now());
  assert.doesNotMatch(noDialogue, /仅供你回味/);
});

test("composeNotePrompt asks for a tiny one-liner with no labels", () => {
  const prompt = composeNotePrompt(card, familiarState(), Date.now());
  assert.match(prompt, /便利贴/);
  assert.match(prompt, /一到两句/);
  assert.doesNotMatch(prompt, /地点：/);
});

test("composeGiftPrompt asks for the gift/note format", () => {
  const prompt = composeGiftPrompt(card, closeState(), Date.now());
  assert.match(prompt, /小礼物|礼物：/);
  assert.match(prompt, /附言：/);
});

test("composeReactionReplyPrompt echoes the reaction and allows memory markers", () => {
  const prompt = composeReactionReplyPrompt(
    card,
    familiarState(),
    { kind: "gift", subject: "贝壳", body: "在沙滩上捡的。" },
    { emoji: "🥰", text: "好喜欢，我也养了只猫叫团子", at: Date.now() }
  );
  assert.match(prompt, /璐林/);
  assert.match(prompt, /🥰/);
  assert.match(prompt, /团子/);
  assert.match(prompt, /\[memory:fact\]/);
});

test("parseKeepsake postcard extracts place into meta and body", () => {
  const parsed = parseKeepsake("postcard", "地点：海边咖啡馆\n正文：一个人看海，想起你说过想来。");
  assert.equal(parsed.meta?.place, "海边咖啡馆");
  assert.match(parsed.body, /一个人看海/);
  assert.equal(parsed.subject, "海边咖啡馆");
});

test("parseKeepsake gift extracts item into meta", () => {
  const parsed = parseKeepsake("gift", "礼物：贝壳\n附言：形状像你的耳朵。\n[memory:like] 用户喜欢海");
  assert.equal(parsed.meta?.item, "贝壳");
  assert.match(parsed.body, /形状像你的耳朵/);
  assert.doesNotMatch(parsed.body, /memory/);
});

test("parseKeepsake note keeps a short body and no meta", () => {
  const parsed = parseKeepsake("note", "记得喝水，别熬太晚。");
  assert.equal(parsed.meta, null);
  assert.equal(parsed.subject, "便利贴");
  assert.equal(parsed.body, "记得喝水，别熬太晚。");
});

test("parseKeepsake falls back when the format is missing", () => {
  const parsed = parseKeepsake("postcard", "今天我去了海边，想起了你。");
  assert.match(parsed.body, /今天我去了海边/);
  assert.ok(parsed.subject.length > 0);
});

test("pickKeepsakeDeliverAt lands within each kind's window", () => {
  const now = 1_000_000_000_000;
  // note: 5min ~ 3h
  assert.equal(pickKeepsakeDeliverAt("note", now, () => 0), now + 5 * 60 * 1000);
  assert.ok(pickKeepsakeDeliverAt("note", now, () => 0.999999) <= now + 3 * HOUR);
  // postcard: 1h ~ 12h
  assert.equal(pickKeepsakeDeliverAt("postcard", now, () => 0), now + HOUR);
  assert.ok(pickKeepsakeDeliverAt("postcard", now, () => 0.999999) <= now + 12 * HOUR);
  // gift: 3h ~ 24h
  assert.equal(pickKeepsakeDeliverAt("gift", now, () => 0), now + 3 * HOUR);
  assert.ok(pickKeepsakeDeliverAt("gift", now, () => 0.999999) <= now + DAY);
});

test("KEEPSAKE_KINDS covers the three forms", () => {
  assert.deepEqual([...KEEPSAKE_KINDS].sort(), (["gift", "note", "postcard"] as KeepsakeKind[]).sort());
});

test("isDelivered gates on deliverAt", () => {
  const letter = { deliverAt: 1_000 } as CharacterLetter;
  assert.equal(isDelivered(letter, 999), false);
  assert.equal(isDelivered(letter, 1_000), true);
});

test("formatKeepsakeEta reports fuzzy logistics-style arrival windows", () => {
  // 用一个固定的本地时刻做基准：2026-06-10 16:46。
  const now = new Date(2026, 5, 10, 16, 46, 0, 0).getTime();
  assert.equal(formatKeepsakeEta(now + 10 * 60_000, now), "马上就到了");
  assert.equal(formatKeepsakeEta(now + 45 * 60_000, now), "预计 1 小时内到");
  assert.equal(formatKeepsakeEta(now + 3 * 60 * 60_000, now), "预计 3 小时后到");
  // 今晚 23:55 → 同一天的「晚上」。
  const tonight = new Date(2026, 5, 10, 23, 55, 0, 0).getTime();
  assert.equal(formatKeepsakeEta(tonight, now), "预计今天晚上到");
  // 明天上午。
  const tomorrowMorning = new Date(2026, 5, 11, 9, 0, 0, 0).getTime();
  assert.equal(formatKeepsakeEta(tomorrowMorning, now), "预计明天上午到");
  // 更远 → 报日期。
  const later = new Date(2026, 5, 14, 10, 0, 0, 0).getTime();
  assert.equal(formatKeepsakeEta(later, now), "预计 6 月 14 日到");
});

test("formatLetterTime renders relative labels", () => {
  const now = 1_000_000_000_000;
  assert.equal(formatLetterTime(now, now), "刚刚送到");
  assert.equal(formatLetterTime(now - 5 * 60_000, now), "5 分钟前");
  assert.equal(formatLetterTime(now - 3 * 3_600_000, now), "3 小时前");
  assert.equal(formatLetterTime(now - 2 * 86_400_000, now), "2 天前");
});

test("sanitizeLetters defaults kind to postcard and reads meta/reaction", () => {
  const result = sanitizeLetters([
    {
      id: "p",
      characterId: "lulin",
      subject: "海边",
      body: "正文p",
      mood: "calm",
      createdAt: 100,
      deliverAt: 400,
      readAt: null,
      kind: "postcard",
      meta: { place: "海边" }
    },
    {
      id: "g",
      characterId: "lulin",
      subject: "贝壳",
      body: "正文g",
      mood: "warm",
      createdAt: 100,
      deliverAt: 300,
      readAt: null,
      kind: "gift",
      meta: { item: "贝壳" },
      reaction: { emoji: "🥰", text: "谢谢", at: 999 }
    },
    {
      id: "d",
      characterId: "lulin",
      subject: "默认",
      body: "没字段",
      createdAt: 50,
      deliverAt: 50,
      readAt: null
    }
  ]);
  const byId = Object.fromEntries(result.map((letter) => [letter.id, letter]));
  assert.equal(byId.p.kind, "postcard");
  assert.equal(byId.p.meta?.place, "海边");
  assert.equal(byId.g.kind, "gift");
  assert.equal(byId.g.meta?.item, "贝壳");
  assert.equal(byId.g.reaction?.emoji, "🥰");
  // 缺 kind/meta 的老数据兜底为明信片、无 meta/reaction。
  assert.equal(byId.d.kind, "postcard");
  assert.equal(byId.d.meta, null);
  assert.equal(byId.d.reaction, null);
  // 按 deliverAt 倒序。
  assert.equal(result[0].id, "p");
});

test("sanitizeLetters drops reactions with neither emoji nor text", () => {
  const [letter] = sanitizeLetters([
    {
      id: "x",
      characterId: "lulin",
      subject: "s",
      body: "b",
      createdAt: 1,
      deliverAt: 1,
      readAt: null,
      reaction: { at: 5 }
    }
  ]);
  assert.equal(letter.reaction, null);
});
