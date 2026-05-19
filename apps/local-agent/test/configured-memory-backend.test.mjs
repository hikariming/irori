import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildMemoryRuntimeConfig,
  resolveConfiguredMemoryBackend
} from "../src/configured-memory-backend.mjs";

test("buildMemoryRuntimeConfig keeps memory disabled by default", () => {
  const config = buildMemoryRuntimeConfig({ env: {} });

  assert.equal(config.backend, "chat-history");
  assert.equal(config.tencentdb.moduleName, "@tencentdb-agent-memory/memory-tencentdb");
});

test("buildMemoryRuntimeConfig reads tencentdb settings from request and env", () => {
  const config = buildMemoryRuntimeConfig({
    requestConfig: {
      backend: "tencentdb",
      tencentdb: {
        dataDir: "/tmp/request-memory"
      }
    },
    env: {
      COCKAPOO_TENCENTDB_MEMORY_MODULE: "custom-memory-module",
      COCKAPOO_TENCENTDB_MEMORY_DATA_DIR: "/tmp/env-memory"
    }
  });

  assert.equal(config.backend, "tencentdb");
  assert.equal(config.tencentdb.moduleName, "custom-memory-module");
  assert.equal(config.tencentdb.dataDir, "/tmp/request-memory");
});

test("buildMemoryRuntimeConfig can enable tencentdb from desktop payload", () => {
  const config = buildMemoryRuntimeConfig({
    requestConfig: {
      memoryBackendConfig: {
        backend: "tencentdb",
        tencentdb: {
          dataDir: "/Users/rqq/Library/Application Support/cockapoo-pi-companion/memory-tdai"
        }
      }
    },
    env: {}
  });

  assert.equal(config.backend, "tencentdb");
  assert.equal(
    config.tencentdb.dataDir,
    "/Users/rqq/Library/Application Support/cockapoo-pi-companion/memory-tdai"
  );
});

test("resolveConfiguredMemoryBackend returns null when configured for chat history", async () => {
  const backend = await resolveConfiguredMemoryBackend({
    config: { backend: "chat-history" },
    env: {}
  });

  assert.equal(backend, null);
});

test("resolveConfiguredMemoryBackend wraps an injected tencentdb client", async () => {
  const capturedTurns = [];
  const backend = await resolveConfiguredMemoryBackend({
    config: {
      backend: "tencentdb",
      tencentdb: {
        client: {
          captureConversationTurn: async (turn) => capturedTurns.push(turn),
          recallForPrompt: async () => [
            {
              id: "memory-1",
              scope: "user",
              kind: "preference",
              text: "用户偏好先给结论。"
            }
          ]
        }
      }
    },
    env: {}
  });

  assert.ok(backend);

  const recalled = await backend.recallForPrompt({
    userId: "local-user",
    characterId: "shili",
    query: "继续",
    mode: "companion"
  });

  await backend.captureConversationTurn({
    userId: "local-user",
    characterId: "shili",
    sessionId: "session-1",
    userText: "继续",
    assistantText: "好。",
    createdAt: "2026-05-19T11:00:00.000+08:00"
  });

  assert.equal(recalled[0].text, "用户偏好先给结论。");
  assert.equal(capturedTurns.length, 1);
});

test("resolveConfiguredMemoryBackend loads a tencentdb client factory from a module", async () => {
  const factoryCalls = [];
  const backend = await resolveConfiguredMemoryBackend({
    config: {
      backend: "tencentdb",
      tencentdb: {
        moduleName: "fake-memory-module",
        dataDir: "/tmp/cockapoo-memory"
      }
    },
    env: {},
    importModule: async (moduleName) => {
      assert.equal(moduleName, "fake-memory-module");

      return {
        createMemoryClient(options) {
          factoryCalls.push(options);

          return {
            recallForPrompt: async () => [
              {
                memory_id: "memory-1",
                layer: "session",
                type: "summary",
                memory: "这次在接真实记忆后端。"
              }
            ]
          };
        }
      };
    }
  });

  const recalled = await backend.recallForPrompt({
    userId: "local-user",
    characterId: "shili",
    query: "真实记忆",
    mode: "companion"
  });

  assert.deepEqual(factoryCalls, [
    {
      dataDir: "/tmp/cockapoo-memory"
    }
  ]);
  assert.equal(recalled[0].kind, "session_summary");
  assert.equal(recalled[0].text, "这次在接真实记忆后端。");
});

test("resolveConfiguredMemoryBackend skips plugin-only tencentdb modules", async () => {
  const backend = await resolveConfiguredMemoryBackend({
    config: {
      backend: "tencentdb",
      tencentdb: {
        moduleName: "plugin-only-memory-module"
      }
    },
    env: {},
    importModule: async () => ({
      default() {
        throw new Error("OpenClaw plugin register should not be called as a client factory");
      }
    })
  });

  assert.equal(backend, null);
});

test("resolveConfiguredMemoryBackend rejects unsupported backends", async () => {
  await assert.rejects(
    () =>
      resolveConfiguredMemoryBackend({
        config: { backend: "redis" },
        env: {}
      }),
    /Unsupported memory backend/
  );
});
