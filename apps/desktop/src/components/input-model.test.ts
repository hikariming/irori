import assert from "node:assert/strict";
import { test } from "node:test";

import { canSendMessage, defaultComposerState } from "./input-model.ts";

test("canSendMessage only allows non-empty enabled drafts", () => {
  assert.equal(canSendMessage({ ...defaultComposerState, draft: "" }), false);
  assert.equal(canSendMessage({ ...defaultComposerState, draft: "   " }), false);
  assert.equal(canSendMessage({ ...defaultComposerState, draft: "帮我整理一下今天的任务" }), true);
  assert.equal(
    canSendMessage({ ...defaultComposerState, draft: "可以发送", disabled: true }),
    false
  );
});
