# Cockapoo TencentDB Memory Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a TencentDB Agent Memory adapter boundary that Cockapoo can use without coupling the desktop app or local agent to a specific SDK shape.

**Architecture:** Keep `packages/memory` as the only place that knows about backend-specific memory clients. The first adapter accepts an injected TencentDB-compatible client, normalizes returned rows into `RecalledMemory[]`, and delegates capture/list/delete calls through the existing `MemoryBackend` contract.

**Tech Stack:** TypeScript source under `packages/memory`, Node's built-in `node:test` runner, dependency injection for the TencentDB/OpenClaw client.

---

## File Structure

- Create `packages/memory/src/tencentdb-memory-backend.ts`: Adapter factory, small client interface, and normalization helpers.
- Modify `packages/memory/src/index.ts`: Export the adapter factory and client type.
- Create `packages/memory/test/tencentdb-memory-backend.test.mjs`: Red/green tests for delegation and normalization.

## Task 1: Adapter Contract And Recall Normalization

**Files:**
- Create: `packages/memory/test/tencentdb-memory-backend.test.mjs`
- Create: `packages/memory/src/tencentdb-memory-backend.ts`
- Modify: `packages/memory/src/index.ts`

- [x] **Step 1: Write the failing tests**

Add tests that describe the public adapter behavior:

```js
import assert from "node:assert/strict";
import { test } from "node:test";

import { createTencentDbMemoryBackend } from "../src/tencentdb-memory-backend.ts";

test("tencentdb backend requires an injected client", () => {
  assert.throws(
    () => createTencentDbMemoryBackend(),
    /TencentDB memory client is required/
  );
});

test("tencentdb backend delegates captured conversation turns", async () => {
  const calls = [];
  const backend = createTencentDbMemoryBackend({
    captureConversationTurn: async (turn) => calls.push(turn),
    recallForPrompt: async () => []
  });

  const turn = {
    userId: "local-user",
    characterId: "shili",
    projectId: "cockapoo",
    sessionId: "session-1",
    userText: "我喜欢先听结论。",
    assistantText: "记住，后续先给结论。",
    createdAt: "2026-05-19T09:00:00.000+08:00"
  };

  await backend.captureConversationTurn(turn);

  assert.deepEqual(calls, [turn]);
});

test("tencentdb backend normalizes recalled rows", async () => {
  const backend = createTencentDbMemoryBackend({
    recallForPrompt: async (request) => [
      {
        id: "memory-1",
        scope: "user",
        memoryType: "preference",
        content: "用户喜欢先给结论。",
        score: 0.82,
        metadata: { sourceRef: request.userId },
        approved: true
      },
      {
        memory_id: "memory-2",
        layer: "session",
        type: "summary",
        memory: "这一轮在接 TencentDB 记忆适配。",
        confidence: "0.7",
        source: "session-1/2026-05-19T09:05:00.000+08:00"
      }
    ]
  });

  const recalled = await backend.recallForPrompt({
    userId: "local-user",
    characterId: "shili",
    projectId: "cockapoo",
    sessionId: "session-1",
    query: "记忆适配",
    mode: "companion",
    maxResults: 5
  });

  assert.deepEqual(recalled, [
    {
      id: "memory-1",
      scope: "user",
      kind: "preference",
      text: "用户喜欢先给结论。",
      confidence: 0.82,
      sourceRef: "local-user",
      approved: true
    },
    {
      id: "memory-2",
      scope: "session",
      kind: "session_summary",
      text: "这一轮在接 TencentDB 记忆适配。",
      confidence: 0.7,
      sourceRef: "session-1/2026-05-19T09:05:00.000+08:00"
    }
  ]);
});

test("tencentdb backend delegates list and delete when supported", async () => {
  const calls = [];
  const backend = createTencentDbMemoryBackend({
    listMemories: async (scope, ownerId) => {
      calls.push(["list", scope, ownerId]);
      return [{ id: "memory-1", scope, kind: "project_note", text: "项目使用 Pi SDK。" }];
    },
    deleteMemory: async (id) => calls.push(["delete", id])
  });

  const listed = await backend.listMemories("project", "cockapoo");
  await backend.deleteMemory("memory-1");

  assert.equal(listed[0].text, "项目使用 Pi SDK。");
  assert.deepEqual(calls, [
    ["list", "project", "cockapoo"],
    ["delete", "memory-1"]
  ]);
});
```

