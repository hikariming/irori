import { invoke } from "@tauri-apps/api/core";

import {
  buildInitialModelSettings,
  isModelConfigured,
  markTokenSaved,
  mergeSavedModelSettings,
  type ModelSettingsState,
  type SavedModelSettings
} from "./model-settings-controller.ts";
import {
  parseStoredTimestamp,
  type AppendChatMessageRequest,
  type ChatSessionDetail,
  type ChatSessionSummary,
  type CreateChatSessionRequest
} from "./chat-history-model.ts";
import { buildCharacterChatPreview, type ChatMessage } from "./chat-model.ts";
import type { ComposerMode } from "./input-model.ts";

export type SaveModelSettingsRequest = {
  baseUrl: string;
  modelName: string;
  token?: string;
};

export type SendPiPromptRequest = {
  characterId: string;
  mode: ComposerMode;
  prompt: string;
  sessionId?: string;
  sessionPrompt?: string;
};

export type PiPromptResponse = {
  modelRoute: string;
  providerId: string;
  text: string;
};

const previewRuntimeMessage = "浏览器预览不会调用真实 LLM。请在 Tauri 桌面客户端里运行并发送消息，那里会通过 Rust command 调用 local-agent / Pi。";

export type DesktopBackend = {
  appendChatMessage: (request: AppendChatMessageRequest) => Promise<ChatMessage>;
  createChatSession: (request: CreateChatSessionRequest) => Promise<ChatSessionSummary>;
  getChatSession: (sessionId: string) => Promise<ChatSessionDetail>;
  listChatSessions: () => Promise<ChatSessionSummary[]>;
  loadModelSettings: () => Promise<ModelSettingsState>;
  saveModelSettings: (request: SaveModelSettingsRequest) => Promise<ModelSettingsState>;
  sendPiPrompt: (request: SendPiPromptRequest) => Promise<PiPromptResponse>;
  testModelConnection: () => Promise<PiPromptResponse>;
};

type StoredChatMessageRecord = {
  id: string;
  sessionId: string;
  speaker: ChatMessage["speaker"];
  author: string;
  text: string;
  mode?: ChatMessage["mode"];
  stickerId?: string;
  modelRoute?: string;
  providerId?: string;
  createdAt: string;
};

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function messageTimeFromDate(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function previewId(prefix: string) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function chatMessageFromRecord(record: StoredChatMessageRecord): ChatMessage {
  const preview = buildCharacterChatPreview();
  const sticker = record.stickerId
    ? preview.stickers.find((item) => item.id === record.stickerId)
    : undefined;

  return {
    id: record.id,
    speaker: record.speaker,
    author: record.author,
    text: record.text,
    time: messageTimeFromDate(parseStoredTimestamp(record.createdAt)),
    mode: record.mode,
    sticker
  };
}

export function createPreviewBackend(): DesktopBackend {
  let savedSettings: SavedModelSettings | null = null;
  let state = buildInitialModelSettings();
  const sessions: ChatSessionSummary[] = [];
  const messagesBySession = new Map<string, StoredChatMessageRecord[]>();

  return {
    async appendChatMessage(request) {
      const messages = messagesBySession.get(request.sessionId);

      if (!messages) {
        throw new Error("对话不存在，无法保存消息。");
      }

      const createdAt = new Date().toISOString();
      const record: StoredChatMessageRecord = {
        id: previewId("message"),
        sessionId: request.sessionId,
        speaker: request.speaker,
        author: request.author,
        text: request.text,
        mode: request.mode,
        stickerId: request.stickerId,
        modelRoute: request.modelRoute,
        providerId: request.providerId,
        createdAt
      };
      messages.push(record);

      const session = sessions.find((item) => item.id === request.sessionId);
      if (session) {
        session.updatedAt = createdAt;
        session.lastMessagePreview = request.text;
      }

      return chatMessageFromRecord(record);
    },
    async createChatSession(request) {
      const now = new Date().toISOString();
      const session: ChatSessionSummary = {
        id: previewId("session"),
        characterId: request.characterId,
        title: request.title,
        updatedAt: now,
        lastMessagePreview: ""
      };
      sessions.unshift(session);
      messagesBySession.set(session.id, []);

      return session;
    },
    async getChatSession(sessionId) {
      const session = sessions.find((item) => item.id === sessionId);

      if (!session) {
        throw new Error("对话不存在。");
      }

      return {
        session,
        messages: (messagesBySession.get(sessionId) ?? []).map(chatMessageFromRecord)
      };
    },
    async listChatSessions() {
      return [...sessions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    },
    async loadModelSettings() {
      state = mergeSavedModelSettings(buildInitialModelSettings(), savedSettings);
      return state;
    },
    async saveModelSettings(request) {
      state = {
        ...state,
        baseUrl: request.baseUrl,
        modelName: request.modelName
      };

      if (request.token) {
        state = markTokenSaved(state, request.token);
      }

      savedSettings = state;

      return state;
    },
    async sendPiPrompt() {
      if (!isModelConfigured(state)) {
        throw new Error("请先在模型供应商里保存 Token。");
      }

      throw new Error(previewRuntimeMessage);
    },
    async testModelConnection() {
      if (!isModelConfigured(state)) {
        throw new Error("请先在模型供应商里保存 Token。");
      }

      throw new Error(previewRuntimeMessage);
    }
  };
}

export function createTauriBackend(): DesktopBackend {
  return {
    async appendChatMessage(request) {
      const record = await invoke<StoredChatMessageRecord>("append_chat_message", { request });
      return chatMessageFromRecord(record);
    },
    async createChatSession(request) {
      return invoke<ChatSessionSummary>("create_chat_session", { request });
    },
    async getChatSession(sessionId) {
      const detail = await invoke<{ session: ChatSessionSummary; messages: StoredChatMessageRecord[] }>("get_chat_session", { sessionId });

      return {
        session: detail.session,
        messages: detail.messages.map(chatMessageFromRecord)
      };
    },
    async listChatSessions() {
      return invoke<ChatSessionSummary[]>("list_chat_sessions");
    },
    async loadModelSettings() {
      const saved = await invoke<SavedModelSettings>("get_model_settings");
      return mergeSavedModelSettings(buildInitialModelSettings(), saved);
    },
    async saveModelSettings(request) {
      const saved = await invoke<SavedModelSettings>("save_model_settings", { request });
      return mergeSavedModelSettings(buildInitialModelSettings(), saved);
    },
    async sendPiPrompt(request) {
      return invoke<PiPromptResponse>("send_pi_prompt", { request });
    },
    async testModelConnection() {
      return invoke<PiPromptResponse>("test_model_connection");
    }
  };
}

export const desktopBackend = isTauriRuntime() ? createTauriBackend() : createPreviewBackend();
