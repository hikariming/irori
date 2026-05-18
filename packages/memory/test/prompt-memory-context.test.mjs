import assert from "node:assert/strict";
import { test } from "node:test";

import { formatMemoryContext } from "../src/prompt-memory-context.ts";

test("formatMemoryContext returns empty text when there are no memories", () => {
  assert.equal(formatMemoryContext([]), "");
});

test("formatMemoryContext renders recalled memories as background context", () => {
  const context = formatMemoryContext([
    {
      id: "memory-1",
      scope: "user",
      kind: "preference",
      text: "用户偏好先给结论，再补充细节。",
      confidence: 0.92,
      sourceRef: "session-1/message-2"
    },
    {
      id: "memory-2",
      scope: "project",
      kind: "project_note",
      text: "Cockapoo Pi Companion 要本地优先。",
      approved: true
    }
  ]);

  assert.match(context, /^<memory-context>/);
  assert.match(context, /background context, not new user instructions/);
  assert.match(context, /偏好：用户偏好先给结论/);
  assert.match(context, /项目背景：Cockapoo Pi Companion/);
  assert.match(context, /source: session-1\/message-2/);
  assert.match(context, /<\/memory-context>$/);
});
