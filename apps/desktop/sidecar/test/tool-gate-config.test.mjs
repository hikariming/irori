import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { defaultProtectedPaths } from "../../../../packages/safety/src/runtime.mjs";
import {
  buildToolGateConfig,
  readToolGateConfigSync,
  writeToolGateConfig
} from "../src/tool-gate-config.mjs";

test("buildToolGateConfig normalizes lists, dedupes, and defaults mode/protectedPaths", () => {
  const config = buildToolGateConfig({
    gatePolicy: {
      allowedToolNames: ["read", "read", " bash ", 42, ""],
      confirmToolNames: ["bash"],
      protectedPaths: []
    },
    mode: "not-a-mode"
  });

  assert.deepEqual(config.gatePolicy.allowedToolNames, ["read", "bash"]);
  assert.deepEqual(config.gatePolicy.confirmToolNames, ["bash"]);
  assert.deepEqual(config.gatePolicy.protectedPaths, [...defaultProtectedPaths]);
  assert.equal(config.mode, "confirm");
});

test("buildToolGateConfig keeps a valid mode and explicit protectedPaths", () => {
  const config = buildToolGateConfig({
    gatePolicy: { allowedToolNames: ["read"], protectedPaths: [".env", "secret/*"] },
    mode: "managed"
  });

  assert.equal(config.mode, "managed");
  assert.deepEqual(config.gatePolicy.protectedPaths, [".env", "secret/*"]);
});

test("writeToolGateConfig round-trips and preserves unknown keys", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cockapoo-tool-gate-"));
  const path = join(dir, "cockapoo-tool-gate.json");
  await writeFile(path, JSON.stringify({ note: "keep me" }, null, 2));

  try {
    const written = await writeToolGateConfig({
      configPath: path,
      mode: "auto",
      gatePolicy: {
        allowedToolNames: ["read", "edit"],
        confirmToolNames: ["edit"],
        protectedPaths: [".env"]
      }
    });

    assert.equal(written.note, "keep me");

    const stored = JSON.parse(await readFile(path, "utf-8"));
    assert.equal(stored.note, "keep me");
    assert.equal(stored.mode, "auto");
    assert.deepEqual(stored.gatePolicy.allowedToolNames, ["read", "edit"]);

    const reloaded = readToolGateConfigSync(path);
    assert.equal(reloaded.mode, "auto");
    assert.deepEqual(reloaded.gatePolicy.allowedToolNames, ["read", "edit"]);
    assert.deepEqual(reloaded.gatePolicy.confirmToolNames, ["edit"]);
    assert.deepEqual(reloaded.gatePolicy.protectedPaths, [".env"]);

    // 原子写不留 .tmp 残骸。
    assert.deepEqual((await readdir(dir)).filter((name) => name.endsWith(".tmp")), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeToolGateConfig self-heals a corrupt existing config instead of failing forever", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cockapoo-tool-gate-heal-"));
  const path = join(dir, "cockapoo-tool-gate.json");
  await writeFile(path, "{ not valid json");

  try {
    const written = await writeToolGateConfig({
      configPath: path,
      mode: "auto",
      gatePolicy: { allowedToolNames: ["read"] }
    });

    assert.deepEqual(written.gatePolicy.allowedToolNames, ["read"]);
    const reloaded = readToolGateConfigSync(path);
    assert.deepEqual(reloaded.gatePolicy.allowedToolNames, ["read"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readToolGateConfigSync fails closed on a missing file", () => {
  const config = readToolGateConfigSync(join(tmpdir(), "cockapoo-no-such-gate-config.json"));

  assert.deepEqual(config.gatePolicy.allowedToolNames, []);
  assert.equal(config.mode, "confirm");
  assert.deepEqual(config.gatePolicy.protectedPaths, [...defaultProtectedPaths]);
});

test("readToolGateConfigSync fails closed on corrupt JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cockapoo-tool-gate-bad-"));
  const path = join(dir, "cockapoo-tool-gate.json");
  await writeFile(path, "{ not valid json");

  try {
    const config = readToolGateConfigSync(path);
    assert.deepEqual(config.gatePolicy.allowedToolNames, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
