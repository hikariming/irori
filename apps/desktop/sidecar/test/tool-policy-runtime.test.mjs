import assert from "node:assert/strict";
import { test } from "node:test";

import { buildToolRuntime, isValidScheduleSpec } from "../src/tool-policy-runtime.mjs";

test("buildToolRuntime maps policy ids to Pi-compatible tool names and omits unsupported custom tools", () => {
  const runtime = buildToolRuntime({
    settings: {
      builtinTools: {
        read: true,
        grep: true,
        find: false,
        ls: false,
        bash: false,
        edit: false,
        write: false
      },
      customTools: {
        "memory.read": true,
        "memory.write": true,
        "web.fetch": true,
        "web.search": true,
        "browser.view": true,
        "browser.action": true
      },
      confirmTools: {
        bash: true,
        "browser.action": true
      },
      protectedPaths: [".env"]
    },
    memoryBackend: {
      async recallForPrompt() {
        return [];
      },
      async captureConversationTurn() {
      }
    },
    memoryRecallRequest: {
      userId: "local-user",
      characterId: "shili",
      query: "偏好",
      mode: "companion"
    }
  });

  assert.deepEqual(runtime.tools, ["read", "grep", "memory_read", "memory_write", "fetch_content", "get_search_content", "web_search", "browser_view"]);
  assert.deepEqual(runtime.summary.enabledTools, ["read", "grep", "memory.read", "memory.write", "web.fetch", "web.search", "browser.view"]);
  assert.deepEqual(runtime.summary.registeredCustomTools, ["memory.read", "memory.write", "web.fetch", "web.search", "browser.view"]);
  assert.deepEqual(runtime.summary.unsupportedCustomTools, ["browser.action"]);
});

test("skillRequiredTools enable grantable capabilities that settings left off", () => {
  const settings = {
    builtinTools: { read: true },
    // web.search and browser.view are globally OFF; only the skill asks for them.
    customTools: { "web.search": false, "browser.view": false },
    confirmTools: {},
    protectedPaths: [".env"]
  };

  const without = buildToolRuntime({ settings });
  assert.equal(without.tools.includes("web_search"), false);
  assert.equal(without.tools.includes("browser_view"), false);

  const withSkill = buildToolRuntime({
    settings,
    skillRequiredTools: ["web.search", "browser.view"]
  });
  assert.equal(withSkill.tools.includes("web_search"), true);
  assert.equal(withSkill.tools.includes("browser_view"), true);
  assert.equal(withSkill.gatePolicy.allowedToolNames.includes("web_search"), true);
});

test("skillRequiredTools can never grant bash/edit/write or other non-grantable tools", () => {
  const settings = {
    builtinTools: { read: true, bash: false, edit: false, write: false },
    customTools: {},
    confirmTools: {},
    protectedPaths: [".env"]
  };

  const runtime = buildToolRuntime({
    settings,
    // A hand-edited SKILL.md asking for shell/file mutation must be ignored.
    skillRequiredTools: ["bash", "edit", "write", "web.search"]
  });

  assert.equal(runtime.tools.includes("bash"), false);
  assert.equal(runtime.tools.includes("edit"), false);
  assert.equal(runtime.tools.includes("write"), false);
  // The grantable one still came through.
  assert.equal(runtime.tools.includes("web_search"), true);
});

test("buildToolRuntime declares and allows the subagent tool only when delegation is enabled", () => {
  const baseSettings = {
    builtinTools: { read: true, edit: true, write: true, bash: true },
    customTools: {},
    confirmTools: {},
    protectedPaths: [".env"]
  };

  const off = buildToolRuntime({ settings: baseSettings });
  assert.equal(off.tools.includes("subagent"), false);
  assert.equal(off.gatePolicy.allowedToolNames.includes("subagent"), false);

  const on = buildToolRuntime({ settings: baseSettings, enableSubagents: true });
  assert.equal(on.tools.at(-1), "subagent");
  assert.equal(on.gatePolicy.allowedToolNames.includes("subagent"), true);
  // Delegation itself is allowed (not forced to confirm); the child's own
  // bash/edit/write are gated inside the child instead.
  assert.equal(on.gatePolicy.confirmToolNames.includes("subagent"), false);
});

