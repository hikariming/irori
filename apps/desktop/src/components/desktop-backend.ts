import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type { PiPromptProgressEvent, PiToolConfirmRequest } from "./assistant-progress-model.ts";
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
import {
  requiredStickerIds,
  stickerMeta,
  type ChatMessage,
  type ChatSticker,
  type StickerId
} from "./chat-model.ts";
import type { MemoryBackendSource, MemoryStatus, RecalledMemorySnapshot } from "./memory-status-model.ts";
import { defaultToolPolicySettings, type ToolPolicySettings } from "./tool-policy-model.ts";
import { sanitizeCharacterStates, type CharacterStates, type Mood } from "./character-state.ts";
import { sanitizeMoments, type CharacterMoment, type MomentActorType } from "./character-moments.ts";
import { sanitizeLetters, type CharacterLetter, type LetterSender } from "./character-letters.ts";
import type { WorkspaceNode, WorkspaceRootId } from "./workspace-model.ts";
import { sanitizeReviewMode, type ReviewMode } from "./review-mode-model.ts";

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

export type RespondPiToolConfirmRequest = {
  runId: string;
  confirmId: string;
  approved: boolean;
};

export type AddCharacterMomentRequest = {
  characterId: string;
  text: string;
};

export type ToggleCharacterMomentLikeRequest = {
  momentId: string;
  actorType: MomentActorType;
  actorId: string;
  liked: boolean;
};

export type AddCharacterMomentCommentRequest = {
  momentId: string;
  actorType: MomentActorType;
  actorId: string;
  text: string;
};

type CharacterMomentRecord = {
  id: string;
  characterId: string;
  text: string;
  createdAt: string;
  likes?: Array<{ actorType: string; actorId: string; createdAt: string }>;
  comments?: Array<{ id: string; actorType: string; actorId: string; text: string; createdAt: string }>;
};

export type AddCharacterLetterRequest = {
  characterId: string;
  subject: string;
  body: string;
  mood?: Mood | null;
  deliverAt: string;
  sender?: LetterSender;
  replyTo?: string | null;
};

