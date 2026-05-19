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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function stringFrom(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  return undefined;
}

function booleanFrom(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  return undefined;
}

function numberFrom(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function normalizeScope(value: unknown): MemoryScope {
  const scope = stringFrom(value)?.toLowerCase();

  if (scope && memoryScopes.has(scope as MemoryScope)) {
    return scope as MemoryScope;
  }

  return "session";
}

function normalizeKind(value: unknown): MemoryKind {
  const kind = stringFrom(value)?.toLowerCase();

  if (!kind) {
    return "session_summary";
  }

  if (memoryKinds.has(kind as MemoryKind)) {
    return kind as MemoryKind;
  }

  if (kind === "summary" || kind === "conversation_summary") {
    return "session_summary";
  }

  if (kind === "relationship" || kind === "persona_note") {
    return "relationship_note";
  }

  if (kind === "fact" || kind === "profile") {
    return "profile_fact";
  }

  return "session_summary";
}

function metadataFrom(row: Record<string, unknown>): Record<string, unknown> {
  return asRecord(row.metadata) ?? {};
}

export function normalizeTencentDbMemory(row: unknown): RecalledMemory | null {
  const record = asRecord(row);

  if (!record) {
    return null;
  }

  const metadata = metadataFrom(record);
  const text = stringFrom(record.text) ?? stringFrom(record.content) ?? stringFrom(record.memory);

  if (!text) {
    return null;
  }

  const id =
    stringFrom(record.id) ??
    stringFrom(record.memory_id) ??
    stringFrom(record.memoryId) ??
    `tencentdb-memory-${text.slice(0, 32)}`;
  const confidence = numberFrom(record.confidence) ?? numberFrom(record.score);
  const sourceRef =
    stringFrom(record.sourceRef) ??
    stringFrom(record.source) ??
    stringFrom(metadata.sourceRef) ??
    stringFrom(metadata.source);
  const approved = booleanFrom(record.approved) ?? booleanFrom(metadata.approved);
  const memory: RecalledMemory = {
    id,
    scope: normalizeScope(record.scope ?? record.layer),
    kind: normalizeKind(record.kind ?? record.memoryType ?? record.type),
    text
  };

  if (confidence !== undefined) {
    memory.confidence = confidence;
  }

  if (sourceRef !== undefined) {
    memory.sourceRef = sourceRef;
  }

  if (approved !== undefined) {
    memory.approved = approved;
  }

  return memory;
}

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

      return (rows ?? [])
        .map(normalizeTencentDbMemory)
        .filter((memory): memory is RecalledMemory => memory !== null);
    },
    async listMemories(scope, ownerId) {
      const rows = await client.listMemories?.(scope, ownerId);

      return (rows ?? [])
        .map(normalizeTencentDbMemory)
        .filter((memory): memory is RecalledMemory => memory !== null);
    },
    async deleteMemory(id) {
      await client.deleteMemory?.(id);
    }
  };
}
