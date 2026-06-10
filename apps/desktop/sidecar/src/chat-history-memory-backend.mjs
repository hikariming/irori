function normalizeText(text = "") {
  return String(text).trim();
}

function tokenize(text) {
  return new Set(
    normalizeText(text)
      .toLowerCase()
      .split(/[^\p{Letter}\p{Number}]+/u)
      .filter(Boolean)
  );
}

function overlaps(query, text) {
  if (!query.trim()) {
    return true;
  }

  if (text.includes(query)) {
    return true;
  }

  const queryTokens = tokenize(query);
  const textTokens = tokenize(text);

  for (const token of queryTokens) {
    if (textTokens.has(token) || text.includes(token)) {
      return true;
    }
  }

  const queryCharacters = Array.from(query).filter((character) => /\p{Letter}|\p{Number}/u.test(character));
  const matchingCharacters = queryCharacters.filter((character) => text.includes(character)).length;

  return queryCharacters.length > 0 && matchingCharacters / queryCharacters.length >= 0.5;
}

function memoryFromMessage(sessionId, message) {
  return {
    id: `chat-history-${sessionId}-${message.id}`,
    scope: "session",
    kind: "session_summary",
    text: `${message.speaker === "user" ? "用户" : "助手"}：${normalizeText(message.text)}`,
    sourceRef: `${sessionId}/${message.id}`,
    approved: true
  };
}

export function createChatHistoryMemoryBackend({ sessionId, messages = [] }) {
  const memories = messages
    .filter((message) => message?.speaker !== "system")
    .filter((message) => normalizeText(message?.text))
    .map((message) => memoryFromMessage(sessionId, message));

  return {
    async captureConversationTurn() {
      // Chat history is already persisted by the desktop SQLite layer.
    },
    async recallForPrompt(request) {
      const maxResults = request.maxResults ?? 5;
      const matched = memories.filter((memory) => overlaps(request.query, memory.text));

      return (matched.length > 0 ? matched : memories).slice(-maxResults);
    },
    async listMemories(scope, ownerId) {
      return memories.filter((memory) => memory.scope === scope && memory.sourceRef?.startsWith(`${ownerId}/`));
    },
    async deleteMemory() {
      // This backend is a read-through view over chat history, so deletion is owned by chat history.
    }
  };
}
