import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type { PiPromptProgressEvent } from "./assistant-progress-model.ts";
import {
  buildInitialModelSettings,
  deleteModelProfile as deleteSavedModelProfile,
  getActiveModelProfile,
  isModelConfigured,
  markTokenSaved,
  mergeSavedModelSettings,
  setActiveModelProfile as setSavedActiveModelProfile,
  upsertModelProfile,
  type ModelSettingsState,
  type SavedModelProfile,
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
import type { MemoryBackendSource, MemoryStatus, RecalledMemorySnapshot } from "./memory-status-model.ts";
import { defaultToolPolicySettings, type ToolPolicySettings } from "./tool-policy-model.ts";

export type SaveModelSettingsRequest = {
  profileId: string;
  name: string;
  baseUrl: string;
  modelName: string;
  token?: string;
  makeActive?: boolean;
};

export type TestModelConnectionRequest = {
  profileId: string;
  name: string;
  baseUrl: string;
  modelName: string;
  token?: string;
};

export type SendPiPromptRequest = {
  characterId: string;
  prompt: string;
  runId?: string;
  sessionId?: string;
  sessionPrompt?: string;
};

export type GenerateOpeningMessageRequest = {
  characterId: string;
  prompt: string;
  sessionId?: string;
};

export type PiPromptResponse = {
  memoryBackendSource?: MemoryBackendSource;
  modelRoute: string;
  providerId: string;
  recalledMemories?: RecalledMemorySnapshot[];
  text: string;
  toolPolicy?: {
    enabledTools: string[];
    registeredCustomTools: string[];
    unsupportedCustomTools: string[];
    alwaysConfirm: string[];
    protectedPaths: string[];
  };
};

const previewRuntimeMessage = "浏览器预览不会调用真实 LLM。请在 Tauri 桌面客户端里运行并发送消息，那里会通过 Rust command 调用 local-agent / Pi。";

export type DesktopBackend = {
  appendChatMessage: (request: AppendChatMessageRequest) => Promise<ChatMessage>;
  createChatSession: (request: CreateChatSessionRequest) => Promise<ChatSessionSummary>;
  deleteModelProfile: (profileId: string) => Promise<ModelSettingsState>;
  generateOpeningMessage: (request: GenerateOpeningMessageRequest) => Promise<PiPromptResponse>;
  getChatSession: (sessionId: string) => Promise<ChatSessionDetail>;
  getMemoryStatus: () => Promise<MemoryStatus>;
  getToolPolicySettings: () => Promise<ToolPolicySettings>;
  listChatSessions: () => Promise<ChatSessionSummary[]>;
  loadModelSettings: () => Promise<ModelSettingsState>;
  onPiPromptProgress: (callback: (event: PiPromptProgressEvent) => void) => Promise<() => void>;
  saveModelSettings: (request: SaveModelSettingsRequest) => Promise<ModelSettingsState>;
  saveToolPolicySettings: (settings: ToolPolicySettings) => Promise<ToolPolicySettings>;
  sendPiPrompt: (request: SendPiPromptRequest) => Promise<PiPromptResponse>;
  setActiveModelProfile: (profileId: string) => Promise<ModelSettingsState>;
  testModelConnection: (request?: TestModelConnectionRequest) => Promise<PiPromptResponse>;
};

type StoredChatMessageRecord = {
  id: string;
  sessionId: string;
  speaker: ChatMessage["speaker"];
  author: string;
  text: string;
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

function chatMessageFromRecord(record: StoredChatMessageRecord, characterId = "shili"): ChatMessage {
  const preview = buildCharacterChatPreview(characterId);
  const sticker = record.stickerId
    ? preview.stickers.find((item) => item.id === record.stickerId)
    : undefined;

  return {
    id: record.id,
    speaker: record.speaker,
    author: record.author,
    text: record.text,
    time: messageTimeFromDate(parseStoredTimestamp(record.createdAt)),
    sticker
  };
}

function buildProfileFromRequest(
  state: ModelSettingsState,
  request: SaveModelSettingsRequest | TestModelConnectionRequest
): SavedModelProfile {
  const existingProfile = state.profiles.find((profile) => profile.id === request.profileId)
    ?? (request.profileId === state.activeModelId ? getActiveModelProfile(state) : undefined);
  let profile: SavedModelProfile = {
    id: request.profileId,
    name: request.name,
    baseUrl: request.baseUrl,
    hasToken: existingProfile?.hasToken ?? false,
    modelName: request.modelName,
    tokenHint: existingProfile?.tokenHint
  };

  if (request.token?.trim()) {
    profile = markTokenSaved(profile, request.token);
  }

  return profile;
}

export function createPreviewBackend(): DesktopBackend {
  let savedSettings: SavedModelSettings | null = null;
  let state = buildInitialModelSettings();
  let toolPolicySettings = defaultToolPolicySettings;
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

      return chatMessageFromRecord(record, session?.characterId);
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
    async deleteModelProfile(profileId) {
      state = deleteSavedModelProfile(state, profileId);
      savedSettings = state;
      return state;
    },
    async generateOpeningMessage() {
      if (!isModelConfigured(state)) {
        throw new Error("请先完成模型接入，再生成开场白。");
      }

      throw new Error(previewRuntimeMessage);
    },
    async getChatSession(sessionId) {
      const session = sessions.find((item) => item.id === sessionId);

      if (!session) {
        throw new Error("对话不存在。");
      }

      return {
        session,
        messages: (messagesBySession.get(sessionId) ?? []).map((message) => chatMessageFromRecord(message, session.characterId))
      };
    },
    async getMemoryStatus() {
      return {
        configuredBackend: "tencentdb",
        fallbackBackend: "chat-history",
        memoryDir: "浏览器预览 / memory-tdai",
        sqliteVecAvailable: true,
        tencentDbPackageAvailable: true,
        vectorsDbExists: false
      };
    },
    async getToolPolicySettings() {
      return toolPolicySettings;
    },
    async listChatSessions() {
      return [...sessions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    },
    async loadModelSettings() {
      state = mergeSavedModelSettings(buildInitialModelSettings(), savedSettings);
      return state;
    },
    async onPiPromptProgress() {
      return () => {};
    },
    async saveModelSettings(request) {
      state = upsertModelProfile(state, buildProfileFromRequest(state, request), { makeActive: request.makeActive });
      savedSettings = state;

      return state;
    },
    async saveToolPolicySettings(settings) {
      toolPolicySettings = settings;
      return toolPolicySettings;
    },
    async sendPiPrompt() {
      if (!isModelConfigured(state)) {
        throw new Error("请先完成模型接入，再发送消息。");
      }

      throw new Error(previewRuntimeMessage);
    },
    async setActiveModelProfile(profileId) {
      state = setSavedActiveModelProfile(state, profileId);
      savedSettings = state;
      return state;
    },
    async testModelConnection(request) {
      const testState = request
        ? setSavedActiveModelProfile(
          upsertModelProfile(state, buildProfileFromRequest(state, request), { makeActive: false }),
          request.profileId
        )
        : state;

      if (!isModelConfigured(testState)) {
        throw new Error("请先完成模型接入，再测试连接。");
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
    async deleteModelProfile(profileId) {
      const saved = await invoke<SavedModelSettings>("delete_model_profile", { profileId });
      return mergeSavedModelSettings(buildInitialModelSettings(), saved);
    },
    async generateOpeningMessage(request) {
      return invoke<PiPromptResponse>("generate_opening_message", { request });
    },
    async getChatSession(sessionId) {
      const detail = await invoke<{ session: ChatSessionSummary; messages: StoredChatMessageRecord[] }>("get_chat_session", { sessionId });

      return {
        session: detail.session,
        messages: detail.messages.map((message) => chatMessageFromRecord(message, detail.session.characterId))
      };
    },
    async getMemoryStatus() {
      return invoke<MemoryStatus>("get_memory_status");
    },
    async getToolPolicySettings() {
      return invoke<ToolPolicySettings>("get_tool_policy_settings");
    },
    async listChatSessions() {
      return invoke<ChatSessionSummary[]>("list_chat_sessions");
    },
    async loadModelSettings() {
      const saved = await invoke<SavedModelSettings>("get_model_settings");
      return mergeSavedModelSettings(buildInitialModelSettings(), saved);
    },
    async onPiPromptProgress(callback) {
      return listen<PiPromptProgressEvent>("pi_prompt_progress", (event) => {
        callback(event.payload);
      });
    },
    async saveModelSettings(request) {
      const saved = await invoke<SavedModelSettings>("save_model_settings", { request });
      return mergeSavedModelSettings(buildInitialModelSettings(), saved);
    },
    async saveToolPolicySettings(settings) {
      return invoke<ToolPolicySettings>("save_tool_policy_settings", { settings });
    },
    async sendPiPrompt(request) {
      return invoke<PiPromptResponse>("send_pi_prompt", { request });
    },
    async setActiveModelProfile(profileId) {
      const saved = await invoke<SavedModelSettings>("set_active_model_profile", { profileId });
      return mergeSavedModelSettings(buildInitialModelSettings(), saved);
    },
    async testModelConnection(request) {
      return invoke<PiPromptResponse>("test_model_connection", { request });
    }
  };
}

export const desktopBackend = isTauriRuntime() ? createTauriBackend() : createPreviewBackend();
