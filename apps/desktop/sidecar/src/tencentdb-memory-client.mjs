import os from "node:os";
import path from "node:path";

import { createGatewayManager } from "./tencentdb-gateway-manager.mjs";

const toolsGuidePattern = /<memory-tools-guide>[\s\S]*?<\/memory-tools-guide>/g;

function noopLogger() {
  return { debug() {}, info() {}, warn() {}, error() {} };
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function defaultRootDataDir() {
  return path.join(os.homedir(), ".memory-tencentdb", "irori");
}

function sessionKeyFor(characterId, sessionId) {
  return `${characterId}::${sessionId ?? "default"}`;
}

/**
 * The gateway's /recall returns only persona/scene context (appendSystemContext),
 * which is useful but ends with a tools-usage guide for tools irori's agent
 * doesn't expose. Strip that block before injecting.
 */
function cleanPersonaContext(context) {
  if (!nonEmptyString(context)) {
    return "";
  }
  return context.replace(toolsGuidePattern, "").trim();
}

async function postJson(fetchImpl, baseUrl, route, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`TDAI gateway ${route} responded ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Adapts the @tencentdb-agent-memory/memory-tencentdb engine (exposed only as
 * an HTTP gateway) to irori's TencentDbMemoryClient contract, with one
 * gateway — and thus one isolated memory store — per character.
 */
export function createTencentDbMemoryClient(options = {}) {
  const {
    rootDataDir = defaultRootDataDir(),
    llm,
    requestTimeoutMs = 8_000,
    fetchImpl = globalThis.fetch,
    logger = noopLogger(),
    // Test seam: inject a manager (or anything with getBaseUrl) directly.
    gatewayManager
  } = options;

  if (typeof fetchImpl !== "function") {
    throw new Error("createTencentDbMemoryClient requires a fetch implementation.");
  }

  const manager =
    gatewayManager ??
    createGatewayManager({ rootDataDir, llm, fetchImpl, logger });

  function rowFromText(text, characterId, kind) {
    return {
      text,
      scope: "character",
      kind,
      characterId,
      sourceRef: `character:${characterId}`,
      approved: true
    };
  }

  return {
    async captureConversationTurn(turn) {
      if (!turn?.characterId || (!nonEmptyString(turn.userText) && !nonEmptyString(turn.assistantText))) {
        return;
      }

      try {
        const baseUrl = await manager.getBaseUrl(turn.characterId);
        await postJson(
          fetchImpl,
          baseUrl,
          "/capture",
          {
            user_content: turn.userText ?? "",
            assistant_content: turn.assistantText ?? "",
            session_key: sessionKeyFor(turn.characterId, turn.sessionId),
            session_id: turn.sessionId
          },
          requestTimeoutMs
        );
      } catch (error) {
        // Memory capture must never break the chat turn.
        logger.warn?.(`[tdai-client] capture failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },

    async recallForPrompt(request) {
      if (!request?.characterId || !nonEmptyString(request.query)) {
        return [];
      }

      const characterId = request.characterId;
      const limit = request.maxResults ?? 5;
      const sessionKey = sessionKeyFor(characterId, request.sessionId);

      let baseUrl;
      try {
        baseUrl = await manager.getBaseUrl(characterId);
      } catch (error) {
        logger.warn?.(`[tdai-client] gateway unavailable: ${error instanceof Error ? error.message : String(error)}`);
        return [];
      }

      const rows = [];

      // 1. Structured L1 memories — the real recalled long-term memory.
      try {
        const memories = await postJson(
          fetchImpl,
          baseUrl,
          "/search/memories",
          { query: request.query, limit },
          requestTimeoutMs
        );
        if ((memories?.total ?? 0) > 0 && nonEmptyString(memories?.results)) {
          rows.push(rowFromText(memories.results.trim(), characterId, "relationship_note"));
        }
      } catch (error) {
        logger.warn?.(`[tdai-client] search/memories failed: ${error instanceof Error ? error.message : String(error)}`);
      }

      // 2. Persona / scene context (L2/L3).
      try {
        const recall = await postJson(
          fetchImpl,
          baseUrl,
          "/recall",
          { query: request.query, session_key: sessionKey },
          requestTimeoutMs
        );
        const persona = cleanPersonaContext(recall?.context);
        if (persona) {
          rows.push(rowFromText(persona, characterId, "profile_fact"));
        }
      } catch (error) {
        logger.warn?.(`[tdai-client] recall failed: ${error instanceof Error ? error.message : String(error)}`);
      }

      // 3. Degraded fallback: when no LLM has extracted L1 yet, surface raw L0
      //    conversation history so the character still has continuity.
      if (rows.length === 0) {
        try {
          const conversations = await postJson(
            fetchImpl,
            baseUrl,
            "/search/conversations",
            { query: request.query, session_key: sessionKey, limit },
            requestTimeoutMs
          );
          if ((conversations?.total ?? 0) > 0 && nonEmptyString(conversations?.results)) {
            rows.push(rowFromText(conversations.results.trim(), characterId, "session_summary"));
          }
        } catch (error) {
          logger.warn?.(`[tdai-client] search/conversations failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      return rows;
    },

    async listMemories(scope, ownerId) {
      // The gateway has no list-all endpoint; only query-driven search. The
      // memory dashboard's broad listing is therefore not supported here.
      void scope;
      void ownerId;
      return [];
    },

    async deleteMemory(id) {
      // The gateway exposes no delete endpoint; deletion is owned by the engine.
      void id;
    }
  };
}

export { createTencentDbMemoryClient as createMemoryClient };
