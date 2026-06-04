import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildFirstContactFacts,
  buildFirstContactSelfIntro,
  describeUserProfileForPrompt,
  emptyUserProfile,
  isUserProfileEmpty,
  sanitizeUserProfile,
  type UserProfile
} from "./user-profile.ts";

test("sanitizeUserProfile trims, caps and falls back on bad input", () => {
  assert.deepEqual(sanitizeUserProfile(null), emptyUserProfile);
  assert.deepEqual(sanitizeUserProfile("nope"), emptyUserProfile);

  const cleaned = sanitizeUserProfile({
    name: "  阿茶  ",
    gender: "female",
    city: " 上海 ",
    preferences: " 喜欢简洁直接 ",
    selfIntroduction: " 在做一个本地陪伴 app ",
    extra: "ignored"
  });
  assert.equal(cleaned.name, "阿茶");
  assert.equal(cleaned.gender, "female");
  assert.equal(cleaned.city, "上海");
  assert.equal(cleaned.preferences, "喜欢简洁直接");
  assert.equal(cleaned.selfIntroduction, "在做一个本地陪伴 app");
});

test("isUserProfileEmpty detects first-run empty vs any filled field", () => {
  assert.equal(isUserProfileEmpty(emptyUserProfile), true);
  assert.equal(isUserProfileEmpty({ ...emptyUserProfile, city: "上海" }), false);
  assert.equal(isUserProfileEmpty({ ...emptyUserProfile, gender: "female" }), false);
});

test("sanitizeUserProfile rejects unknown gender", () => {
  assert.equal(sanitizeUserProfile({ gender: "robot" }).gender, "unspecified");
});

test("describeUserProfileForPrompt returns null when fully empty", () => {
  assert.equal(describeUserProfileForPrompt(emptyUserProfile), null);
});

test("describeUserProfileForPrompt only includes filled fields", () => {
  const profile: UserProfile = {
    name: "阿茶",
    gender: "unspecified",
    city: "",
    preferences: "喜欢深夜写代码",
    selfIntroduction: ""
  };
  const text = describeUserProfileForPrompt(profile);
  assert.ok(text);
  assert.match(text as string, /阿茶/);
  assert.match(text as string, /喜欢深夜写代码/);
  // 性别为 unspecified、自我介绍为空 → 不应出现
  assert.doesNotMatch(text as string, /性别/);
  assert.doesNotMatch(text as string, /自我介绍/);
});

test("buildFirstContactSelfIntro is first-person and skips empty fields", () => {
  assert.equal(buildFirstContactSelfIntro(emptyUserProfile), "");
  const intro = buildFirstContactSelfIntro({
    ...emptyUserProfile,
    name: "阿茶",
    city: "上海"
  });
  assert.match(intro, /叫我阿茶/);
  assert.match(intro, /我在上海/);
});

test("buildFirstContactFacts yields fact impressions only for filled fields", () => {
  assert.deepEqual(buildFirstContactFacts(emptyUserProfile), []);
  const facts = buildFirstContactFacts({ ...emptyUserProfile, name: "阿茶", gender: "female" });
  assert.equal(facts.length, 2);
  assert.ok(facts.every((fact) => fact.kind === "fact"));
  assert.ok(facts.some((fact) => fact.text.includes("阿茶")));
});
