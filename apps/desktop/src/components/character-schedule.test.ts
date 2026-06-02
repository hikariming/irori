import assert from "node:assert/strict";
import { test } from "node:test";

import type { CharacterCard } from "./character-cards.ts";
import {
  composeDayScriptPrompt,
  currentItem,
  defaultDaySkeleton,
  describeNowActivity,
  markExecutedUpTo,
  minutesOfDay,
  parseDayScript,
  sanitizeDayScript,
  toDateStr,
  type DayScript
} from "./character-schedule.ts";

const card = {
  id: "lulin",
  name: "璐林",
  persona: "安静的研究者",
  speakingStyle: "轻声细语"
} as unknown as CharacterCard;

test("toDateStr and minutesOfDay read local date/time", () => {
  const d = new Date(2026, 5, 1, 9, 30); // 2026-06-01 09:30 本地
  assert.equal(toDateStr(d), "2026-06-01");
  assert.equal(minutesOfDay(d), 9 * 60 + 30);
});

test("defaultDaySkeleton always yields a usable pending day", () => {
  const script = defaultDaySkeleton("lulin", "2026-06-01", 123);
  assert.equal(script.characterId, "lulin");
  assert.equal(script.generatedAt, 123);
  assert.ok(script.items.length >= 5);
  assert.ok(script.items.every((item) => item.status === "pending"));
  // 升序
  for (let i = 1; i < script.items.length; i += 1) {
    assert.ok(script.items[i].startMinutes >= script.items[i - 1].startMinutes);
  }
});

test("composeDayScriptPrompt is persona-aware and asks for a JSON array", () => {
  const prompt = composeDayScriptPrompt(card, "2026-06-01");
  assert.match(prompt, /璐林/);
  assert.match(prompt, /安静的研究者/);
  assert.match(prompt, /2026-06-01/);
  assert.match(prompt, /JSON/);
  assert.match(prompt, /"time"/);
});

test("parseDayScript reads a clean JSON array of items", () => {
  const raw = `好的：[
    {"time":"08:00","activity":"煮咖啡","location":"厨房","category":"meal","energy":8,"mood":"warm"},
    {"time":"09:30","activity":"读论文","location":"书桌","category":"reading","energy":-6,"mood":"calm"},
    {"time":"12:00","activity":"午饭","location":"厨房","category":"meal","energy":4,"mood":""},
    {"time":"14:00","activity":"散步","location":"外面","category":"outing","energy":-5,"mood":"playful"},
    {"time":"22:00","activity":"睡前看会儿书","location":"卧室","category":"reading","energy":6,"mood":"tired"}
  ]`;
  const script = parseDayScript(raw, "lulin", "2026-06-01", 999);
  assert.equal(script.items.length, 5);
  assert.equal(script.items[0].startMinutes, 8 * 60);
  assert.equal(script.items[0].activity, "煮咖啡");
  assert.equal(script.items[0].moodShift, "warm");
  assert.equal(script.items[2].moodShift, null); // 空 mood
  assert.ok(script.items.every((item) => item.status === "pending"));
});

test("parseDayScript falls back to the skeleton on garbage/too-few items", () => {
  const fallback = parseDayScript("模型抽风了，什么都没有", "lulin", "2026-06-01");
  assert.ok(fallback.items.length >= 5);
  const tooFew = parseDayScript('[{"time":"08:00","activity":"起床"}]', "lulin", "2026-06-01");
  assert.ok(tooFew.items.length >= 5); // 不足下限 → 骨架
});

test("parseDayScript clamps energy and drops malformed entries", () => {
  const raw = `[
    {"time":"08:00","activity":"早","energy":999},
    {"time":"bad","activity":"无效时间"},
    {"activity":"没时间"},
    {"time":"09:00","activity":""},
    {"time":"10:00","activity":"正常","energy":-5},
    {"time":"11:00","activity":"a","energy":1},
    {"time":"12:00","activity":"b","energy":1}
  ]`;
  const script = parseDayScript(raw, "lulin", "2026-06-01");
  // 无效时间 / 空 activity / 缺时间的都丢掉，剩 4 条 -> 不足 5 回退骨架
  assert.ok(script.items.length >= 5);
  // energy 被夹紧（验证夹紧逻辑用一条足量的输入）
  const big = parseDayScript(
    `[
      {"time":"08:00","activity":"a","energy":999},
      {"time":"09:00","activity":"b","energy":-999},
      {"time":"10:00","activity":"c","energy":3},
      {"time":"11:00","activity":"d","energy":3},
      {"time":"12:00","activity":"e","energy":3}
    ]`,
    "lulin",
    "2026-06-01"
  );
  assert.equal(big.items[0].energyEffect, 20);
  assert.equal(big.items[1].energyEffect, -30);
});

function sampleScript(): DayScript {
  return parseDayScript(
    `[
      {"time":"00:00","activity":"睡觉","location":"卧室","category":"sleep","energy":18,"mood":"calm"},
      {"time":"08:00","activity":"早饭","location":"厨房","category":"meal","energy":8,"mood":"warm"},
      {"time":"14:00","activity":"看书","location":"阳台","category":"reading","energy":-4,"mood":"calm"},
      {"time":"19:00","activity":"做晚饭","location":"厨房","category":"chore","energy":-8,"mood":"tired"},
      {"time":"23:00","activity":"准备睡了","location":"卧室","category":"rest","energy":10,"mood":"tired"}
    ]`,
    "lulin",
    "2026-06-01"
  );
}

test("currentItem returns the active slot, wrapping before the first item", () => {
  const script = sampleScript();
  assert.equal(currentItem(script, 9 * 60)?.activity, "早饭"); // 09:00 -> 08:00 槽
  assert.equal(currentItem(script, 15 * 60)?.activity, "看书"); // 15:00 -> 14:00 槽
  // 凌晨 00:00 命中第一条睡觉
  assert.equal(currentItem(script, 0)?.activity, "睡觉");
});

test("describeNowActivity injects location + activity", () => {
  const line = describeNowActivity(sampleScript(), 15 * 60);
  assert.match(line ?? "", /阳台/);
  assert.match(line ?? "", /看书/);
});

test("markExecutedUpTo flips past pending items and reports the new ones", () => {
  const script = sampleScript();
  const first = markExecutedUpTo(script, 9 * 60); // 00:00 睡觉 + 08:00 早饭
  assert.equal(first.newlyExecuted.length, 2);
  assert.ok(first.script.items.slice(0, 2).every((item) => item.status === "executed"));
  // 再推进到 15:00：只有 14:00 看书是新执行的（前两条已 executed）
  const second = markExecutedUpTo(first.script, 15 * 60);
  assert.equal(second.newlyExecuted.length, 1);
  assert.equal(second.newlyExecuted[0].activity, "看书");
});

test("sanitizeDayScript round-trips a stored script and rejects junk", () => {
  const script = sampleScript();
  const restored = sanitizeDayScript(JSON.parse(JSON.stringify(script)));
  assert.ok(restored);
  assert.equal(restored?.items.length, script.items.length);
  assert.equal(sanitizeDayScript(null), null);
  assert.equal(sanitizeDayScript({ characterId: "x", date: "2026-06-01", items: [] }), null);
  assert.equal(sanitizeDayScript({ characterId: "x" }), null);
});
