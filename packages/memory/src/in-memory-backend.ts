import type {
  CapturedConversationTurn,
  MemoryBackend,
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
    sourceRef: `${turn.sessionId}/${turn.createdAt}`,
    approved: true
  };
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
