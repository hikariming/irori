import { Type } from "@earendil-works/pi-ai";

import {
  defaultToolPolicySettings,
  resolveToolPolicy,
  skillGrantableToolIds
} from "../../../../packages/safety/src/runtime.mjs";
import { classifyMemoryCandidate } from "../../../../packages/memory/src/runtime.mjs";

const supportedCustomToolNames = {
  "memory.read": "memory_read",
  "memory.write": "memory_write",
  "web.fetch": ["fetch_content", "get_search_content"],
  "web.search": "web_search",
  "browser.view": "browser_view",
  // 一个 Cockapoo id 展开成三个 pi 工具名：建 / 列 / 取消，三者同进退、同围栏放行。
  "schedule.create": ["schedule_create", "schedule_list", "schedule_cancel"]
};

const memoryKinds = new Set([
  "profile_fact",
  "preference",
  "relationship_note",
  "project_note",
  "session_summary"
]);

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : "";
}

function normalizeBrowserUrl(value) {
  const trimmed = nonEmptyString(value);
  if (!trimmed) {
    return "";
  }

  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }
    return url.toString();
  } catch {
    return "";
  }
}

function positiveInteger(value, fallback) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }

  return Math.floor(number);
}

function normalizeMemoryKind(value) {
  return memoryKinds.has(value) ? value : "session_summary";
}

function formatMemoryToolResult(memories) {
  if (!memories.length) {
    return "没有找到相关记忆。";
  }

  return memories
    .map((memory, index) => {
      const label = [memory.scope, memory.kind].filter(Boolean).join("/");
      return `${index + 1}. ${label ? `[${label}] ` : ""}${memory.text}`;
    })
    .join("\n");
}

export function createMemoryReadTool({ memoryBackend, recallRequest }) {
  return {
    name: "memory_read",
    label: "Memory Read",
    description: "Search Cockapoo memory for relevant user, character, project, or session context.",
    promptSnippet: "memory_read - Search Cockapoo memory for relevant long-term or session context.",
    promptGuidelines: [
      "Use memory_read when the user asks about preferences, prior context, project background, or continuity."
    ],
    parameters: Type.Object({
      query: Type.Optional(Type.String({ description: "The memory search query. Defaults to the current user prompt." })),
      maxResults: Type.Optional(Type.Number({ description: "Maximum number of memories to return." }))
    }),
    execute: async (_toolCallId, params = {}) => {
      if (!memoryBackend || !recallRequest) {
        return {
          content: [{ type: "text", text: "当前没有可用的 Cockapoo 记忆后端。" }],
          details: { memories: [] }
        };
      }

      const query = nonEmptyString(params.query) || recallRequest.query || "";
      const maxResults = positiveInteger(params.maxResults, recallRequest.maxResults ?? 5);
      const memories = await memoryBackend.recallForPrompt({
        ...recallRequest,
        query,
        maxResults
      });

      return {
        content: [{ type: "text", text: formatMemoryToolResult(memories) }],
        details: { memories }
      };
    }
  };
}

