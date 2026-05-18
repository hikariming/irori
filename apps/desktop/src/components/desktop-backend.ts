import { invoke } from "@tauri-apps/api/core";

import {
  buildInitialModelSettings,
  isModelConfigured,
  markTokenSaved,
  mergeSavedModelSettings,
  type ModelSettingsState,
  type SavedModelSettings
} from "./model-settings-controller.ts";
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
  sessionPrompt?: string;
};

export type PiPromptResponse = {
  modelRoute: string;
  providerId: string;
  text: string;
};

const previewRuntimeMessage = "浏览器预览不会调用真实 LLM。请在 Tauri 桌面客户端里运行并发送消息，那里会通过 Rust command 调用 local-agent / Pi。";

export type DesktopBackend = {
  loadModelSettings: () => Promise<ModelSettingsState>;
  saveModelSettings: (request: SaveModelSettingsRequest) => Promise<ModelSettingsState>;
  sendPiPrompt: (request: SendPiPromptRequest) => Promise<PiPromptResponse>;
  testModelConnection: () => Promise<PiPromptResponse>;
};

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function createPreviewBackend(): DesktopBackend {
  let savedSettings: SavedModelSettings | null = null;
  let state = buildInitialModelSettings();

  return {
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
