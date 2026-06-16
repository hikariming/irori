import assert from "node:assert/strict";
import { test } from "node:test";

import type { CharacterCard } from "./character-cards.ts";
import {
  affinityTier,
  applyTurn,
  beginEncounter,
  buildCharacterStateView,
  defaultCharacterState,
  describeStateAsDiary,
  getCharacterState,
  lifeBeatAt,
  mergeImpressions,
  sanitizeCharacterStates,
  selectImpressionsForPrompt
} from "./character-state.ts";

const card = { id: "lulin", name: "璐林" } as unknown as CharacterCard;

test("getCharacterState falls back to defaults for unknown characters", () => {
  assert.deepEqual(getCharacterState({}, "lulin"), defaultCharacterState("lulin"));
});

test("beginEncounter counts the first contact as a meeting", () => {
  const { state, context } = beginEncounter(defaultCharacterState("lulin"), 1_000);
  assert.equal(state.meetCount, 1);
  assert.equal(state.lastSeenAt, 1_000);
  assert.equal(context.isNewEncounter, true);
  assert.equal(context.hoursSinceLastSeen, null);
});

test("beginEncounter recovers energy over real time but not within the same encounter", () => {
  const lastSeen = new Date("2026-05-31T05:00:00").getTime();
  const now = new Date("2026-05-31T10:00:00").getTime(); // mid-morning, ceiling 100
  const base = { ...defaultCharacterState("lulin"), energy: 50, lastSeenAt: lastSeen, meetCount: 1 };
  const longGap = beginEncounter(base, now);
  assert.equal(longGap.state.energy, 100); // 50 + 5h * 10/h, capped at the morning ceiling
  assert.equal(longGap.state.meetCount, 2);

  const sameSession = beginEncounter(base, lastSeen + 60_000);
  assert.equal(sameSession.state.meetCount, 1); // under the re-encounter gap
});

test("applyTurn raises affinity and warms mood on positive signals", () => {
  const next = applyTurn(defaultCharacterState("lulin"), { userText: "谢谢你，太好了", replyText: "在的" });
  assert.ok(next.affinity > defaultCharacterState("lulin").affinity);
  assert.equal(next.mood, "playful");
});

test("applyTurn drops affinity and guards mood on negative signals", () => {
  const next = applyTurn({ ...defaultCharacterState("lulin"), affinity: 40 }, { userText: "你真没用", replyText: "好" });
  assert.ok(next.affinity < 40);
  assert.equal(next.mood, "guarded");
});

test("applyTurn turns mood tired when energy bottoms out", () => {
  const next = applyTurn({ ...defaultCharacterState("lulin"), energy: 26 }, { userText: "继续", replyText: "好的" });
  assert.equal(next.mood, "tired");
});

test("affinityTier maps the candor ladder", () => {
  assert.equal(affinityTier(10), "stranger");
  assert.equal(affinityTier(40), "familiar");
  assert.equal(affinityTier(70), "close");
  assert.equal(affinityTier(95), "trusted");
});

test("describeStateAsDiary describes without leaking numbers", () => {
  const diary = describeStateAsDiary(card, defaultCharacterState("lulin"), {
    hoursSinceLastSeen: null,
    isNewEncounter: true
  });
  assert.match(diary, /第一次/);
  assert.doesNotMatch(diary, /[0-9]/);
});

test("buildCharacterStateView surfaces readable labels", () => {
  const view = buildCharacterStateView({
    ...defaultCharacterState("lulin"),
    affinity: 70,
    mood: "warm",
    energy: 30,
    meetCount: 3
  });
  assert.equal(view.affinity, 70);
  assert.equal(view.affinityTier, "close");
  assert.equal(view.mood, "warm");
  assert.equal(view.energyLevel, "low");
  assert.equal(view.meetCount, 3);
});

test("buildCharacterStateView labels a fresh character as not yet talked", () => {
  const view = buildCharacterStateView(defaultCharacterState("lulin"));
  assert.equal(view.meetCount, 0);
});

test("lifeBeatAt lowers the energy ceiling deep at night", () => {
  const lateNight = lifeBeatAt(new Date("2026-05-31T03:00:00"));
  const midMorning = lifeBeatAt(new Date("2026-05-31T10:00:00"));
  assert.ok(lateNight.energyCeiling < midMorning.energyCeiling);
});

test("beginEncounter pulls energy down toward the late-night ceiling over time", () => {
  const base = { ...defaultCharacterState("lulin"), energy: 90, lastSeenAt: 1_000, meetCount: 1 };
  const lateNight = new Date("2026-05-31T03:00:00").getTime();
  const { state } = beginEncounter(base, lateNight);
  assert.ok(state.energy <= 35); // ceiling at this hour
});

test("mergeImpressions records new impressions, dedupes, and nudges affinity", () => {
  const start = defaultCharacterState("lulin");
  const once = mergeImpressions(
    start,
    [
      { kind: "like", text: "用户喜欢深夜写代码" },
      { kind: "grudge", text: "我被打断了" }
    ],
    1_000
  );
  assert.equal(once.impressions.length, 2);
  // like +1, grudge -2 => net -1
  assert.equal(once.affinity, start.affinity - 1);

  const again = mergeImpressions(once, [{ kind: "like", text: "用户喜欢深夜写代码" }], 2_000);
  assert.equal(again.impressions.length, 2); // duplicate ignored
});

test("selectImpressionsForPrompt surfaces grudges first when guarded", () => {
  const state = mergeImpressions(
    { ...defaultCharacterState("lulin"), mood: "guarded" },
    [
      { kind: "like", text: "喜欢猫" },
      { kind: "grudge", text: "上次被放鸽子" }
    ],
    1_000
  );
  const lines = selectImpressionsForPrompt(state, 2);
  assert.match(lines[0], /放鸽子/);
});

test("buildCharacterStateView exposes impression kind keys", () => {
  const state = mergeImpressions(defaultCharacterState("lulin"), [{ kind: "like", text: "喜欢猫" }], 1_000);
  const view = buildCharacterStateView(state);
  assert.equal(view.impressions.length, 1);
  assert.equal(view.impressions[0].kind, "like");
  assert.equal(view.impressions[0].text, "喜欢猫");
});

test("sanitizeCharacterStates clamps and drops invalid entries", () => {
  const result = sanitizeCharacterStates({
    lulin: { affinity: 999, mood: "bogus", energy: -5, lastSeenAt: 5, meetCount: 2.7 },
    bad: 42
  });
  assert.equal(result.lulin.affinity, 100);
  assert.equal(result.lulin.energy, 0);
  assert.equal(result.lulin.mood, "calm");
  assert.equal(result.lulin.meetCount, 2);
  assert.equal(result.bad, undefined);
});