test("browser_view tool emits a read-only open request for the desktop browser panel", async () => {
  const browserEvents = [];
  const runtime = buildToolRuntime({
    settings: {
      builtinTools: {},
      customTools: {
        "browser.view": true
      },
      confirmTools: {},
      protectedPaths: []
    },
    browserSnapshot: {
      currentUrl: "https://example.com/current",
      title: "Current page"
    },
    onBrowserEvent(event) {
      browserEvents.push(event);
    }
  });

  const browserView = runtime.customTools.find((tool) => tool.name === "browser_view");
  assert.ok(browserView);

  const result = await browserView.execute("tool-call-1", {
    url: "example.com/source",
    title: "Source",
    reason: "用户需要查看来源"
  });

  assert.deepEqual(browserEvents, [{
    action: "open",
    url: "https://example.com/source",
    title: "Source",
    reason: "用户需要查看来源",
    source: "agent"
  }]);
  assert.equal(result.details.status, "open_requested");
  assert.match(result.content[0].text, /右侧浏览器/);
});

test("browser_view tool reports the current desktop browser snapshot when no URL is provided", async () => {
  const runtime = buildToolRuntime({
    settings: {
      builtinTools: {},
      customTools: {
        "browser.view": true
      },
      confirmTools: {},
      protectedPaths: []
    },
    browserSnapshot: {
      currentUrl: "https://example.com/current",
      title: "Current page"
    }
  });

  const browserView = runtime.customTools.find((tool) => tool.name === "browser_view");
  const result = await browserView.execute("tool-call-1", {});

  assert.equal(result.details.status, "snapshot");
  assert.equal(result.details.currentUrl, "https://example.com/current");
  assert.match(result.content[0].text, /Current page/);
});

test("memory_read tool recalls memory through the active memory backend", async () => {
  let recallRequest;
  const runtime = buildToolRuntime({
    settings: {
      builtinTools: {},
      customTools: {
        "memory.read": true
      },
      confirmTools: {},
      protectedPaths: []
    },
    memoryBackend: {
      async recallForPrompt(request) {
        recallRequest = request;
        return [
          {
            id: "memory-1",
            scope: "user",
            kind: "preference",
            text: "用户喜欢先给结论。"
          }
        ];
      }
    },
    memoryRecallRequest: {
      userId: "local-user",
      characterId: "shili",
      query: "默认查询",
      mode: "companion",
      maxResults: 3
    }
  });

  const result = await runtime.customTools[0].execute("tool-call-1", {
    query: "回答风格",
    maxResults: 1
  });

  assert.equal(recallRequest.query, "回答风格");
  assert.equal(recallRequest.maxResults, 1);
  assert.match(result.content[0].text, /用户喜欢先给结论/);
});

test("memory_write tool captures an approved memory through the active backend", async () => {
  let capturedTurn;
  const runtime = buildToolRuntime({
    settings: {
      builtinTools: {},
      customTools: {
        "memory.write": true
      },
      confirmTools: {},
      protectedPaths: []
    },
    memoryBackend: {
      async captureConversationTurn(turn) {
        capturedTurn = turn;
      }
    },
    memoryRecallRequest: {
      userId: "local-user",
      characterId: "shili",
      projectId: "irori",
      sessionId: "session-1",
      query: "写入记忆",
      mode: "companion"
    }
  });

  const result = await runtime.customTools[0].execute("tool-call-1", {
    kind: "preference",
    text: "用户喜欢先给结论，再补充关键细节。",
    reason: "用户明确表达过回答风格偏好。"
  });

  assert.equal(capturedTurn.userId, "local-user");
  assert.equal(capturedTurn.characterId, "shili");
  assert.equal(capturedTurn.projectId, "irori");
  assert.equal(capturedTurn.sessionId, "session-1");
  assert.equal(capturedTurn.userText, "用户喜欢先给结论，再补充关键细节。");
  assert.match(capturedTurn.assistantText, /记忆写入工具/);
  assert.equal(result.details.status, "saved");
  assert.match(result.content[0].text, /已保存记忆/);
});