export function createMemoryWriteTool({ memoryBackend, recallRequest, requiresApproval = false }) {
  return {
    name: "memory_write",
    label: "Memory Write",
    description: "Save an explicit, non-sensitive Cockapoo memory through the active memory backend.",
    promptSnippet: "memory_write - Save explicit long-term or session memory after checking privacy and approval rules.",
    promptGuidelines: [
      "Use memory_write only for durable preferences, project context, session summaries, or user-approved facts.",
      "Do not save secrets, credentials, medical diagnoses, or other sensitive data.",
      "If the memory is inferred or relationship/profile related, ask for user confirmation first."
    ],
    parameters: Type.Object({
      text: Type.String({ description: "The memory text to save." }),
      kind: Type.Optional(Type.String({ description: "One of preference, project_note, session_summary, profile_fact, relationship_note." })),
      reason: Type.Optional(Type.String({ description: "Why this memory should be saved." })),
      inferred: Type.Optional(Type.Boolean({ description: "True when the memory is inferred rather than explicitly stated." })),
      approved: Type.Optional(Type.Boolean({ description: "True only after the user has explicitly approved this memory." }))
    }),
    execute: async (_toolCallId, params = {}) => {
      if (!memoryBackend || !recallRequest) {
        return {
          content: [{ type: "text", text: "当前没有可用的 Cockapoo 记忆后端，无法保存记忆。" }],
          details: { status: "unavailable" }
        };
      }

      const text = nonEmptyString(params.text);
      const kind = normalizeMemoryKind(params.kind);
      const decision = classifyMemoryCandidate({
        kind,
        text,
        inferred: params.inferred === true
      });

      if (decision.action === "reject") {
        return {
          content: [{ type: "text", text: `未保存记忆：${decision.reason}` }],
          details: { status: "rejected", reason: decision.reason }
        };
      }

      if (requiresApproval && params.approved !== true) {
        return {
          content: [{ type: "text", text: "需要用户确认后再保存：当前工具策略要求 memory.write 先确认。" }],
          details: { status: "needs_approval", reason: "当前工具策略要求 memory.write 先确认。" }
        };
      }

      if (decision.action === "requires_approval" && params.approved !== true) {
        return {
          content: [{ type: "text", text: `需要用户确认后再保存：${decision.reason}` }],
          details: { status: "needs_approval", reason: decision.reason }
        };
      }

      const createdAt = new Date().toISOString();
      const reason = nonEmptyString(params.reason) || decision.reason;

      await memoryBackend.captureConversationTurn({
        userId: recallRequest.userId,
        characterId: recallRequest.characterId,
        projectId: recallRequest.projectId,
        sessionId: recallRequest.sessionId || `memory-write-${createdAt}`,
        userText: text,
        assistantText: `记忆写入工具保存了 ${kind}。原因：${reason}`,
        createdAt
      });

      return {
        content: [{ type: "text", text: "已保存记忆。" }],
        details: {
          status: "saved",
          kind,
          text,
          reason
        }
      };
    }
  };
}

function normalizeBrowserSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return null;
  }

  const currentUrl = normalizeBrowserUrl(snapshot.currentUrl);
  if (!currentUrl) {
    return null;
  }

  return {
    currentUrl,
    title: nonEmptyString(snapshot.title),
    status: nonEmptyString(snapshot.status) || "unknown"
  };
}

export function createBrowserViewTool({ browserSnapshot, onBrowserEvent } = {}) {
  return {
    name: "browser_view",
    label: "Browser View",
    description: "Open a public URL in Cockapoo's read-only right-side browser panel or report the current panel metadata.",
    promptSnippet: "browser_view - Open a source URL in the right-side browser panel or inspect its current URL/title metadata.",
    promptGuidelines: [
      "Use browser_view when a source should be visible to the user in the right-side browser panel.",
      "Pass url for pages you want opened visually; use fetch_content for page text extraction.",
      "browser_view never clicks, types, submits forms, or reads cross-origin DOM content."
    ],
    parameters: Type.Object({
      url: Type.Optional(Type.String({ description: "HTTP(S) URL to open in the right-side browser panel." })),
      title: Type.Optional(Type.String({ description: "Optional short title for the page being opened." })),
      reason: Type.Optional(Type.String({ description: "Why this source should be opened for the user." }))
    }),
    execute: async (_toolCallId, params = {}) => {
      const url = normalizeBrowserUrl(params.url);

      if (url) {
        const event = {
          action: "open",
          url,
          source: "agent",
          ...(nonEmptyString(params.title) ? { title: nonEmptyString(params.title) } : {}),
          ...(nonEmptyString(params.reason) ? { reason: nonEmptyString(params.reason) } : {})
        };

        onBrowserEvent?.(event);

        return {
          content: [{ type: "text", text: `已请求在右侧浏览器打开：${url}` }],
          details: {
            status: "open_requested",
            url
          }
        };
      }

      const snapshot = normalizeBrowserSnapshot(browserSnapshot);
      if (!snapshot) {
        return {
          content: [{ type: "text", text: "右侧浏览器当前没有打开页面。传入 url 可以打开公开来源。" }],
          details: { status: "empty" }
        };
      }

      const label = snapshot.title ? `${snapshot.title} - ${snapshot.currentUrl}` : snapshot.currentUrl;
      return {
        content: [{ type: "text", text: `右侧浏览器当前页面：${label}` }],
        details: {
          status: "snapshot",
          currentUrl: snapshot.currentUrl,
          title: snapshot.title,
          pageStatus: snapshot.status
        }
      };
    }
  };
}

// 与 Rust 端 lib.rs 的 parse_hm 一致："HH:MM"（24 小时制），首个冒号切分、两侧
// 都是非负整数、时 <24 分 <60。
function isValidHm(spec) {
  const idx = spec.indexOf(":");
  if (idx === -1) {
    return false;
  }
  const hour = spec.slice(0, idx).trim();
  const minute = spec.slice(idx + 1).trim();
  if (!/^\d+$/.test(hour) || !/^\d+$/.test(minute)) {
    return false;
  }
  return Number(hour) < 24 && Number(minute) < 60;
}

