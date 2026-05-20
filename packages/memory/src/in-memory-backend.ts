import type {
  CapturedConversationTurn,
  MemoryBackend,
  MemoryRecallRequest,
  MemoryScope,
  RecalledMemory
} from "./index.ts";

function tokenize(text: string) {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{Letter}\p{Number}]+/u)
      .filter(Boolean)
  );
}

function overlaps(query: string, memory: RecalledMemory) {
  if (memory.text.includes(query)) {
    return true;
  }

  const queryTokens = tokenize(query);
  const memoryTokens = tokenize(memory.text);
  const queryCharacters = Array.from(query).filter((character) => /\p{Letter}|\p{Number}/u.test(character));
  let matchingCharacters = 0;

  if (queryTokens.size === 0) {
    return true;
  }

  for (const token of queryTokens) {
    if (memoryTokens.has(token) || memory.text.includes(token)) {
      return true;
    }
  }

  for (const character of queryCharacters) {
    if (memory.text.includes(character)) {
      matchingCharacters += 1;
    }
  }

  return queryCharacters.length > 0 && matchingCharacters / queryCharacters.length >= 0.5;
}

function summaryFromTurn(turn: CapturedConversationTurn): RecalledMemory {
  return {
    id: `session-summary-${turn.sessionId}-${turn.createdAt}`,
    scope: "session",
    kind: "session_summary",
    text: `用户：${turn.userText}\n助手：${turn.assistantText}`,
    userId: turn.userId,
    characterId: turn.characterId,
    projectId: turn.projectId,
    sessionId: turn.sessionId,
    sourceRef: `${turn.sessionId}/${turn.createdAt}`,
    approved: true
  };
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

    return sessionMatches && characterMatches;
  }

  return false;
}

export function createInMemoryBackend(seed: RecalledMemory[] = []): MemoryBackend {
  const memories = new Map<string, RecalledMemory>();

  for (const memory of seed) {
    memories.set(memory.id, memory);
  }

  return {
    async captureConversationTurn(turn) {
      const summary = summaryFromTurn(turn);
      memories.set(summary.id, summary);
    },
    async recallForPrompt(request) {
      const maxResults = request.maxResults ?? 5;

      return [...memories.values()]
        .filter((memory) => belongsToRecallRequest(memory, request))
        .filter((memory) => overlaps(request.query, memory))
        .slice(0, maxResults);
    },
    async listMemories(scope: MemoryScope, ownerId: string) {
      return [...memories.values()].filter((memory) => {
        if (memory.scope !== scope) {
          return false;
        }

        if (scope === "session") {
          return memory.sourceRef?.startsWith(`${ownerId}/`) ?? false;
        }

        return memory.sourceRef === ownerId || memory.id.includes(ownerId);
      });
    },
    async deleteMemory(id) {
      memories.delete(id);
    }
  };
}
