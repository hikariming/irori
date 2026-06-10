import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  buildPiWebAccessConfig,
  writePiWebAccessConfig
} from "../src/web-access-config.mjs";

test("buildPiWebAccessConfig defaults to direct auto search without curator UI", () => {
  const config = buildPiWebAccessConfig();

  assert.equal(config.provider, "auto");
  assert.equal(config.searchProvider, "auto");
  assert.equal(config.workflow, "none");
  assert.equal(config.allowBrowserCookies, false);
});

test("buildPiWebAccessConfig falls back to auto when Perplexity has no key", () => {
  const config = buildPiWebAccessConfig({
    provider: "perplexity",
    workflow: "summary-review",
    noKeyFallback: true,
    allowBrowserCookies: true,
    perplexityApiKey: ""
  });

  assert.equal(config.provider, "auto");
  assert.equal(config.searchProvider, "auto");
  assert.equal(config.workflow, "summary-review");
  assert.equal(config.allowBrowserCookies, true);
});

test("writePiWebAccessConfig preserves unknown config keys and writes trimmed secrets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "irori-web-access-"));
  const path = join(dir, "web-search.json");
  await writeFile(path, JSON.stringify({ shortcuts: { curate: "ctrl+k" } }, null, 2));

  try {
    await writePiWebAccessConfig({
      configPath: path,
      settings: {
        provider: "exa",
        workflow: "none",
        noKeyFallback: true,
        exaApiKey: " exa-secret-123456 ",
        geminiApiKey: "gemini-secret-abcdef"
      }
    });

    const stored = JSON.parse(await readFile(path, "utf-8"));
    assert.deepEqual(stored.shortcuts, { curate: "ctrl+k" });
    assert.equal(stored.provider, "exa");
    assert.equal(stored.searchProvider, "exa");
    assert.equal(stored.workflow, "none");
    assert.equal(stored.exaApiKey, "exa-secret-123456");
    assert.equal(stored.geminiApiKey, "gemini-secret-abcdef");

    // 原子写不留 .tmp 残骸。
    assert.deepEqual((await readdir(dir)).filter((name) => name.endsWith(".tmp")), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writePiWebAccessConfig self-heals a corrupt existing config instead of failing forever", async () => {
  const dir = await mkdtemp(join(tmpdir(), "irori-web-access-bad-"));
  const path = join(dir, "web-search.json");
  await writeFile(path, "{ not valid json");

  try {
    await writePiWebAccessConfig({
      configPath: path,
      settings: { provider: "auto", workflow: "none" }
    });

    const stored = JSON.parse(await readFile(path, "utf-8"));
    assert.equal(stored.provider, "auto");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
