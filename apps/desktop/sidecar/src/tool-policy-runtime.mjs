import { Type } from "@earendil-works/pi-ai";

import {
  defaultToolPolicySettings,
  resolveToolPolicy
} from "../../../../packages/safety/src/runtime.mjs";
import { classifyMemoryCandidate } from "../../../../packages/memory/src/runtime.mjs";

const supportedCustomToolNames = {
  "memory.read": "memory_read",
  "memory.write": "memory_write"
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

export function buildToolRuntime({
  settings = defaultToolPolicySettings,
  memoryBackend,
  memoryRecallRequest
} = {}) {
  const resolved = resolveToolPolicy({ settings });
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

    unsupportedCustomTools.push(toolId);
  }

  const customToolNames = registeredCustomTools.map((toolId) => supportedCustomToolNames[toolId]);
  const tools = [...resolved.builtinTools, ...customToolNames];
  const effectiveToolPolicy = {
    ...resolved,
    customTools: registeredCustomTools,
    allowedTools: [...resolved.builtinTools, ...registeredCustomTools]
  };

  // Translate the policy into the Pi tool names the tool_call hook sees, so the
  // gate extension can evaluate concrete calls without knowing Cockapoo tool ids.
  const confirmToolNames = resolved.alwaysConfirm
    .map((toolId) => (toolId.includes(".") ? supportedCustomToolNames[toolId] : toolId))
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
