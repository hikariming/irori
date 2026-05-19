import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildMemoryDashboardViewModel,
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
      memoryDir: "/Users/rqq/Library/Application Support/cockapoo-pi-companion/memory-tdai",
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