// 与 Rust 端 lib.rs 的 validate_schedule 保持一致：daily/weekdays 用 'HH:MM'，
// weekly 用 '日号,日号@HH:MM'（0=周日，至少一个合法日号），once 用本地时间
// 'YYYY-MM-DDTHH:MM'。Rust 端校验失败只会静默丢弃登记，而模型此刻已经口头答应
// 了用户，所以必须在工具里先拦下来、让模型修正后重试。
export function isValidScheduleSpec(scheduleKind, scheduleSpec) {
  if (scheduleKind === "daily" || scheduleKind === "weekdays") {
    return isValidHm(scheduleSpec.trim());
  }

  if (scheduleKind === "weekly") {
    const idx = scheduleSpec.indexOf("@");
    if (idx === -1) {
      return false;
    }
    const days = scheduleSpec.slice(0, idx);
    const hm = scheduleSpec.slice(idx + 1);
    return (
      isValidHm(hm.trim()) &&
      days.split(",").some((value) => /^\d+$/.test(value.trim()) && Number(value.trim()) < 7)
    );
  }

  if (scheduleKind === "once") {
    const match = scheduleSpec.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})T(\d{1,2}):(\d{1,2})$/);
    if (!match) {
      return false;
    }
    const [, year, month, day, hour, minute] = match.map(Number);
    if (month < 1 || month > 12 || hour > 23 || minute > 59) {
      return false;
    }
    const daysInMonth = new Date(year, month, 0).getDate();
    return day >= 1 && day <= daysInMonth;
  }

  return false;
}

// schedule_create lets the character register a scheduled task straight from
// chat ("每晚8点帮我总结"). It never touches the DB itself — it emits the task
// back to the Rust parent via onScheduleUpsert, which persists it (source=agent)
// and the in-process scheduler runs it at the chosen time. Only registered in
// streaming chats (onScheduleUpsert present), never in unattended scheduled runs.
export function createScheduleCreateTool({ onScheduleUpsert, now } = {}) {
  const nowLabel = nonEmptyString(now) || new Date().toString();
  const validKinds = new Set(["daily", "weekdays", "weekly", "once"]);
  return {
    name: "schedule_create",
    label: "Schedule Create",
    description:
      "登记一个定时任务：当用户要求你在未来某时间、或每天/每周某时定期帮他做某事时调用。登记后系统会到点自动以你的身份执行并推送结果。",
    promptSnippet: "schedule_create - 登记一个到点自动执行的定时任务。",
    promptGuidelines: [
      `当前本地时间：${nowLabel}。涉及 once 的相对日期（如「明天」）据此换算。`,
      "scheduleKind 取值：daily(每天)、weekdays(周一至周五)、weekly(每周指定几天)、once(指定某一刻一次)。",
      "scheduleSpec 格式：daily/weekdays 用 'HH:MM'(24 小时制)；weekly 用 '日号,日号@HH:MM'，其中 0=周日,1=周一,…,6=周六，例如周一三五晚八点是 '1,3,5@20:00'；once 用本地时间 'YYYY-MM-DDTHH:MM'。",
      "prompt 字段写给未来执行时的你自己，用第二人称完整描述要做的事。",
      "登记成功后用 confirmText 自然地口头告诉用户你已安排好。"
    ],
    parameters: Type.Object({
      title: Type.String({ description: "简短任务名，如『每晚工作总结』" }),
      prompt: Type.String({ description: "到点要执行的完整指令（写给未来的你自己）" }),
      scheduleKind: Type.String({ description: "daily | weekdays | weekly | once" }),
      scheduleSpec: Type.String({ description: "见 guidelines 的格式说明" }),
      confirmText: Type.Optional(Type.String({ description: "给用户的口头确认，如『好的，我每晚8点帮你总结～』" }))
    }),
    execute: async (_toolCallId, params = {}) => {
      const title = nonEmptyString(params.title);
      const prompt = nonEmptyString(params.prompt);
      const scheduleKind = nonEmptyString(params.scheduleKind);
      const scheduleSpec = nonEmptyString(params.scheduleSpec);

      if (!title || !prompt || !scheduleKind || !scheduleSpec) {
        return {
          content: [{ type: "text", text: "登记失败：title、prompt、scheduleKind、scheduleSpec 都必填。" }],
          details: { status: "invalid" }
        };
      }
      if (!validKinds.has(scheduleKind)) {
        return {
          content: [
            { type: "text", text: `登记失败：scheduleKind 只能是 daily/weekdays/weekly/once，收到「${scheduleKind}」。` }
          ],
          details: { status: "invalid" }
        };
      }
      if (!isValidScheduleSpec(scheduleKind, scheduleSpec)) {
        return {
          content: [
            {
              type: "text",
              text: `登记失败：scheduleSpec「${scheduleSpec}」不符合 ${scheduleKind} 的格式（daily/weekdays 用 'HH:MM'；weekly 用 '日号,日号@HH:MM'，0=周日；once 用 'YYYY-MM-DDTHH:MM'）。请修正后重试。`
            }
          ],
          details: { status: "invalid" }
        };
      }

      onScheduleUpsert?.({ title, prompt, scheduleKind, scheduleSpec });

      const confirm = nonEmptyString(params.confirmText) || `好的，我已经把「${title}」安排好了。`;
      return {
        content: [{ type: "text", text: confirm }],
        details: { status: "scheduled", task: { title, scheduleKind, scheduleSpec } }
      };
    }
  };
}

