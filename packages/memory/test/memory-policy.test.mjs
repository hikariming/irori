import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyMemoryCandidate } from "../src/memory-policy.ts";

test("classifyMemoryCandidate allows non-sensitive workflow preferences", () => {
  const decision = classifyMemoryCandidate({
    kind: "preference",
    text: "用户偏好先给结论，再补充细节。",
    inferred: false
  });

  assert.equal(decision.action, "allow");
  assert.match(decision.reason, /偏好/);
});

test("classifyMemoryCandidate requires approval for relationship notes", () => {
  const decision = classifyMemoryCandidate({
    kind: "relationship_note",
    text: "用户希望示璃在焦虑时先安静陪一会儿。",
    inferred: false
  });

  assert.equal(decision.action, "requires_approval");
  assert.match(decision.reason, /关系/);
});

test("classifyMemoryCandidate requires approval for inferred memories", () => {
  const decision = classifyMemoryCandidate({
    kind: "project_note",
    text: "用户可能更喜欢保守的工程决策。",
    inferred: true
  });

  assert.equal(decision.action, "requires_approval");
  assert.match(decision.reason, /推断/);
});

test("classifyMemoryCandidate rejects sensitive credentials and health details", () => {
  assert.equal(
    classifyMemoryCandidate({
      kind: "profile_fact",
      text: "用户的 API key 是 sk-live-1234567890。",
      inferred: false
    }).action,
    "reject"
  );
  assert.equal(
    classifyMemoryCandidate({
      kind: "profile_fact",
      text: "用户正在接受健康诊断。",
      inferred: false
    }).action,
    "reject"
  );
});