test("memory_write tool honors policy confirmation before saving", async () => {
  let captureCount = 0;
  const runtime = buildToolRuntime({
    settings: {
      builtinTools: {},
      customTools: {
        "memory.write": true
      },
      confirmTools: {
        "memory.write": true
      },
      protectedPaths: []
    },
    memoryBackend: {
      async captureConversationTurn() {
        captureCount += 1;
      }
    },
    memoryRecallRequest: {
      userId: "local-user",
      characterId: "shili",
      sessionId: "session-1",
      query: "写入记忆",
      mode: "companion"
    }
  });

  const result = await runtime.customTools[0].execute("tool-call-1", {
    kind: "preference",
    text: "用户喜欢简洁回答。"
  });

  assert.equal(captureCount, 0);
  assert.equal(result.details.status, "needs_approval");
  assert.match(result.content[0].text, /确认/);
});

test("memory_write tool rejects empty or sensitive memory candidates", async () => {
  let captureCount = 0;
  const runtime = buildToolRuntime({
    settings: {
      builtinTools: {},
      customTools: {
        "memory.write": true
      },
      confirmTools: {},
      protectedPaths: []
    },
    memoryBackend: {
      async captureConversationTurn() {
        captureCount += 1;
      }
    },
    memoryRecallRequest: {
      userId: "local-user",
      characterId: "shili",
      sessionId: "session-1",
      query: "写入记忆",
      mode: "companion"
    }
  });

  const emptyResult = await runtime.customTools[0].execute("tool-call-1", {
    kind: "preference",
    text: ""
  });
  const sensitiveResult = await runtime.customTools[0].execute("tool-call-2", {
    kind: "project_note",
    text: "用户的 API key 是 sk-test-secret"
  });

  assert.equal(captureCount, 0);
  assert.equal(emptyResult.details.status, "rejected");
  assert.equal(sensitiveResult.details.status, "rejected");
  assert.match(sensitiveResult.content[0].text, /敏感信息/);
});

test("schedule_create is registered only when a sink is provided, and emits the task", async () => {
  const upserts = [];
  const runtime = buildToolRuntime({
    settings: {
      builtinTools: { read: true },
      customTools: {},
      confirmTools: {},
      protectedPaths: []
    },
    onScheduleUpsert: (task) => upserts.push(task)
  });

  const scheduleTool = runtime.customTools.find((tool) => tool.name === "schedule_create");
  assert.ok(scheduleTool, "schedule_create 应被注册");
  // 工具名进入允许列表，模型才能调用、围栏才会放行。
  assert.ok(runtime.tools.includes("schedule_create"));
  assert.ok(runtime.gatePolicy.allowedToolNames.includes("schedule_create"));

  const result = await scheduleTool.execute("tool-call-1", {
    title: "每晚工作总结",
    prompt: "把今天的聊天梳理成晚间总结。",
    scheduleKind: "daily",
    scheduleSpec: "20:00",
    confirmText: "好的，我每晚8点帮你总结～"
  });

  assert.deepEqual(upserts, [
    { title: "每晚工作总结", prompt: "把今天的聊天梳理成晚间总结。", scheduleKind: "daily", scheduleSpec: "20:00" }
  ]);
  assert.equal(result.details.status, "scheduled");
  assert.match(result.content[0].text, /每晚8点/);
});

test("schedule_create rejects an invalid scheduleKind without emitting", async () => {
  const upserts = [];
  const runtime = buildToolRuntime({
    settings: { builtinTools: { read: true }, customTools: {}, confirmTools: {}, protectedPaths: [] },
    onScheduleUpsert: (task) => upserts.push(task)
  });
  const scheduleTool = runtime.customTools.find((tool) => tool.name === "schedule_create");

  const result = await scheduleTool.execute("tool-call-1", {
    title: "x",
    prompt: "y",
    scheduleKind: "yearly",
    scheduleSpec: "20:00"
  });

  assert.equal(upserts.length, 0);
  assert.equal(result.details.status, "invalid");
});