function describeScheduledTask(task) {
  const state = task.enabled === false ? "（已暂停）" : "";
  return `- [${task.id}] ${task.title}（${task.scheduleKind} ${task.scheduleSpec}）${state}`;
}

// schedule_list lets the character report / look up the tasks it has registered
// (it needs the ids before it can cancel one). The list is injected by the Rust
// parent (scheduledTasks), so the tool just formats what's already in hand.
export function createScheduleListTool({ scheduledTasks = [] } = {}) {
  return {
    name: "schedule_list",
    label: "Schedule List",
    description: "列出你当前已登记的定时任务（含 id）。用于回答用户「你帮我设了哪些定时任务」，或在取消前查到任务 id。",
    promptSnippet: "schedule_list - 列出已登记的定时任务及其 id。",
    promptGuidelines: ["取消任务前先用 schedule_list 拿到准确的 taskId。"],
    parameters: Type.Object({}),
    execute: async () => {
      if (!scheduledTasks.length) {
        return {
          content: [{ type: "text", text: "你当前没有已登记的定时任务。" }],
          details: { tasks: [] }
        };
      }
      const text = `你已登记的定时任务：\n${scheduledTasks.map(describeScheduledTask).join("\n")}`;
      return { content: [{ type: "text", text }], details: { tasks: scheduledTasks } };
    }
  };
}

// schedule_cancel removes a task the character registered. Like schedule_create
// it never touches the DB — it emits the id to the Rust parent, which deletes it
// (only if it belongs to this character). taskId must come from schedule_list.
export function createScheduleCancelTool({ onScheduleCancel, scheduledTasks = [] } = {}) {
  return {
    name: "schedule_cancel",
    label: "Schedule Cancel",
    description: "取消（删除）一个你已登记的定时任务。先用 schedule_list 查到 taskId，再调用本工具。",
    promptSnippet: "schedule_cancel - 按 id 取消一个已登记的定时任务。",
    promptGuidelines: ["taskId 必须来自 schedule_list，不要凭空编造。"],
    parameters: Type.Object({
      taskId: Type.String({ description: "要取消的任务 id（来自 schedule_list）" })
    }),
    execute: async (_toolCallId, params = {}) => {
      const taskId = nonEmptyString(params.taskId);
      const match = scheduledTasks.find((task) => task.id === taskId);
      if (!taskId || !match) {
        return {
          content: [{ type: "text", text: `没找到 id 为「${taskId}」的任务，请先用 schedule_list 查看现有任务。` }],
          details: { status: "not_found" }
        };
      }
      onScheduleCancel?.(taskId);
      return {
        content: [{ type: "text", text: `已取消定时任务「${match.title}」。` }],
        details: { status: "cancelled", taskId }
      };
    }
  };
}

// The single tool pi-subagents registers on the parent for delegation
// (chain/parallel are parameters of it, not separate tools).
export const subagentToolName = "subagent";