- [x] **Step 2: Run tests to verify they fail**

Run:

```bash
node --test packages/memory/test/tencentdb-memory-backend.test.mjs
```

Expected: FAIL because `packages/memory/src/tencentdb-memory-backend.ts` does not exist yet.

- [x] **Step 3: Implement the adapter**

Create `packages/memory/src/tencentdb-memory-backend.ts` with:

```ts
import type {
  CapturedConversationTurn,
  MemoryBackend,
  MemoryKind,
  MemoryRecallRequest,
  MemoryScope,
  RecalledMemory
} from "./index.ts";

export type TencentDbMemoryClient = {
  captureConversationTurn?: (turn: CapturedConversationTurn) => Promise<void>;
  recallForPrompt?: (request: MemoryRecallRequest) => Promise<unknown[]>;
  listMemories?: (scope: MemoryScope, ownerId: string) => Promise<unknown[]>;
  deleteMemory?: (id: string) => Promise<void>;
};

export type TencentDbMemoryBackendOptions = {
  client: TencentDbMemoryClient;
};

const memoryScopes = new Set<MemoryScope>(["user", "character", "project", "session"]);
const memoryKinds = new Set<MemoryKind>([
  "profile_fact",
  "preference",
  "relationship_note",
  "project_note",
  "session_summary"
]);

export function createTencentDbMemoryBackend(
  options?: TencentDbMemoryBackendOptions | TencentDbMemoryClient
): MemoryBackend {
  const client = options && "client" in options ? options.client : options;

  if (!client) {
    throw new Error("TencentDB memory client is required to create a memory backend.");
  }

  return {
    async captureConversationTurn(turn) {
      await client.captureConversationTurn?.(turn);
    },
    async recallForPrompt(request) {
      const rows = await client.recallForPrompt?.(request);
      return (rows ?? []).map(normalizeTencentDbMemory).filter((memory): memory is RecalledMemory => memory !== null);
    },
    async listMemories(scope, ownerId) {
      const rows = await client.listMemories?.(scope, ownerId);
      return (rows ?? []).map(normalizeTencentDbMemory).filter((memory): memory is RecalledMemory => memory !== null);
    },
    async deleteMemory(id) {
      await client.deleteMemory?.(id);
    }
  };
}
```

Add helpers in the same file for `normalizeTencentDbMemory`, scope/kind coercion, text extraction, confidence extraction, and source extraction.

- [x] **Step 4: Export the adapter**

Append to `packages/memory/src/index.ts`:

```ts
export { createTencentDbMemoryBackend } from "./tencentdb-memory-backend.ts";
export type { TencentDbMemoryBackendOptions, TencentDbMemoryClient } from "./tencentdb-memory-backend.ts";
```

- [x] **Step 5: Run adapter and package tests**

Run:

```bash
node --test packages/memory/test/tencentdb-memory-backend.test.mjs
node --test packages/memory/test/*.test.mjs
```

Expected: PASS for the new adapter test and the existing memory package tests.

- [x] **Step 6: Commit**

Run:

```bash
git add packages/memory/src/tencentdb-memory-backend.ts packages/memory/src/index.ts packages/memory/test/tencentdb-memory-backend.test.mjs docs/superpowers/plans/2026-05-19-cockapoo-tencentdb-memory-adapter.md
git commit -m "feat: add tencentdb memory adapter shell"
```

## Task 2: Local Agent Runtime Selection

**Files:**
- Create: `apps/local-agent/src/configured-memory-backend.mjs`
- Create: `apps/local-agent/test/configured-memory-backend.test.mjs`
- Modify: `apps/local-agent/src/prompt-runner.mjs`
- Modify: `apps/local-agent/src/index.ts`
- Modify: `apps/local-agent/test/prompt-runner.test.mjs`

