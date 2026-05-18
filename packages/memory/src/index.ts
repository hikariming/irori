export type MemoryScope = "user" | "character" | "project" | "session";

export type MemoryKind = "profile_fact" | "preference" | "relationship_note" | "project_note" | "session_summary";

export type CompanionMode = "companion" | "read" | "action" | "focus";

export type MemoryEntry = {
  id: string;
  kind: MemoryKind;
  text: string;
  sourceSessionId?: string;
  frozen: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MemoryRecallRequest = {
  userId: string;
  characterId: string;
  projectId?: string;
  sessionId?: string;
  query: string;
  mode: CompanionMode;
  maxResults?: number;
};

export type RecalledMemory = {
  id: string;
  scope: MemoryScope;
  kind: MemoryKind;
  text: string;
  confidence?: number;
  sourceRef?: string;
  approved?: boolean;
};

export type CapturedConversationTurn = {
  userId: string;
  characterId: string;
  projectId?: string;
  sessionId: string;
  userText: string;
  assistantText: string;
  createdAt: string;
};

export type MemoryBackend = {
  captureConversationTurn(turn: CapturedConversationTurn): Promise<void>;
  recallForPrompt(request: MemoryRecallRequest): Promise<RecalledMemory[]>;
  listMemories(scope: MemoryScope, ownerId: string): Promise<RecalledMemory[]>;
  deleteMemory(id: string): Promise<void>;
};

export const memoryKindLabels: Record<MemoryKind, string> = {
  profile_fact: "用户事实",
  preference: "偏好",
  relationship_note: "关系互动",
  project_note: "项目背景",
  session_summary: "会话摘要"
};

export const defaultMemoryConfig = {
  storeBackend: "sqlite",
  recall: {
    enabled: true,
    strategy: "hybrid",
    maxResults: 5,
    timeoutMs: 5000
  },
  pipeline: {
    everyNConversations: 5,
    enableWarmup: true
  },
  extraction: {
    enabled: true,
    maxMemoriesPerSession: 20,
    enableDedup: true
  },
  persona: {
    triggerEveryN: 50
  },
  offload: {
    enabled: false
  }
} as const;

export { classifyMemoryCandidate } from "./memory-policy.ts";
export type { MemoryCandidate, MemoryPolicyDecision } from "./memory-policy.ts";
export { formatMemoryContext } from "./prompt-memory-context.ts";
export { createInMemoryBackend } from "./in-memory-backend.ts";