// Merge the tools the active character's skills require into the policy settings.
// Only ids in skillGrantableToolIds take effect (so a skill can never grant
// bash/edit/write), and we flip the matching customTools toggle on so the tool
// is both registered and allowed by the gate — exactly as if the user had
// enabled it in settings. Returns the original settings when nothing applies.
export function mergeSkillRequiredTools(settings, skillRequiredTools = []) {
  const grant = new Set(skillGrantableToolIds);
  const toAdd = (Array.isArray(skillRequiredTools) ? skillRequiredTools : []).filter((tool) =>
    grant.has(tool)
  );
  if (toAdd.length === 0) {
    return settings;
  }

  const customTools = { ...(settings.customTools ?? {}) };
  for (const tool of toAdd) {
    customTools[tool] = true;
  }
  return { ...settings, customTools };
}

export function buildToolRuntime({
  settings = defaultToolPolicySettings,
  memoryBackend,
  memoryRecallRequest,
  browserSnapshot,
  onBrowserEvent,
  onScheduleUpsert,
  onScheduleCancel,
  scheduledTasks = [],
  scheduleNow,
  enableSubagents = false,
  skillRequiredTools = []
} = {}) {
  const resolved = resolveToolPolicy({
    settings: mergeSkillRequiredTools(settings, skillRequiredTools)
  });
  const customTools = [];
  const registeredCustomTools = [];
  const unsupportedCustomTools = [];

  for (const toolId of resolved.customTools) {
    if (toolId === "memory.read") {
      if (memoryBackend && memoryRecallRequest) {
        customTools.push(createMemoryReadTool({ memoryBackend, recallRequest: memoryRecallRequest }));
        registeredCustomTools.push(toolId);
      }
      continue;
    }

    if (toolId === "memory.write") {
      if (memoryBackend && memoryRecallRequest) {
        customTools.push(createMemoryWriteTool({
          memoryBackend,
          recallRequest: memoryRecallRequest,
          requiresApproval: resolved.alwaysConfirm.includes("memory.write")
        }));
        registeredCustomTools.push(toolId);
      }
      continue;
    }

    if (toolId === "web.fetch" || toolId === "web.search") {
      registeredCustomTools.push(toolId);
      continue;
    }

    if (toolId === "browser.view") {
      customTools.push(createBrowserViewTool({ browserSnapshot, onBrowserEvent }));
      registeredCustomTools.push(toolId);
      continue;
    }

    unsupportedCustomTools.push(toolId);
  }

  // schedule_* tools are always available in chat (not gated by user settings),
  // but only when a sink to persist them exists — i.e. a streaming chat run.
  // schedule.create expands to create + list + cancel via supportedCustomToolNames.
  if (onScheduleUpsert) {
    customTools.push(createScheduleCreateTool({ onScheduleUpsert, now: scheduleNow }));
    customTools.push(createScheduleListTool({ scheduledTasks }));
    customTools.push(createScheduleCancelTool({ onScheduleCancel, scheduledTasks }));
    registeredCustomTools.push("schedule.create");
  }

  const customToolNames = registeredCustomTools.flatMap((toolId) => {
    const toolNames = supportedCustomToolNames[toolId];
    return Array.isArray(toolNames) ? toolNames : [toolNames];
  });
  // Opt-in: declare + allow the delegation tool so the parent gate permits it.
  // The child's own bash/edit/write are gated separately inside the child.
  const subagentTools = enableSubagents ? [subagentToolName] : [];
  const tools = [...resolved.builtinTools, ...customToolNames, ...subagentTools];
  const effectiveToolPolicy = {
    ...resolved,
    customTools: registeredCustomTools,
    allowedTools: [...resolved.builtinTools, ...registeredCustomTools]
  };

  // Translate the policy into the Pi tool names the tool_call hook sees, so the
  // gate extension can evaluate concrete calls without knowing Cockapoo tool ids.
  const confirmToolNames = resolved.alwaysConfirm
    .flatMap((toolId) => {
      if (!toolId.includes(".")) {
        return [toolId];
      }

      const toolNames = supportedCustomToolNames[toolId];
      return Array.isArray(toolNames) ? toolNames : [toolNames];
    })
    .filter((name) => name && tools.includes(name));
  const gatePolicy = {
    allowedToolNames: tools,
    confirmToolNames,
    protectedPaths: resolved.protectedPaths
  };

  return {
    tools,
    customTools,
    toolPolicy: effectiveToolPolicy,
    gatePolicy,
    summary: {
      enabledTools: effectiveToolPolicy.allowedTools,
      registeredCustomTools,
      unsupportedCustomTools,
      alwaysConfirm: resolved.alwaysConfirm,
      protectedPaths: resolved.protectedPaths
    }
  };
}
