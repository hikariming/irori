import assert from "node:assert/strict";
import { test } from "node:test";

import { createTencentDbMemoryClient } from "../src/tencentdb-memory-client.mjs";

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

function routedFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const route = new URL(url).pathname;
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ route, body });
    const handler = routes[route];
    if (!handler) {
      throw new Error(`unexpected route ${route}`);
    }
    return handler(body);
  };
  return { fetchImpl, calls };
}

const manager = { getBaseUrl: async () => "http://127.0.0.1:9999" };

test("captureConversationTurn posts a character-namespaced session_key", async () => {
  const { fetchImpl, calls } = routedFetch({
    "/capture": () => jsonResponse({ l0_recorded: 2, scheduler_notified: true })
  });
  const client = createTencentDbMemoryClient({ fetchImpl, gatewayManager: manager });

  await client.captureConversationTurn({
    characterId: "shili",
    sessionId: "sess-1",
    userText: "我喜欢蓝色",
    assistantText: "记住了"
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].route, "/capture");
  assert.equal(calls[0].body.session_key, "shili::sess-1");
  assert.equal(calls[0].body.user_content, "我喜欢蓝色");
});

test("recallForPrompt returns structured memories and persona scoped to the character", async () => {
  const { fetchImpl, calls } = routedFetch({
    "/search/memories": () => jsonResponse({ results: "- [persona] 用户喜欢蓝色", total: 1, strategy: "fts" }),
    "/recall": () =>
      jsonResponse({ context: "<user-persona>友好</user-persona>\n\n<memory-tools-guide>忽略我</memory-tools-guide>", memory_count: 1 })
  });
  const client = createTencentDbMemoryClient({ fetchImpl, gatewayManager: manager });

  const rows = await client.recallForPrompt({ characterId: "shili", query: "喜欢什么颜色" });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].kind, "relationship_note");
  assert.equal(rows[0].text, "- [persona] 用户喜欢蓝色");
  assert.equal(rows[0].characterId, "shili");
  assert.equal(rows[0].scope, "character");
  // tools-guide block is stripped from the injected persona context
  assert.equal(rows[1].text, "<user-persona>友好</user-persona>");
  assert.ok(!rows[1].text.includes("memory-tools-guide"));
  assert.ok(calls.some((c) => c.route === "/search/memories"));
});

test("recallForPrompt falls back to raw L0 history when no structured memory exists", async () => {
  const { fetchImpl } = routedFetch({
    "/search/memories": () => jsonResponse({ results: "No matching memories found.", total: 0, strategy: "fts" }),
    "/recall": () => jsonResponse({ context: "", memory_count: 0 }),
    "/search/conversations": () => jsonResponse({ results: "**[user]** 我喜欢蓝色", total: 1 })
  });
  const client = createTencentDbMemoryClient({ fetchImpl, gatewayManager: manager });

  const rows = await client.recallForPrompt({ characterId: "shili", query: "颜色" });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "session_summary");
  assert.equal(rows[0].text, "**[user]** 我喜欢蓝色");
});

test("recallForPrompt tolerates gateway errors and returns no rows", async () => {
  const failingManager = {
    getBaseUrl: async () => {
      throw new Error("gateway down");
    }
  };
  const client = createTencentDbMemoryClient({
    fetchImpl: async () => jsonResponse({}),
    gatewayManager: failingManager
  });

  const rows = await client.recallForPrompt({ characterId: "shili", query: "颜色" });
  assert.deepEqual(rows, []);
});

test("recallForPrompt ignores empty queries", async () => {
  let called = false;
  const client = createTencentDbMemoryClient({
    fetchImpl: async () => {
      called = true;
      return jsonResponse({});
    },
    gatewayManager: manager
  });

  const rows = await client.recallForPrompt({ characterId: "shili", query: "   " });
  assert.deepEqual(rows, []);
  assert.equal(called, false);
});

test("listMemories and deleteMemory are safe no-ops over the gateway", async () => {
  const client = createTencentDbMemoryClient({ fetchImpl: async () => jsonResponse({}), gatewayManager: manager });
  assert.deepEqual(await client.listMemories("character", "shili"), []);
  await client.deleteMemory("memory-1");
});
