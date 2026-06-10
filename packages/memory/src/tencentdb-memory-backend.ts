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

function ownerFrom(record: Record<string, unknown>, metadata: Record<string, unknown>, key: string) {
  return stringFrom(record[key]) ?? stringFrom(metadata[key]);
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

  const userId = ownerFrom(record, metadata, "userId");
  const characterId = ownerFrom(record, metadata, "characterId");
  const projectId = ownerFrom(record, metadata, "projectId");
  const sessionId = ownerFrom(record, metadata, "sessionId");

  if (userId !== undefined) {
    memory.userId = userId;
  }

  if (characterId !== undefined) {
    memory.characterId = characterId;
  }

  if (projectId !== undefined) {
    memory.projectId = projectId;
  }

  if (sessionId !== undefined) {
    memory.sessionId = sessionId;
  }

  if (approved !== undefined) {
    memory.approved = approved;
  }

  return memory;
}

function ownerMatches(value: string | undefined, expected: string | undefined) {
  return Boolean(value && expected && value === expected);
}

function sourceMatches(sourceRef: string | undefined, expected: string | undefined, prefix: string) {
  if (!sourceRef || !expected) {
    return false;
  }

  return sourceRef === expected || sourceRef === `${prefix}:${expected}` || sourceRef.startsWith(`${expected}/`);
}

function hasNoOwner(memory: RecalledMemory) {
  return !memory.userId && !memory.characterId && !memory.projectId && !memory.sessionId && !memory.sourceRef;
}

function belongsToRecallRequest(memory: RecalledMemory, request: MemoryRecallRequest) {
  if (memory.scope === "user") {
    return (
      ownerMatches(memory.userId, request.userId) ||
      sourceMatches(memory.sourceRef, request.userId, "user") ||
      hasNoOwner(memory)
    );
  }

  if (memory.scope === "character") {
    return (
      ownerMatches(memory.characterId, request.characterId) ||
      sourceMatches(memory.sourceRef, request.characterId, "character")
    );
  }

  if (memory.scope === "project") {
    return (
      ownerMatches(memory.projectId, request.projectId) ||
      sourceMatches(memory.sourceRef, request.projectId, "project")
    );
  }

  if (memory.scope === "session") {
    const sessionMatches =
      ownerMatches(memory.sessionId, request.sessionId) ||
      sourceMatches(memory.sourceRef, request.sessionId, "session");
    const characterMatches = !memory.characterId || memory.characterId === request.characterId;

    return (sessionMatches || hasNoOwner(memory)) && characterMatches;
  }

  return false;
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
        .filter((memory): memory is RecalledMemory => memory !== null)
        .filter((memory) => belongsToRecallRequest(memory, request));
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