- [x] **Step 1: Write failing tests for runtime configuration**

Added tests proving:

```js
buildMemoryRuntimeConfig({ env: {} }).backend === "chat-history";
await resolveConfiguredMemoryBackend({ config: { backend: "chat-history" }, env: {} }) === null;
```

and proving `backend: "tencentdb"` can wrap either an injected client or a module factory.

- [x] **Step 2: Verify the tests fail**

Run:

```bash
node --test apps/local-agent/test/configured-memory-backend.test.mjs
node --test apps/local-agent/test/prompt-runner.test.mjs
```

Expected failure was observed because `configured-memory-backend.mjs` did not exist and `prompt-runner` still fell back directly to chat history.

- [x] **Step 3: Implement runtime selection**

Created `configured-memory-backend.mjs` with:

```js
export function buildMemoryRuntimeConfig({ requestConfig = {}, env = process.env } = {}) {
  return {
    backend: requestConfig.backend ?? env.COCKAPOO_MEMORY_BACKEND ?? "chat-history",
    tencentdb: {
      moduleName: requestConfig.tencentdb?.moduleName ?? env.COCKAPOO_TENCENTDB_MEMORY_MODULE ?? "@tencentdb-agent-memory/memory-tencentdb",
      dataDir: requestConfig.tencentdb?.dataDir ?? env.COCKAPOO_TENCENTDB_MEMORY_DATA_DIR,
      client: requestConfig.tencentdb?.client
    }
  };
}
```

`resolveConfiguredMemoryBackend()` returns `null` for `chat-history`, rejects unknown backend names, and creates a Cockapoo `MemoryBackend` for TencentDB-compatible clients.

- [x] **Step 4: Wire prompt-runner**

`runCockapooPiPrompt()` now resolves memory in this order:

```txt
explicit memoryBackend → configured backend → chatHistoryMemory fallback → no memory
```

- [x] **Step 5: Run tests**

Run:

```bash
node --test apps/local-agent/test/configured-memory-backend.test.mjs
node --test apps/local-agent/test/prompt-runner.test.mjs
```

Expected: PASS.

## Task 3: TencentDB Package And Local Memory Directory

**Files:**
- Modify: `apps/local-agent/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `pnpm-workspace.yaml`
- Modify: `apps/local-agent/src/configured-memory-backend.mjs`
- Modify: `apps/local-agent/test/configured-memory-backend.test.mjs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

- [x] **Step 1: Add failing tests for desktop payload and nested config**

Added tests proving desktop can send:

```json
{
  "memoryBackendConfig": {
    "backend": "tencentdb",
    "tencentdb": {
      "dataDir": "/Users/rqq/Library/Application Support/cockapoo-pi-companion/memory-tdai"
    }
  }
}
```

and local-agent can read that nested payload.

- [x] **Step 2: Install TencentDB Agent Memory**

Run:

```bash
pnpm --dir apps/local-agent add @tencentdb-agent-memory/memory-tencentdb
```

Installed `@tencentdb-agent-memory/memory-tencentdb@0.3.5`, which brings `sqlite-vec@0.1.7-alpha.2`.

- [x] **Step 3: Allow package build scripts**

Updated `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  '@tencentdb-agent-memory/memory-tencentdb': true
```

`pnpm install` then ran the package postinstall. The postinstall OpenClaw patch reported no OpenClaw directory, which is expected for Cockapoo.

- [x] **Step 4: Wire desktop memory directory**

`send_pi_prompt` now creates and sends:

```txt
<app_data_dir>/memory-tdai
```

as `memoryBackendConfig.tencentdb.dataDir`.

- [x] **Step 5: Guard plugin-only exports**

The current package public export is an OpenClaw plugin register function, not a direct client factory. The local-agent loader now skips plugin-only modules and falls back to chat-history memory instead of calling the plugin register function incorrectly.

- [x] **Step 6: Run tests**

Run:

```bash
node --test apps/local-agent/test/configured-memory-backend.test.mjs
cargo test memory_backend_config_points_to_local_tencentdb_directory
```

Expected: PASS.
