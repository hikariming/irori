import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyBrowserOpenRequest,
  buildBrowserSnapshot,
  createInitialBrowserState,
  normalizeBrowserUrl
} from "./browser-panel-model.ts";

test("normalizeBrowserUrl accepts http URLs and upgrades bare domains to https", () => {
  assert.equal(normalizeBrowserUrl("https://example.com/docs"), "https://example.com/docs");
  assert.equal(normalizeBrowserUrl("example.com/docs"), "https://example.com/docs");
});

test("normalizeBrowserUrl rejects non-web schemes", () => {
  assert.equal(normalizeBrowserUrl("javascript:alert(1)"), null);
  assert.equal(normalizeBrowserUrl("file:///Users/rqq/.ssh/config"), null);
});

test("applyBrowserOpenRequest switches the panel to a loading web page", () => {
  const next = applyBrowserOpenRequest(createInitialBrowserState(), {
    action: "open",
    url: "example.com/source",
    title: "Source",
    reason: "用户需要查看来源",
    source: "agent"
  });

  assert.equal(next.currentUrl, "https://example.com/source");
  assert.equal(next.title, "Source");
  assert.equal(next.status, "loading");
  assert.equal(next.lastSource, "agent");
  assert.equal(next.reason, "用户需要查看来源");
});

test("buildBrowserSnapshot exposes only read-only page metadata", () => {
  const state = applyBrowserOpenRequest(createInitialBrowserState(), {
    action: "open",
    url: "https://example.com/source",
    title: "Source",
    source: "user"
  });

  assert.deepEqual(buildBrowserSnapshot(state), {
    currentUrl: "https://example.com/source",
    title: "Source",
    status: "loading"
  });
});
