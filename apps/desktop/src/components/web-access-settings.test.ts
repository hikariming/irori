import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildDefaultWebAccessSettings,
  buildWebAccessSettingsViewModel,
  mergeSavedWebAccessSettings,
  redactedWebAccessKeyHint
} from "./web-access-settings.ts";

test("buildDefaultWebAccessSettings enables auto provider with no-key fallback", () => {
  const settings = buildDefaultWebAccessSettings();

  assert.equal(settings.provider, "auto");
  assert.equal(settings.workflow, "none");
  assert.equal(settings.noKeyFallback, true);
  assert.equal(settings.allowBrowserCookies, false);
  assert.equal(settings.exaHasKey, false);
  assert.equal(settings.perplexityHasKey, false);
  assert.equal(settings.geminiHasKey, false);
});

test("mergeSavedWebAccessSettings sanitizes provider and preserves saved key status", () => {
  const settings = mergeSavedWebAccessSettings({
    provider: "unknown",
    workflow: "curator",
    noKeyFallback: false,
    allowBrowserCookies: true,
    exaHasKey: true,
    exaKeyHint: "••••1234",
    perplexityHasKey: true,
    geminiHasKey: false
  });

  assert.equal(settings.provider, "auto");
  assert.equal(settings.workflow, "none");
  assert.equal(settings.noKeyFallback, false);
  assert.equal(settings.allowBrowserCookies, true);
  assert.equal(settings.exaHasKey, true);
  assert.equal(settings.exaKeyHint, "••••1234");
  assert.equal(settings.perplexityHasKey, true);
});

test("buildWebAccessSettingsViewModel marks explicit keyless providers as fallback eligible", () => {
  const view = buildWebAccessSettingsViewModel({
    ...buildDefaultWebAccessSettings(),
    provider: "perplexity",
    noKeyFallback: true
  });

  assert.equal(view.providerLabel, "Perplexity");
  assert.equal(view.effectiveProviderLabel, "Auto");
  assert.equal(view.willFallbackWithoutKey, true);
  assert.equal(view.keyRows.find((row) => row.id === "perplexity")?.status, "未保存");
});

test("redactedWebAccessKeyHint hides saved API keys", () => {
  assert.equal(redactedWebAccessKeyHint("exa-secret-abcdef"), "••••cdef");
  assert.equal(redactedWebAccessKeyHint("short"), "已保存");
});