test("isValidScheduleSpec mirrors the Rust validate_schedule rules per kind", () => {
  // daily / weekdays: 'HH:MM'，24 小时制。
  assert.equal(isValidScheduleSpec("daily", "20:00"), true);
  assert.equal(isValidScheduleSpec("weekdays", " 8:05 "), true);
  assert.equal(isValidScheduleSpec("daily", "25:00"), false);
  assert.equal(isValidScheduleSpec("daily", "20:60"), false);
  assert.equal(isValidScheduleSpec("daily", "晚上八点"), false);
  assert.equal(isValidScheduleSpec("daily", "20:00:00"), false);

  // weekly: '日号,日号@HH:MM'，0=周日，至少一个合法日号（与 Rust 的 any 一致）。
  assert.equal(isValidScheduleSpec("weekly", "1,3,5@20:00"), true);
  assert.equal(isValidScheduleSpec("weekly", "9,3@20:00"), true);
  assert.equal(isValidScheduleSpec("weekly", "7@20:00"), false);
  assert.equal(isValidScheduleSpec("weekly", "1,3,5"), false);
  assert.equal(isValidScheduleSpec("weekly", "周一@20:00"), false);

  // once: 本地时间 'YYYY-MM-DDTHH:MM'。
  assert.equal(isValidScheduleSpec("once", "2026-06-11T08:30"), true);
  assert.equal(isValidScheduleSpec("once", "2026-02-30T08:30"), false);
  assert.equal(isValidScheduleSpec("once", "2026-06-11 08:30"), false);
  assert.equal(isValidScheduleSpec("once", "明天早上八点"), false);
});

test("schedule_create rejects a malformed scheduleSpec without emitting, so the model can retry", async () => {
  const upserts = [];
  const runtime = buildToolRuntime({
    settings: { builtinTools: { read: true }, customTools: {}, confirmTools: {}, protectedPaths: [] },
    onScheduleUpsert: (task) => upserts.push(task)
  });
  const scheduleTool = runtime.customTools.find((tool) => tool.name === "schedule_create");

  const result = await scheduleTool.execute("tool-call-1", {
    title: "x",
    prompt: "y",
    scheduleKind: "daily",
    scheduleSpec: "晚上八点"
  });

  assert.equal(upserts.length, 0);
  assert.equal(result.details.status, "invalid");
  assert.match(result.content[0].text, /HH:MM/);
});

test("schedule_create is absent without a sink (unattended scheduled runs)", () => {
  const runtime = buildToolRuntime({
    settings: { builtinTools: { read: true }, customTools: {}, confirmTools: {}, protectedPaths: [] }
  });
  assert.equal(runtime.customTools.find((tool) => tool.name === "schedule_create"), undefined);
  assert.ok(!runtime.tools.includes("schedule_create"));
});

test("schedule_list and schedule_cancel are registered and gated/allowed alongside create", async () => {
  const cancels = [];
  const runtime = buildToolRuntime({
    settings: { builtinTools: { read: true }, customTools: {}, confirmTools: {}, protectedPaths: [] },
    onScheduleUpsert: () => {},
    onScheduleCancel: (taskId) => cancels.push(taskId),
    scheduledTasks: [
      { id: "sched-1", title: "每晚总结", scheduleKind: "daily", scheduleSpec: "20:00", enabled: true }
    ]
  });

  for (const name of ["schedule_create", "schedule_list", "schedule_cancel"]) {
    assert.ok(runtime.tools.includes(name), `${name} 应在允许列表`);
    assert.ok(runtime.gatePolicy.allowedToolNames.includes(name));
  }

  const listTool = runtime.customTools.find((tool) => tool.name === "schedule_list");
  const listed = await listTool.execute("call-1", {});
  assert.equal(listed.details.tasks.length, 1);
  assert.match(listed.content[0].text, /sched-1/);

  const cancelTool = runtime.customTools.find((tool) => tool.name === "schedule_cancel");
  const ok = await cancelTool.execute("call-2", { taskId: "sched-1" });
  assert.deepEqual(cancels, ["sched-1"]);
  assert.equal(ok.details.status, "cancelled");

  const missing = await cancelTool.execute("call-3", { taskId: "nope" });
  assert.equal(missing.details.status, "not_found");
  assert.deepEqual(cancels, ["sched-1"]);
});
