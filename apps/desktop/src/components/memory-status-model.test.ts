import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appendMemoryDebugEvent,
  buildMemoryDashboardViewModel,
  createMemoryDebugEventFromRun,
  formatMemoryBackendSource
} from "./memory-status-model.ts";

test("formatMemoryBackendSource explains runtime memory source", () => {
  assert.equal(formatMemoryBackendSource("tencentdb"), "TencentDB 记忆");
  assert.equal(formatMemoryBackendSource("chat-history"), "聊天历史 fallback");
  assert.equal(formatMemoryBackendSource("none"), "未注入记忆");
});

test("buildMemoryDashboardViewModel combines static status and latest recall", () => {
  const viewModel = buildMemoryDashboardViewModel({
    status: {
      configuredBackend: "tencentdb",
      fallbackBackend: "chat-history",
      memoryDir: "/Users/rqq/Library/Application Support/irori/memory-tdai",
      sqliteVecAvailable: true,
      tencentDbPackageAvailable: true,
      vectorsDbExists: false
    },
    latestRun: {
      memoryBackendSource: "chat-history",
      recalledMemories: [
        {
          id: "memory-1",
          scope: "session",
          kind: "session_summary",
          text: "用户喜欢先给结论。",
          sourceRef: "session-1/m1"
        }
      ]
    }
  });

  assert.equal(viewModel.backendLabel, "TencentDB 记忆");
  assert.equal(viewModel.latestSourceLabel, "聊天历史 fallback");
  assert.equal(viewModel.recalledCount, 1);
  assert.equal(viewModel.storageRows[0].label, "记忆目录");
  assert.match(viewModel.storageRows[0].value, /memory-tdai/);
  assert.equal(viewModel.memories[0].kindLabel, "会话摘要");
});

test("buildMemoryDashboardViewModel filters role-scoped memories by selected character", () => {
  const viewModel = buildMemoryDashboardViewModel({
    selectedCharacterId: "shili",
    status: null,
    latestRun: {
      memoryBackendSource: "tencentdb",
      recalledMemories: [
        {
          id: "user-preference",
          scope: "user",
          kind: "preference",
          text: "用户喜欢短句开场。"
        },
        {
          id: "project-note",
          scope: "project",
          kind: "project_note",
          text: "项目是 Irori。"
        },
        {
          id: "shili-note",
          scope: "character",
          kind: "relationship_note",
          characterId: "shili",
          text: "示璃开场要轻一点。"
        },
        {
          id: "lulin-note",
          scope: "character",
          kind: "relationship_note",
          characterId: "lulin",
          text: "陆临可以更直接。"
        },
        {
          id: "shili-session",
          scope: "session",
          kind: "session_summary",
          characterId: "shili",
          sessionId: "session-shili",
          text: "示璃最近聊过开场白。"
        },
        {
          id: "lulin-session",
          scope: "session",
          kind: "session_summary",
          characterId: "lulin",
          sessionId: "session-lulin",
          text: "陆临最近聊过 bug。"
        }
      ]
    }
  });

  assert.deepEqual(
    viewModel.memories.map((memory) => memory.id),
    ["user-preference", "project-note", "shili-note", "shili-session"]
  );
  assert.equal(viewModel.recalledCount, 4);
  assert.equal(viewModel.totalRecalledCount, 6);
  assert.equal(viewModel.selectedCharacterLabel, "示璃");
});

test("createMemoryDebugEventFromRun summarizes latest memory behavior", () => {
  const event = createMemoryDebugEventFromRun({
    now: new Date("2026-05-19T22:41:00.000+08:00"),
    run: {
      memoryBackendSource: "chat-history",
      recalledMemories: [
        {
          id: "memory-1",
          scope: "session",
          kind: "session_summary",
          text: "用户喜欢先给结论。"
        }
      ]
    }
  });

  assert.equal(event.kind, "fallback");
  assert.equal(event.sourceLabel, "聊天历史 fallback");
  assert.equal(event.summary, "召回 1 条，使用聊天历史 fallback。");
  assert.match(event.timeLabel, /22:41/);
});

test("appendMemoryDebugEvent keeps newest ten events first", () => {
  const events = Array.from({ length: 10 }, (_, index) => ({
    id: `old-${index}`,
    kind: "recall" as const,
    sourceLabel: "TencentDB 记忆",
    summary: `旧事件 ${index}`,
    timeLabel: `22:${index.toString().padStart(2, "0")}`
  }));
  const next = appendMemoryDebugEvent(events, {
    id: "new",
    kind: "capture",
    sourceLabel: "TencentDB 记忆",
    summary: "新事件",
    timeLabel: "22:41"
  });

  assert.equal(next.length, 10);
  assert.equal(next[0].id, "new");
  assert.equal(next.at(-1)?.id, "old-8");
});
