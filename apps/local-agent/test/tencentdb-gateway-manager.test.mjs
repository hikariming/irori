import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createGatewayManager, characterDataDir } from "../src/tencentdb-gateway-manager.mjs";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tdai-manager-test-"));
}

function healthOk() {
  return { ok: true, status: 200, json: async () => ({ status: "ok" }) };
}

function fakeSpawn(record) {
  return (command, args, opts) => {
    record.push({ command, args, env: opts.env });
    return { pid: 4321, unref() {} };
  };
}

test("characterDataDir sanitizes the character id into the root", () => {
  assert.equal(characterDataDir("/root", "shili"), path.join("/root", "shili"));
  assert.equal(characterDataDir("/root", "a/b id"), path.join("/root", "a_b_id"));
});

test("getBaseUrl spawns a gateway once, waits for health, and reuses it", async () => {
  const root = tempRoot();
  const spawns = [];
  const manager = createGatewayManager({
    rootDataDir: root,
    llm: { baseUrl: "https://pi.example/v1", apiKey: "tok", model: "pi-1" },
    spawn: fakeSpawn(spawns),
    fetchImpl: async () => healthOk(),
    allocatePortImpl: async () => 8531
  });

  const first = await manager.getBaseUrl("shili");
  const second = await manager.getBaseUrl("shili");

  assert.equal(first, "http://127.0.0.1:8531");
  assert.equal(second, first);
  assert.equal(spawns.length, 1, "second call reuses the in-process promise");

  // Per-character dataDir + LLM creds are passed through the environment.
  const env = spawns[0].env;
  assert.equal(env.TDAI_GATEWAY_PORT, "8531");
  assert.equal(env.TDAI_DATA_DIR, characterDataDir(root, "shili"));
  assert.equal(env.TDAI_LLM_BASE_URL, "https://pi.example/v1");
  assert.equal(env.TDAI_LLM_API_KEY, "tok");
  assert.equal(env.TDAI_LLM_MODEL, "pi-1");

  // A runtime file is recorded for cross-process reuse.
  const runtime = JSON.parse(fs.readFileSync(path.join(env.TDAI_DATA_DIR, "gateway.runtime.json"), "utf-8"));
  assert.equal(runtime.port, 8531);

  fs.rmSync(root, { recursive: true, force: true });
});

test("getBaseUrl reuses a healthy gateway recorded on disk without respawning", async () => {
  const root = tempRoot();
  const dataDir = characterDataDir(root, "nuannuan");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, "gateway.runtime.json"),
    JSON.stringify({ port: 8540, host: "127.0.0.1", pid: 111 })
  );

  const spawns = [];
  const manager = createGatewayManager({
    rootDataDir: root,
    spawn: fakeSpawn(spawns),
    fetchImpl: async () => healthOk(),
    allocatePortImpl: async () => 9999
  });

  const baseUrl = await manager.getBaseUrl("nuannuan");
  assert.equal(baseUrl, "http://127.0.0.1:8540");
  assert.equal(spawns.length, 0, "an already-running gateway is reused");

  fs.rmSync(root, { recursive: true, force: true });
});

test("getBaseUrl rejects when the gateway never becomes healthy", async () => {
  const root = tempRoot();
  const manager = createGatewayManager({
    rootDataDir: root,
    spawn: fakeSpawn([]),
    fetchImpl: async () => {
      throw new Error("connection refused");
    },
    allocatePortImpl: async () => 8550,
    healthTimeoutMs: 30,
    healthIntervalMs: 5
  });

  await assert.rejects(() => manager.getBaseUrl("shili"), /did not become healthy/);

  fs.rmSync(root, { recursive: true, force: true });
});