type CharacterLetterRecord = {
  id: string;
  characterId: string;
  subject: string;
  body: string;
  mood: string | null;
  createdAt: string;
  deliverAt: string;
  readAt: string | null;
  sender: string;
  replyTo: string | null;
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

const previewRuntimeMessage = "浏览器预览不会调用真实 LLM。请在 Tauri 桌面客户端里运行并发送消息，那里会通过 Rust command 调用 sidecar / Pi。";

export type DesktopBackend = {
  addCharacterLetter: (request: AddCharacterLetterRequest) => Promise<CharacterLetter>;
  addCharacterMomentComment: (request: AddCharacterMomentCommentRequest) => Promise<CharacterMoment>;
  addCharacterMoment: (request: AddCharacterMomentRequest) => Promise<CharacterMoment>;
  appendChatMessage: (request: AppendChatMessageRequest) => Promise<ChatMessage>;
  createChatSession: (request: CreateChatSessionRequest) => Promise<ChatSessionSummary>;
  deleteModelProfile: (profileId: string) => Promise<ModelSettingsState>;
  getChatSession: (sessionId: string) => Promise<ChatSessionDetail>;
  listCharacterLetters: (characterId?: string, limit?: number) => Promise<CharacterLetter[]>;
  listCharacterMoments: (characterId?: string, limit?: number) => Promise<CharacterMoment[]>;
  markCharacterLetterRead: (letterId: string) => Promise<CharacterLetter>;
  loadCharacterStates: () => Promise<CharacterStates>;
  saveCharacterStates: (states: CharacterStates) => Promise<void>;
  getMemoryStatus: () => Promise<MemoryStatus>;
  getToolPolicySettings: () => Promise<ToolPolicySettings>;
  listChatSessions: () => Promise<ChatSessionSummary[]>;
  listWorkspaceRoots: () => Promise<WorkspaceNode[]>;
  listWorkspaceDir: (path: string, rootId: WorkspaceRootId) => Promise<WorkspaceNode[]>;
  loadModelSettings: () => Promise<ModelSettingsState>;
  loadReviewMode: () => Promise<ReviewMode>;
  saveReviewMode: (mode: ReviewMode) => Promise<ReviewMode>;
  onPiPromptProgress: (callback: (event: PiPromptProgressEvent) => void) => Promise<() => void>;
  onPiToolConfirm: (callback: (request: PiToolConfirmRequest) => void) => Promise<() => void>;
  respondPiToolConfirm: (request: RespondPiToolConfirmRequest) => Promise<void>;
  saveModelSettings: (request: SaveModelSettingsRequest) => Promise<ModelSettingsState>;
  saveToolPolicySettings: (settings: ToolPolicySettings) => Promise<ToolPolicySettings>;
  sendPiPrompt: (request: SendPiPromptRequest) => Promise<PiPromptResponse>;
  setActiveModelProfile: (profileId: string) => Promise<ModelSettingsState>;
  testModelConnection: (request?: TestModelConnectionRequest) => Promise<PiPromptResponse>;
  toggleCharacterMomentLike: (request: ToggleCharacterMomentLikeRequest) => Promise<CharacterMoment>;
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

type WorkspaceEntryRecord = {
  id: string;
  name: string;
  kind: string;
  rootId: string;
  size?: number | null;
  modifiedAt?: number | null;
  hasChildren?: boolean;
};

function workspaceNodeFromRecord(record: WorkspaceEntryRecord): WorkspaceNode {
  return {
    id: record.id,
    name: record.name,
    kind: record.kind === "folder" ? "folder" : "file",
    rootId: record.rootId === "computer" ? "computer" : "workspace",
    size: typeof record.size === "number" ? record.size : undefined,
    modifiedAt: typeof record.modifiedAt === "number" ? record.modifiedAt : undefined,
    hasChildren: Boolean(record.hasChildren)
  };
}

// 浏览器预览没有文件系统：用一棵静态树按层喂给面板，让原型在 Vite 里也能点。
// key 为父路径（根用 "__roots__"），值为这一层的条目。
const previewBase = 1_700_000_000_000;
const previewWorkspaceTree: Record<string, WorkspaceNode[]> = {
  __roots__: [
    { id: "/workspace", name: "cockapoo-pi-companion", kind: "folder", rootId: "workspace", hasChildren: true },
    { id: "/home", name: "这台电脑", kind: "folder", rootId: "computer", hasChildren: true }
  ],
  "/workspace": [
    { id: "/workspace/apps", name: "apps", kind: "folder", rootId: "workspace", hasChildren: true },
    { id: "/workspace/README.md", name: "README.md", kind: "file", rootId: "workspace", size: 6_400, modifiedAt: previewBase, hasChildren: false },
    { id: "/workspace/package.json", name: "package.json", kind: "file", rootId: "workspace", size: 980, modifiedAt: previewBase, hasChildren: false }
  ],
  "/workspace/apps": [
    { id: "/workspace/apps/desktop", name: "desktop", kind: "folder", rootId: "workspace", hasChildren: true }
  ],
  "/workspace/apps/desktop": [
    { id: "/workspace/apps/desktop/App.tsx", name: "App.tsx", kind: "file", rootId: "workspace", size: 38_220, modifiedAt: previewBase, hasChildren: false },
    { id: "/workspace/apps/desktop/styles.css", name: "styles.css", kind: "file", rootId: "workspace", size: 96_540, modifiedAt: previewBase, hasChildren: false }
  ],
  "/home": [
    { id: "/home/Documents", name: "Documents", kind: "folder", rootId: "computer", hasChildren: true },
    { id: "/home/Downloads", name: "Downloads", kind: "folder", rootId: "computer", hasChildren: false }
  ],
  "/home/Documents": [
    { id: "/home/Documents/notes.md", name: "notes.md", kind: "file", rootId: "computer", size: 2_100, modifiedAt: previewBase, hasChildren: false },
    { id: "/home/Documents/budget.csv", name: "budget.csv", kind: "file", rootId: "computer", size: 18_500, modifiedAt: previewBase, hasChildren: false }
  ]
};

function previewWorkspaceChildren(path: string): WorkspaceNode[] {
  return previewWorkspaceTree[path] ?? [];
}

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

function momentFromRecord(record: CharacterMomentRecord) {
  return {
    id: record.id,
    characterId: record.characterId,
    text: record.text,
    createdAt: parseStoredTimestamp(record.createdAt).getTime(),
    likes: record.likes ?? [],
    comments: record.comments ?? []
  };
}

function fallbackMomentFromRecord(record: CharacterMomentRecord): CharacterMoment {
  return {
    id: record.id,
    characterId: record.characterId,
    text: record.text.trim() || "动态",
    createdAt: parseStoredTimestamp(record.createdAt).getTime(),
    likes: [],
    comments: []
  };
}

function letterFromRecord(record: CharacterLetterRecord) {
  return {
    id: record.id,
    characterId: record.characterId,
    subject: record.subject,
    body: record.body,
    mood: record.mood,
    createdAt: parseStoredTimestamp(record.createdAt).getTime(),
    deliverAt: parseStoredTimestamp(record.deliverAt).getTime(),
    readAt: record.readAt ? parseStoredTimestamp(record.readAt).getTime() : null,
    sender: record.sender === "user" ? "user" : "character",
    replyTo: record.replyTo ?? null
  };
}

function stickerFromRecord(characterId: string, stickerId: string): ChatSticker | undefined {
  if (!requiredStickerIds.includes(stickerId as StickerId)) {
    return undefined;
  }

  const id = stickerId as StickerId;
  const meta = stickerMeta[id];

  return {
    id,
    emotion: id,
    intent: meta.intent,
    label: meta.label,
    src: `/characters/${characterId}.card/assets/stickers/${id}.png`
  };
}

function chatMessageFromRecord(record: StoredChatMessageRecord, characterId = "shili"): ChatMessage {
  const sticker = record.stickerId
    ? stickerFromRecord(characterId, record.stickerId)
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
  let characterStates: CharacterStates = {};
  let characterMoments: CharacterMoment[] = [];
  let characterLetters: CharacterLetter[] = [];
  const sessions: ChatSessionSummary[] = [];
  const messagesBySession = new Map<string, StoredChatMessageRecord[]>();

  return {
    async loadCharacterStates() {
      return characterStates;
    },
    async saveCharacterStates(states) {
      characterStates = states;
    },
    async addCharacterMoment(request) {
      const moment: CharacterMoment = {
        id: previewId("moment"),
        characterId: request.characterId,
        text: request.text,
        createdAt: Date.now(),
        likes: [],
        comments: []
      };
      characterMoments = [moment, ...characterMoments];
      return moment;
    },
    async listCharacterMoments(characterId, limit) {
      const max = Math.min(Math.max(limit ?? 50, 1), 200);
      return characterMoments
        .filter((moment) => (characterId ? moment.characterId === characterId : true))
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, max);
    },
    async toggleCharacterMomentLike(request) {
      const target = characterMoments.find((moment) => moment.id === request.momentId);
      if (!target) {
        throw new Error("动态不存在。");
      }
      const exists = target.likes.some((like) => like.actorType === request.actorType && like.actorId === request.actorId);
      if (request.liked && !exists) {
        target.likes = [...target.likes, { actorType: request.actorType, actorId: request.actorId, createdAt: Date.now() }];
      } else if (!request.liked) {
        target.likes = target.likes.filter((like) => like.actorType !== request.actorType || like.actorId !== request.actorId);
      }
      return target;
    },
    async addCharacterMomentComment(request) {
      const target = characterMoments.find((moment) => moment.id === request.momentId);
      const text = request.text.trim();
      if (!target) {
        throw new Error("动态不存在。");
      }
      if (!text) {
        throw new Error("评论不能为空。");
      }
      target.comments = [
        ...target.comments,
        {
          id: previewId("moment-comment"),
          actorType: request.actorType,
          actorId: request.actorId,
          text,
          createdAt: Date.now()
        }
      ];
      return target;
    },
    async addCharacterLetter(request) {
      const now = Date.now();
      const letter: CharacterLetter = {
        id: previewId("letter"),
        characterId: request.characterId,
        subject: request.subject,
        body: request.body,
        mood: request.mood ?? null,
        createdAt: now,
        deliverAt: parseStoredTimestamp(request.deliverAt).getTime(),
        readAt: null,
        sender: request.sender === "user" ? "user" : "character",
        replyTo: request.replyTo ?? null
      };
      characterLetters = [letter, ...characterLetters];
      return letter;
    },
    async listCharacterLetters(characterId, limit) {
      const max = Math.min(Math.max(limit ?? 50, 1), 200);
      return characterLetters
        .filter((letter) => (characterId ? letter.characterId === characterId : true))
        .sort((left, right) => right.deliverAt - left.deliverAt)
        .slice(0, max);
    },
    async markCharacterLetterRead(letterId) {
      const target = characterLetters.find((letter) => letter.id === letterId);
      if (!target) {
        throw new Error("信件不存在。");
      }
      if (target.readAt === null) {
        target.readAt = Date.now();
      }
      return target;
    },
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
    async listWorkspaceRoots() {
      return previewWorkspaceChildren("__roots__");
    },
    async listWorkspaceDir(path) {
      return previewWorkspaceChildren(path);
    },
    async loadReviewMode() {
      return reviewMode;
    },
    async saveReviewMode(mode) {
      reviewMode = sanitizeReviewMode(mode);
      return reviewMode;
    },
    async loadModelSettings() {
      state = mergeSavedModelSettings(buildInitialModelSettings(), savedSettings);
      return state;
    },
    async onPiPromptProgress() {
      return () => {};
    },
    async onPiToolConfirm() {
      return () => {};
    },
    async respondPiToolConfirm() {
      throw new Error(previewRuntimeMessage);
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
    async addCharacterMoment(request) {
      const record = await invoke<CharacterMomentRecord>("add_character_moment", { request });
      const [moment] = sanitizeMoments([momentFromRecord(record)]);
      return moment ?? fallbackMomentFromRecord(record);
    },
    async toggleCharacterMomentLike(request) {
      const record = await invoke<CharacterMomentRecord>("toggle_character_moment_like", { request });
      const [moment] = sanitizeMoments([momentFromRecord(record)]);
      return moment ?? fallbackMomentFromRecord(record);
    },
    async addCharacterMomentComment(request) {
      const record = await invoke<CharacterMomentRecord>("add_character_moment_comment", { request });
      const [moment] = sanitizeMoments([momentFromRecord(record)]);
      return moment ?? fallbackMomentFromRecord(record);
    },
    async listCharacterMoments(characterId, limit) {
      const records = await invoke<CharacterMomentRecord[]>("list_character_moments", { characterId, limit });
      return sanitizeMoments(records.map(momentFromRecord));
    },
    async addCharacterLetter(request) {
      const record = await invoke<CharacterLetterRecord>("add_character_letter", { request });
      const [letter] = sanitizeLetters([letterFromRecord(record)]);
      return letter ?? letterFromRecord(record);
    },
    async listCharacterLetters(characterId, limit) {
      const records = await invoke<CharacterLetterRecord[]>("list_character_letters", { characterId, limit });
      return sanitizeLetters(records.map(letterFromRecord));
    },
    async markCharacterLetterRead(letterId) {
      const record = await invoke<CharacterLetterRecord>("mark_character_letter_read", { letterId });
      const [letter] = sanitizeLetters([letterFromRecord(record)]);
      return letter ?? letterFromRecord(record);
    },
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
    async getChatSession(sessionId) {
      const detail = await invoke<{ session: ChatSessionSummary; messages: StoredChatMessageRecord[] }>("get_chat_session", { sessionId });

      return {
        session: detail.session,
        messages: detail.messages.map((message) => chatMessageFromRecord(message, detail.session.characterId))
      };
    },
    async loadCharacterStates() {
      const raw = await invoke<unknown>("get_character_states");
      return sanitizeCharacterStates(raw);
    },
    async saveCharacterStates(states) {
      await invoke("save_character_states", { states });
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
    async listWorkspaceRoots() {
      const records = await invoke<WorkspaceEntryRecord[]>("list_workspace_roots");
      return records.map(workspaceNodeFromRecord);
    },
    async listWorkspaceDir(path, rootId) {
      const records = await invoke<WorkspaceEntryRecord[]>("list_workspace_dir", { path, rootId });
      return records.map(workspaceNodeFromRecord);
    },
    async loadModelSettings() {
      const saved = await invoke<SavedModelSettings>("get_model_settings");
      return mergeSavedModelSettings(buildInitialModelSettings(), saved);
    },
    async loadReviewMode() {
      return sanitizeReviewMode(await invoke<string>("get_review_mode"));
    },
    async saveReviewMode(mode) {
      return sanitizeReviewMode(await invoke<string>("set_review_mode", { mode }));
    },
    async onPiPromptProgress(callback) {
      return listen<PiPromptProgressEvent>("pi_prompt_progress", (event) => {
        callback(event.payload);
      });
    },
    async onPiToolConfirm(callback) {
      return listen<PiToolConfirmRequest>("pi_tool_confirm", (event) => {
        callback(event.payload);
      });
    },
    async respondPiToolConfirm(request) {
      await invoke("respond_pi_tool_confirm", { request });
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
