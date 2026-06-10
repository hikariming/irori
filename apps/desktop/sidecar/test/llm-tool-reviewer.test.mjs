import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyReviewDecision, createLlmToolReviewer } from "../src/llm-tool-reviewer.mjs";

test("classifyReviewDecision reads JSON verdicts with reasons", () => {
  assert.deepEqual(classifyReviewDecision('{"decision":"approve","reason":"安全"}'), {
    decision: "approve",
    reason: "安全"
  });
  assert.deepEqual(classifyReviewDecision('{"decision":"reject","reason":"危险"}'), {
    decision: "reject",
    reason: "危险"
  });
  assert.equal(classifyReviewDecision('{"decision":"allow"}').decision, "approve");
});

test("classifyReviewDecision falls back to keyword scan", () => {
  assert.equal(classifyReviewDecision("APPROVE").decision, "approve");
  assert.equal(classifyReviewDecision("approve — looks safe").decision, "approve");
  assert.equal(classifyReviewDecision("REJECT: rm -rf is destructive").decision, "reject");
});

test("classifyReviewDecision returns 'unknown' on ambiguous/empty answers", () => {
  assert.equal(classifyReviewDecision("").decision, "unknown");
  assert.equal(classifyReviewDecision("not sure").decision, "unknown");
  // Mentions both → unknown (never silently approve).
  assert.equal(classifyReviewDecision("I would approve but actually reject this").decision, "unknown");
});

const modelSettings = { baseUrl: "https://api.example.com/v1", modelName: "test-model" };

function jsonResponse(content) {
  return {
    ok: true,
    async json() {
      return { choices: [{ message: { content } }] };
    }
  };
}

test("reviewer posts to chat/completions and returns the approve verdict", async () => {
  const calls = [];
  const reviewer = createLlmToolReviewer({
    modelSettings,
    runtimeToken: "secret-token",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse('{"decision":"approve","reason":"ok"}');
    }
  });

  const verdict = await reviewer({ toolName: "edit", input: { path: "src/app.ts" }, reason: "改文件" });

  assert.deepEqual(verdict, { decision: "approve", reason: "ok" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.example.com/v1/chat/completions");
  assert.equal(calls[0].options.headers.authorization, "Bearer secret-token");
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, "test-model");
  assert.equal(body.messages[0].role, "system");
  assert.match(body.messages[1].content, /edit/);
});

test("reviewer returns reject for a risky call", async () => {
  const reviewer = createLlmToolReviewer({
    modelSettings,
    fetchImpl: async () => jsonResponse('{"decision":"reject","reason":"删库"}')
  });
  assert.deepEqual(await reviewer({ toolName: "bash", input: { command: "rm -rf /" } }), {
    decision: "reject",
    reason: "删库"
  });
});

test("reviewer falls back (not reject) when the model can't decide", async () => {
  const reviewer = createLlmToolReviewer({
    modelSettings,
    fetchImpl: async () => jsonResponse("hmm, maybe?")
  });
  const verdict = await reviewer({ toolName: "write", input: { path: "x" } });
  assert.equal(verdict.decision, "fallback");
  assert.match(verdict.reason, /未给出明确结论/);
});

test("reviewer falls back on a non-ok response, naming the status", async () => {
  const reviewer = createLlmToolReviewer({
    modelSettings,
    fetchImpl: async () => ({ ok: false, status: 503, async json() { return {}; } })
  });
  const verdict = await reviewer({ toolName: "bash", input: { command: "ls" } });
  assert.equal(verdict.decision, "fallback");
  assert.match(verdict.reason, /503/);
});

test("reviewer falls back when fetch throws (model unreachable)", async () => {
  const reviewer = createLlmToolReviewer({
    modelSettings,
    fetchImpl: async () => {
      throw new Error("network down");
    }
  });
  const verdict = await reviewer({ toolName: "write", input: { path: "x" } });
  assert.equal(verdict.decision, "fallback");
  assert.match(verdict.reason, /无法连接/);
});

test("reviewer falls back when no fetch is available", async () => {
  const reviewer = createLlmToolReviewer({ modelSettings, fetchImpl: null });
  assert.equal((await reviewer({ toolName: "edit", input: {} })).decision, "fallback");
});
