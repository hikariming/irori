# Model Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multiple saved OpenAI-compatible model profiles with a global `activeModelId` used by chat, settings, and the Tauri runtime.

**Architecture:** Keep profile state logic in `model-settings-controller.ts`, expose profile-aware backend methods through `desktop-backend.ts`, and make Tauri persist the new registry while migrating legacy single-model settings. The local-agent boundary remains unchanged: each run receives the active profile as one `{ baseUrl, modelName }` payload plus the active token.

**Tech Stack:** React 19, HeroUI, TypeScript, Tauri Rust commands, Node `node:test`, Rust `cargo test`.

---

## File Structure

- Modify `apps/desktop/src/components/model-settings-controller.ts`: Define profile registry types, migration helpers, active profile helpers, and profile update/delete helpers.
- Modify `apps/desktop/src/components/model-settings-controller.test.ts`: Cover legacy migration, active profile readiness, profile save behavior, switching, deletion, and route preview.
- Modify `apps/desktop/src/components/settings-model.ts`: Rename the tab copy from `模型供应商` to `模型接入`.
- Modify `apps/desktop/src/components/settings-model.test.ts`: Assert the new tab copy.
- Modify `apps/desktop/src/components/desktop-backend.ts`: Replace single-profile backend request/response types with profile-aware commands and preview backend behavior.
- Modify `apps/desktop/src-tauri/src/lib.rs`: Add persisted model registry structs, legacy migration, profile save/switch/delete commands, active profile resolution, and draft test support.
- Modify `apps/desktop/src/components/SystemSettingsPanel.tsx`: Render profile list and editor, save/test/set-active/delete actions, and pass profile registry changes upward.
- Modify `apps/desktop/src/App.tsx`: Use active profile helpers for readiness and missing-model messaging.
- Verify `apps/local-agent/src/model-provider-resolver.mjs` remains unchanged because it already accepts a single active OpenAI-compatible model setting.

## Task 1: Model Profile State Logic

**Files:**
- Modify: `apps/desktop/src/components/model-settings-controller.test.ts`
- Modify: `apps/desktop/src/components/model-settings-controller.ts`

- [ ] **Step 1: Write failing tests for registry migration and active helpers**

Replace `apps/desktop/src/components/model-settings-controller.test.ts` with:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildDraftModelProfile,
  buildInitialModelSettings,
  deleteModelProfile,
  formatOpenAiCompatibleRequestPreview,
  getActiveModelProfile,
  isModelConfigured,
  mergeSavedModelSettings,
  normalizeOpenAiCompatibleSettings,
  redactToken,
  setActiveModelProfile,
  upsertModelProfile
} from "./model-settings-controller.ts";

test("mergeSavedModelSettings migrates a legacy single-model snapshot", () => {
  const settings = mergeSavedModelSettings(buildInitialModelSettings(), {
    baseUrl: "http://localhost:11434/v1",
    hasToken: true,
    modelName: "qwen3-coder",
    tokenHint: "••••1234"
  });

  assert.equal(settings.activeModelId, "default");
  assert.equal(settings.profiles.length, 1);
  assert.deepEqual(settings.profiles[0], {
    id: "default",
    name: "qwen3-coder",
    baseUrl: "http://localhost:11434/v1",
    hasToken: true,
    modelName: "qwen3-coder",
    tokenHint: "••••1234"
  });
});

test("getActiveModelProfile falls back to the first profile", () => {
  const settings = mergeSavedModelSettings(buildInitialModelSettings(), {
    activeModelId: "missing",
    profiles: [
      {
        id: "glm",
        name: "智谱 GLM",
        baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
        hasToken: true,
        modelName: "glm-5.1",
        tokenHint: "••••glm1"
      }
    ]
  });

  assert.equal(getActiveModelProfile(settings)?.id, "glm");
});

test("isModelConfigured requires an active endpoint, model name, and saved token", () => {
  assert.equal(isModelConfigured(buildInitialModelSettings()), false);
  assert.equal(
    isModelConfigured({
      activeModelId: "local",
      profiles: [
        {
          id: "local",
          name: "Local Qwen",
          baseUrl: "http://localhost:11434/v1",
          hasToken: true,
          modelName: "qwen3-coder",
          tokenHint: "已保存"
        }
      ]
    }),
    true
  );
  assert.equal(
    isModelConfigured({
      activeModelId: "local",
      profiles: [
        {
          id: "local",
          name: "Local Qwen",
          baseUrl: "http://localhost:11434/v1",
          hasToken: false,
          modelName: "qwen3-coder"
        }
      ]
    }),
    false
  );
});

test("upsertModelProfile updates one profile and can set it active", () => {
  const settings = upsertModelProfile(
    buildInitialModelSettings(),
    {
      id: "glm",
      name: "智谱 GLM",
      baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4/GLM-5.1",
      hasToken: true,
      modelName: "glm-5.1",
      tokenHint: "••••glm1"
    },
    { makeActive: true }
  );

  assert.equal(settings.activeModelId, "glm");
  assert.equal(settings.profiles.length, 2);
  assert.equal(getActiveModelProfile(settings)?.baseUrl, "https://open.bigmodel.cn/api/coding/paas/v4");
});

test("setActiveModelProfile switches to an existing profile", () => {
  const settings = mergeSavedModelSettings(buildInitialModelSettings(), {
    activeModelId: "default",
    profiles: [
      {
        id: "default",
        name: "OpenAI",
        baseUrl: "https://api.openai.com/v1",
        hasToken: true,
        modelName: "gpt-5.2",
        tokenHint: "••••open"
      },
      {
        id: "glm",
        name: "智谱 GLM",
        baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
        hasToken: true,
        modelName: "glm-5.1",
        tokenHint: "••••glm1"
      }
    ]
  });

  assert.equal(setActiveModelProfile(settings, "glm").activeModelId, "glm");
  assert.equal(setActiveModelProfile(settings, "missing").activeModelId, "default");
});

test("deleteModelProfile removes a profile and keeps one active profile", () => {
  const settings = mergeSavedModelSettings(buildInitialModelSettings(), {
    activeModelId: "glm",
    profiles: [
      {
        id: "openai",
        name: "OpenAI",
        baseUrl: "https://api.openai.com/v1",
        hasToken: true,
        modelName: "gpt-5.2",
        tokenHint: "••••open"
      },
      {
        id: "glm",
        name: "智谱 GLM",
        baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
        hasToken: true,
        modelName: "glm-5.1",
        tokenHint: "••••glm1"
      }
    ]
  });

  const deleted = deleteModelProfile(settings, "glm");

  assert.equal(deleted.activeModelId, "openai");
  assert.equal(deleted.profiles.length, 1);
  assert.equal(deleteModelProfile(deleted, "openai").profiles.length, 1);
});

test("formatOpenAiCompatibleRequestPreview uses the selected profile", () => {
  const preview = formatOpenAiCompatibleRequestPreview({
    id: "glm",
    name: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    hasToken: true,
    modelName: "glm-5.1",
    tokenHint: "••••glm1"
  });

  assert.equal(preview, "POST https://open.bigmodel.cn/api/coding/paas/v4/chat/completions · body.model = glm-5.1");
});

test("buildDraftModelProfile creates a stable editable profile shape", () => {
  const draft = buildDraftModelProfile("profile-1");

  assert.equal(draft.id, "profile-1");
  assert.equal(draft.name, "新模型");
  assert.equal(draft.hasToken, false);
});

test("redactToken only preserves a short suffix for saved token hints", () => {
  assert.equal(redactToken("sk-1234567890"), "••••7890");
  assert.equal(redactToken("abc"), "已保存");
});

test("normalizeOpenAiCompatibleSettings removes model suffix from base URL", () => {
  const settings = normalizeOpenAiCompatibleSettings({
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4/GLM-5.1",
    modelName: "glm-5.1"
  });

  assert.equal(settings.baseUrl, "https://open.bigmodel.cn/api/coding/paas/v4");
  assert.equal(settings.modelName, "glm-5.1");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --test apps/desktop/src/components/model-settings-controller.test.ts
```

Expected: FAIL because `buildDraftModelProfile`, `getActiveModelProfile`, `setActiveModelProfile`, `upsertModelProfile`, and `deleteModelProfile` do not exist yet.

- [ ] **Step 3: Implement registry types and helpers**

Replace `apps/desktop/src/components/model-settings-controller.ts` with:

```ts
export type SavedModelProfile = {
  baseUrl: string;
  hasToken: boolean;
  id: string;
  modelName: string;
  name: string;
  tokenHint?: string;
};

export type LegacySavedModelSettings = {
  baseUrl?: string;
  hasToken?: boolean;
  modelName?: string;
  tokenHint?: string;
};

export type SavedModelSettings = {
  activeModelId: string;
  profiles: SavedModelProfile[];
};

export type ModelSettingsState = SavedModelSettings;

export const defaultModelProfile: SavedModelProfile = {
  id: "default",
  name: "OpenAI GPT-5.2",
  baseUrl: "https://api.openai.com/v1",
  hasToken: false,
  modelName: "gpt-5.2",
  tokenHint: undefined
};

export const defaultModelSettings: ModelSettingsState = {
  activeModelId: defaultModelProfile.id,
  profiles: [defaultModelProfile]
};

export type SaveModelProfileDraft = {
  baseUrl: string;
  hasToken?: boolean;
  id: string;
  modelName: string;
  name: string;
  tokenHint?: string;
};

type OpenAiCompatibleSettingsInput = {
  baseUrl: string;
  modelName: string;
};

export function redactToken(token: string) {
  if (token.length < 8) {
    return "已保存";
  }

  return `••••${token.slice(-4)}`;
}

export function buildInitialModelSettings(): ModelSettingsState {
  return {
    activeModelId: defaultModelSettings.activeModelId,
    profiles: defaultModelSettings.profiles.map((profile) => ({ ...profile }))
  };
}

export function buildDraftModelProfile(id: string): SavedModelProfile {
  return {
    id,
    name: "新模型",
    baseUrl: defaultModelProfile.baseUrl,
    hasToken: false,
    modelName: "",
    tokenHint: undefined
  };
}

function isRegistrySettings(saved: Partial<SavedModelSettings> | Partial<LegacySavedModelSettings>): saved is Partial<SavedModelSettings> {
  return Array.isArray((saved as Partial<SavedModelSettings>).profiles);
}

function profileNameFor(modelName: string) {
  return modelName.trim() || "默认模型";
}

export function normalizeModelProfile(profile: SaveModelProfileDraft): SavedModelProfile {
  const normalized = normalizeOpenAiCompatibleSettings(profile);

  return {
    ...profile,
    name: profile.name.trim() || profileNameFor(normalized.modelName),
    baseUrl: normalized.baseUrl,
    modelName: normalized.modelName,
    hasToken: profile.hasToken === true,
    tokenHint: profile.tokenHint
  };
}

function normalizeProfiles(profiles: SaveModelProfileDraft[] | undefined): SavedModelProfile[] {
  const normalized = (profiles ?? [])
    .map(normalizeModelProfile)
    .filter((profile, index, all) => profile.id.trim() && all.findIndex((item) => item.id === profile.id) === index);

  return normalized.length > 0 ? normalized : buildInitialModelSettings().profiles;
}

export function mergeSavedModelSettings(
  current: ModelSettingsState,
  saved?: Partial<SavedModelSettings> | Partial<LegacySavedModelSettings> | null
): ModelSettingsState {
  if (!saved) {
    return current;
  }

  if (isRegistrySettings(saved)) {
    const profiles = normalizeProfiles(saved.profiles as SaveModelProfileDraft[] | undefined);
    const activeModelId = profiles.some((profile) => profile.id === saved.activeModelId)
      ? saved.activeModelId ?? profiles[0].id
      : profiles[0].id;

    return { activeModelId, profiles };
  }

  const legacy = saved as Partial<LegacySavedModelSettings>;
  const modelName = legacy.modelName ?? current.profiles[0]?.modelName ?? defaultModelProfile.modelName;
  const profile = normalizeModelProfile({
    id: "default",
    name: profileNameFor(modelName),
    baseUrl: legacy.baseUrl ?? current.profiles[0]?.baseUrl ?? defaultModelProfile.baseUrl,
    hasToken: legacy.hasToken ?? current.profiles[0]?.hasToken ?? false,
    modelName,
    tokenHint: legacy.tokenHint ?? current.profiles[0]?.tokenHint
  });

  return {
    activeModelId: profile.id,
    profiles: [profile]
  };
}

export function getActiveModelProfile(settings: ModelSettingsState): SavedModelProfile | undefined {
  return settings.profiles.find((profile) => profile.id === settings.activeModelId) ?? settings.profiles[0];
}

export function setActiveModelProfile(settings: ModelSettingsState, profileId: string): ModelSettingsState {
  if (!settings.profiles.some((profile) => profile.id === profileId)) {
    return settings;
  }

  return {
    ...settings,
    activeModelId: profileId
  };
}

export function upsertModelProfile(
  settings: ModelSettingsState,
  profile: SaveModelProfileDraft,
  options: { makeActive?: boolean } = {}
): ModelSettingsState {
  const normalized = normalizeModelProfile(profile);
  const existingIndex = settings.profiles.findIndex((item) => item.id === normalized.id);
  const profiles = existingIndex >= 0
    ? settings.profiles.map((item) => item.id === normalized.id ? normalized : item)
    : [...settings.profiles, normalized];

  return {
    activeModelId: options.makeActive ? normalized.id : settings.activeModelId,
    profiles
  };
}

export function deleteModelProfile(settings: ModelSettingsState, profileId: string): ModelSettingsState {
  if (settings.profiles.length <= 1) {
    return settings;
  }

  const profiles = settings.profiles.filter((profile) => profile.id !== profileId);
  const activeModelId = profiles.some((profile) => profile.id === settings.activeModelId)
    ? settings.activeModelId
    : profiles[0].id;

  return { activeModelId, profiles };
}

export function markTokenSaved(profile: SavedModelProfile, token: string): SavedModelProfile {
  return {
    ...profile,
    hasToken: true,
    tokenHint: redactToken(token)
  };
}

export function isModelConfigured(settings: ModelSettingsState) {
  const active = getActiveModelProfile(settings);

  return Boolean(active?.baseUrl.trim() && active.modelName.trim() && active.hasToken);
}

export function normalizeOpenAiCompatibleSettings(settings: OpenAiCompatibleSettingsInput) {
  let baseUrl = settings.baseUrl.trim().replace(/\/+$/, "");
  const modelName = settings.modelName.trim();
  const lowerBaseUrl = baseUrl.toLowerCase();
  const lowerModelName = modelName.toLowerCase();

  if (lowerModelName && lowerBaseUrl.endsWith(`/${lowerModelName}`)) {
    baseUrl = baseUrl.slice(0, -(modelName.length + 1));
  }

  if (baseUrl.toLowerCase().endsWith("/chat/completions")) {
    baseUrl = baseUrl.slice(0, -"/chat/completions".length);
  }

  return {
    baseUrl,
    modelName
  };
}

export function formatOpenAiCompatibleRequestPreview(settings: OpenAiCompatibleSettingsInput) {
  const normalized = normalizeOpenAiCompatibleSettings(settings);

  return `POST ${normalized.baseUrl}/chat/completions · body.model = ${normalized.modelName}`;
}

export function formatOpenAiCompatibleRoute(settings: OpenAiCompatibleSettingsInput) {
  return formatOpenAiCompatibleRequestPreview(settings);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
node --test apps/desktop/src/components/model-settings-controller.test.ts
```

Expected: PASS for all model settings controller tests.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/desktop/src/components/model-settings-controller.ts apps/desktop/src/components/model-settings-controller.test.ts docs/superpowers/plans/2026-05-20-model-profiles.md
git commit -m "feat: add model profile state helpers"
```

## Task 2: Desktop Backend Types And Preview Runtime

**Files:**
- Modify: `apps/desktop/src/components/desktop-backend.test.ts`
- Modify: `apps/desktop/src/components/desktop-backend.ts`

- [ ] **Step 1: Add failing tests for profile-aware preview backend**

Append these tests to `apps/desktop/src/components/desktop-backend.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { createPreviewBackend } from "./desktop-backend.ts";
import { getActiveModelProfile } from "./model-settings-controller.ts";

test("preview backend saves multiple model profiles and switches the active profile", async () => {
  const backend = createPreviewBackend();

  const saved = await backend.saveModelSettings({
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    makeActive: true,
    modelName: "glm-5.1",
    name: "智谱 GLM",
    profileId: "glm",
    token: "sk-glm-123456"
  });

  assert.equal(saved.activeModelId, "glm");
  assert.equal(getActiveModelProfile(saved)?.tokenHint, "••••3456");

  await backend.saveModelSettings({
    baseUrl: "http://localhost:11434/v1",
    makeActive: false,
    modelName: "qwen3-coder",
    name: "Local Qwen",
    profileId: "local",
    token: "ollama-token"
  });

  const switched = await backend.setActiveModelProfile("local");

  assert.equal(switched.activeModelId, "local");
  assert.equal(getActiveModelProfile(switched)?.modelName, "qwen3-coder");
});

test("preview backend deletes the active model profile and selects a remaining one", async () => {
  const backend = createPreviewBackend();

  await backend.saveModelSettings({
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    makeActive: true,
    modelName: "glm-5.1",
    name: "智谱 GLM",
    profileId: "glm",
    token: "sk-glm-123456"
  });
  await backend.saveModelSettings({
    baseUrl: "http://localhost:11434/v1",
    makeActive: true,
    modelName: "qwen3-coder",
    name: "Local Qwen",
    profileId: "local",
    token: "ollama-token"
  });

  const deleted = await backend.deleteModelProfile("local");

  assert.equal(deleted.activeModelId, "default");
  assert.equal(deleted.profiles.some((profile) => profile.id === "local"), false);
});
```

If `desktop-backend.test.ts` already imports `assert`, `test`, or `createPreviewBackend`, merge the import lists instead of duplicating them.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --test apps/desktop/src/components/desktop-backend.test.ts
```

Expected: FAIL because `SaveModelSettingsRequest` does not accept `profileId`, `name`, or `makeActive`, and backend methods `setActiveModelProfile` / `deleteModelProfile` do not exist.

- [ ] **Step 3: Update desktop backend profile types and preview behavior**

In `apps/desktop/src/components/desktop-backend.ts`, update imports from `model-settings-controller.ts` to include:

```ts
  deleteModelProfile,
  getActiveModelProfile,
  markTokenSaved,
  setActiveModelProfile,
  upsertModelProfile,
  type SavedModelProfile,
```

Replace `SaveModelSettingsRequest` with:

```ts
export type SaveModelSettingsRequest = {
  baseUrl: string;
  makeActive?: boolean;
  modelName: string;
  name: string;
  profileId: string;
  token?: string;
};
```

Add:

```ts
export type TestModelConnectionRequest = {
  baseUrl: string;
  modelName: string;
  name: string;
  profileId: string;
  token?: string;
};
```

Add methods to `DesktopBackend`:

```ts
  deleteModelProfile: (profileId: string) => Promise<ModelSettingsState>;
  setActiveModelProfile: (profileId: string) => Promise<ModelSettingsState>;
  testModelConnection: (request?: TestModelConnectionRequest) => Promise<PiPromptResponse>;
```

Inside `createPreviewBackend`, replace `savedSettings` with:

```ts
  let state = buildInitialModelSettings();
```

Replace preview `loadModelSettings`, `saveModelSettings`, and `testModelConnection`, and add switch/delete:

```ts
    async deleteModelProfile(profileId) {
      state = deleteModelProfile(state, profileId);
      return state;
    },
    async loadModelSettings() {
      return state;
    },
    async saveModelSettings(request) {
      const existing = state.profiles.find((profile) => profile.id === request.profileId);
      let profile: SavedModelProfile = {
        id: request.profileId,
        name: request.name,
        baseUrl: request.baseUrl,
        modelName: request.modelName,
        hasToken: existing?.hasToken ?? false,
        tokenHint: existing?.tokenHint
      };

      if (request.token) {
        profile = markTokenSaved(profile, request.token);
      }

      state = upsertModelProfile(state, profile, { makeActive: request.makeActive });

      return state;
    },
    async setActiveModelProfile(profileId) {
      state = setActiveModelProfile(state, profileId);
      return state;
    },
    async testModelConnection(request) {
      const existing = request
        ? state.profiles.find((profile) => profile.id === request.profileId)
        : undefined;
      const active = request
        ? {
            id: request.profileId,
            name: request.name,
            baseUrl: request.baseUrl,
            modelName: request.modelName,
            hasToken: Boolean(request.token) || existing?.hasToken === true,
            tokenHint: request.token ? "已填写" : existing?.tokenHint
          }
        : getActiveModelProfile(state);

      if (!active?.baseUrl.trim() || !active.modelName.trim() || (!active.hasToken && !request?.token?.trim())) {
        throw new Error("请先在模型接入里保存或填写 Token。");
      }

      throw new Error(previewRuntimeMessage);
    }
```

Keep preview `sendPiPrompt` using `isModelConfigured(state)`.

In `createTauriBackend`, add:

```ts
    async deleteModelProfile(profileId) {
      const saved = await invoke<ModelSettingsState>("delete_model_profile", { profileId });
      return mergeSavedModelSettings(buildInitialModelSettings(), saved);
    },
    async setActiveModelProfile(profileId) {
      const saved = await invoke<ModelSettingsState>("set_active_model_profile", { profileId });
      return mergeSavedModelSettings(buildInitialModelSettings(), saved);
    },
```

Update `testModelConnection` to accept and forward the optional draft:

```ts
    async testModelConnection(request) {
      return invoke<PiPromptResponse>("test_model_connection", { request });
    }
```

- [ ] **Step 4: Run backend tests to verify they pass**

Run:

```bash
node --test apps/desktop/src/components/desktop-backend.test.ts apps/desktop/src/components/model-settings-controller.test.ts
```

Expected: PASS for desktop backend and model settings controller tests.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/desktop/src/components/desktop-backend.ts apps/desktop/src/components/desktop-backend.test.ts docs/superpowers/plans/2026-05-20-model-profiles.md
git commit -m "feat: add model profile backend contract"
```

## Task 3: Tauri Model Registry Persistence

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs`

- [ ] **Step 1: Add failing Rust unit tests for migration, saving, switching, and deletion**

Add this test module near the bottom of `apps/desktop/src-tauri/src/lib.rs`:

```rust
#[cfg(test)]
mod model_profile_tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_settings_path(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!("irori-{name}-{suffix}.json"))
    }

    #[test]
    fn reads_legacy_model_settings_as_one_active_profile() {
        let path = temp_settings_path("legacy-model-settings");
        fs::write(
            &path,
            r#"{"baseUrl":"http://localhost:11434/v1","modelName":"qwen3-coder","token":"ollama-token"}"#,
        )
        .unwrap();

        let snapshot = read_model_settings_from_path(&path).unwrap();

        assert_eq!(snapshot.active_model_id, "default");
        assert_eq!(snapshot.profiles.len(), 1);
        assert_eq!(snapshot.profiles[0].model_name, "qwen3-coder");
        assert_eq!(snapshot.profiles[0].token_hint.as_deref(), Some("••••oken"));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn saves_profile_and_preserves_existing_token_when_blank() {
        let path = temp_settings_path("save-model-profile");
        save_model_settings_to_path(
            &path,
            SaveModelSettingsRequest {
                base_url: "https://open.bigmodel.cn/api/coding/paas/v4/GLM-5.1".to_string(),
                make_active: Some(true),
                model_name: "glm-5.1".to_string(),
                name: "智谱 GLM".to_string(),
                profile_id: "glm".to_string(),
                token: Some("sk-glm-123456".to_string()),
            },
        )
        .unwrap();

        let snapshot = save_model_settings_to_path(
            &path,
            SaveModelSettingsRequest {
                base_url: "https://open.bigmodel.cn/api/coding/paas/v4".to_string(),
                make_active: Some(true),
                model_name: "glm-5.1".to_string(),
                name: "智谱 GLM".to_string(),
                profile_id: "glm".to_string(),
                token: None,
            },
        )
        .unwrap();

        assert_eq!(snapshot.active_model_id, "glm");
        assert_eq!(snapshot.profiles[0].base_url, "https://open.bigmodel.cn/api/coding/paas/v4");
        assert_eq!(snapshot.profiles[0].token_hint.as_deref(), Some("••••3456"));

        let stored = read_stored_model_registry(&path).unwrap();
        assert_eq!(stored.profiles[0].token.as_deref(), Some("sk-glm-123456"));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn switches_active_profile() {
        let path = temp_settings_path("switch-model-profile");
        save_model_settings_to_path(
            &path,
            SaveModelSettingsRequest {
                base_url: "https://open.bigmodel.cn/api/coding/paas/v4".to_string(),
                make_active: Some(false),
                model_name: "glm-5.1".to_string(),
                name: "智谱 GLM".to_string(),
                profile_id: "glm".to_string(),
                token: Some("sk-glm-123456".to_string()),
            },
        )
        .unwrap();

        let snapshot = set_active_model_profile_at_path(&path, "glm").unwrap();

        assert_eq!(snapshot.active_model_id, "glm");

        let _ = fs::remove_file(path);
    }

    #[test]
    fn deletes_active_profile_and_selects_remaining_profile() {
        let path = temp_settings_path("delete-model-profile");
        save_model_settings_to_path(
            &path,
            SaveModelSettingsRequest {
                base_url: "https://open.bigmodel.cn/api/coding/paas/v4".to_string(),
                make_active: Some(true),
                model_name: "glm-5.1".to_string(),
                name: "智谱 GLM".to_string(),
                profile_id: "glm".to_string(),
                token: Some("sk-glm-123456".to_string()),
            },
        )
        .unwrap();

        let snapshot = delete_model_profile_at_path(&path, "glm").unwrap();

        assert_eq!(snapshot.active_model_id, "default");
        assert!(snapshot.profiles.iter().all(|profile| profile.id != "glm"));

        let _ = fs::remove_file(path);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --dir apps/desktop tauri info
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml model_profile_tests
```

Expected: FAIL because the profile-aware structs and helper functions are not implemented yet. The `tauri info` command is a quick environment check; if it fails due to missing system tooling, continue with `cargo test`.

- [ ] **Step 3: Replace single-model structs with profile registry structs**

In `apps/desktop/src-tauri/src/lib.rs`, replace the current model settings structs with:

```rust
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveModelSettingsRequest {
    base_url: String,
    make_active: Option<bool>,
    model_name: String,
    name: String,
    profile_id: String,
    token: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TestModelConnectionRequest {
    base_url: String,
    model_name: String,
    name: String,
    profile_id: String,
    token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelProfileSnapshot {
    base_url: String,
    has_token: bool,
    id: String,
    model_name: String,
    name: String,
    token_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelSettingsSnapshot {
    active_model_id: String,
    profiles: Vec<ModelProfileSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredModelProfile {
    base_url: String,
    id: String,
    model_name: String,
    name: String,
    token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredModelRegistry {
    active_model_id: String,
    profiles: Vec<StoredModelProfile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyStoredModelSettings {
    base_url: String,
    model_name: String,
    token: Option<String>,
}
```

Update `test_model_connection` command signature:

```rust
fn test_model_connection(
    app: AppHandle,
    request: Option<TestModelConnectionRequest>,
) -> Result<PiPromptResponse, String> {
    run_local_agent_prompt(
        app,
        "请只回复两个字母：OK。不要解释，不要使用 Markdown。".to_string(),
        None,
        request,
    )
}
```

Update `send_pi_prompt` to call `run_local_agent_prompt(app, prompt, Some(request), None)`.

Add Tauri commands:

```rust
#[tauri::command]
fn set_active_model_profile(
    app: AppHandle,
    profile_id: String,
) -> Result<ModelSettingsSnapshot, String> {
    set_active_model_profile_at_path(&settings_path(&app)?, &profile_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_model_profile(
    app: AppHandle,
    profile_id: String,
) -> Result<ModelSettingsSnapshot, String> {
    delete_model_profile_at_path(&settings_path(&app)?, &profile_id)
        .map_err(|error| error.to_string())
}
```

Register both commands in the `tauri::generate_handler!` list in `run()`.

- [ ] **Step 4: Implement registry storage helpers**

Replace `default_stored_model_settings`, `snapshot_from_stored`, `read_stored_model_settings`, `read_model_settings_from_path`, and `save_model_settings_to_path` with:

```rust
fn default_stored_model_profile() -> StoredModelProfile {
    StoredModelProfile {
        id: "default".to_string(),
        name: "OpenAI GPT-5.2".to_string(),
        base_url: DEFAULT_BASE_URL.to_string(),
        model_name: DEFAULT_MODEL_NAME.to_string(),
        token: None,
    }
}

fn default_stored_model_registry() -> StoredModelRegistry {
    let profile = default_stored_model_profile();

    StoredModelRegistry {
        active_model_id: profile.id.clone(),
        profiles: vec![profile],
    }
}

fn token_hint(token: &str) -> String {
    if token.len() < 8 {
        "已保存".to_string()
    } else {
        format!("••••{}", &token[token.len() - 4..])
    }
}

fn snapshot_from_stored_profile(stored: &StoredModelProfile) -> ModelProfileSnapshot {
    let token = stored.token.as_deref().filter(|value| !value.is_empty());

    ModelProfileSnapshot {
        base_url: stored.base_url.clone(),
        has_token: token.is_some(),
        id: stored.id.clone(),
        model_name: stored.model_name.clone(),
        name: stored.name.clone(),
        token_hint: token.map(token_hint),
    }
}

fn snapshot_from_stored_registry(stored: &StoredModelRegistry) -> ModelSettingsSnapshot {
    let profiles: Vec<ModelProfileSnapshot> = stored
        .profiles
        .iter()
        .map(snapshot_from_stored_profile)
        .collect();
    let active_model_id = if profiles
        .iter()
        .any(|profile| profile.id == stored.active_model_id)
    {
        stored.active_model_id.clone()
    } else {
        profiles
            .first()
            .map(|profile| profile.id.clone())
            .unwrap_or_else(|| "default".to_string())
    };

    ModelSettingsSnapshot {
        active_model_id,
        profiles,
    }
}

fn profile_name_for(model_name: &str) -> String {
    let trimmed = model_name.trim();

    if trimmed.is_empty() {
        "默认模型".to_string()
    } else {
        trimmed.to_string()
    }
}

fn legacy_to_registry(legacy: LegacyStoredModelSettings) -> StoredModelRegistry {
    let normalized = normalize_openai_compatible_settings(&legacy.base_url, &legacy.model_name);
    let profile = StoredModelProfile {
        id: "default".to_string(),
        name: profile_name_for(&normalized.1),
        base_url: normalized.0,
        model_name: normalized.1,
        token: legacy.token,
    };

    StoredModelRegistry {
        active_model_id: profile.id.clone(),
        profiles: vec![profile],
    }
}

fn read_stored_model_registry(path: &Path) -> Result<StoredModelRegistry, Box<dyn std::error::Error>> {
    if !path.exists() {
        return Ok(default_stored_model_registry());
    }

    let value: serde_json::Value = serde_json::from_str(&fs::read_to_string(path)?)?;

    if value.get("profiles").is_some() {
        let mut registry: StoredModelRegistry = serde_json::from_value(value)?;
        if registry.profiles.is_empty() {
            registry = default_stored_model_registry();
        }
        if !registry
            .profiles
            .iter()
            .any(|profile| profile.id == registry.active_model_id)
        {
            registry.active_model_id = registry.profiles[0].id.clone();
        }
        return Ok(registry);
    }

    let legacy: LegacyStoredModelSettings = serde_json::from_value(value)?;
    Ok(legacy_to_registry(legacy))
}

fn read_model_settings_from_path(
    path: &Path,
) -> Result<ModelSettingsSnapshot, Box<dyn std::error::Error>> {
    Ok(snapshot_from_stored_registry(&read_stored_model_registry(path)?))
}

fn save_model_settings_to_path(
    path: &Path,
    request: SaveModelSettingsRequest,
) -> Result<ModelSettingsSnapshot, Box<dyn std::error::Error>> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut registry = read_stored_model_registry(path)?;
    let normalized = normalize_openai_compatible_settings(&request.base_url, &request.model_name);
    let existing_token = registry
        .profiles
        .iter()
        .find(|profile| profile.id == request.profile_id)
        .and_then(|profile| profile.token.clone());
    let token = request
        .token
        .filter(|value| !value.trim().is_empty())
        .or(existing_token);
    let profile = StoredModelProfile {
        id: request.profile_id,
        name: if request.name.trim().is_empty() {
            profile_name_for(&normalized.1)
        } else {
            request.name.trim().to_string()
        },
        base_url: normalized.0,
        model_name: normalized.1,
        token,
    };

    if let Some(index) = registry
        .profiles
        .iter()
        .position(|item| item.id == profile.id)
    {
        registry.profiles[index] = profile.clone();
    } else {
        registry.profiles.push(profile.clone());
    }

    if request.make_active.unwrap_or(false)
        || !registry
            .profiles
            .iter()
            .any(|item| item.id == registry.active_model_id)
    {
        registry.active_model_id = profile.id;
    }

    fs::write(path, serde_json::to_string_pretty(&registry)?)?;

    Ok(snapshot_from_stored_registry(&registry))
}
```

- [ ] **Step 5: Implement active profile, switch, delete, and local-agent payload resolution**

Add:

```rust
fn active_stored_model_profile(
    registry: &StoredModelRegistry,
) -> Result<StoredModelProfile, String> {
    registry
        .profiles
        .iter()
        .find(|profile| profile.id == registry.active_model_id)
        .or_else(|| registry.profiles.first())
        .cloned()
        .ok_or_else(|| "请先在模型接入里添加模型配置。".to_string())
}

fn draft_to_stored_profile(
    request: TestModelConnectionRequest,
    registry: &StoredModelRegistry,
) -> StoredModelProfile {
    let normalized = normalize_openai_compatible_settings(&request.base_url, &request.model_name);
    let existing_token = registry
        .profiles
        .iter()
        .find(|profile| profile.id == request.profile_id)
        .and_then(|profile| profile.token.clone());

    StoredModelProfile {
        id: request.profile_id,
        name: if request.name.trim().is_empty() {
            profile_name_for(&normalized.1)
        } else {
            request.name.trim().to_string()
        },
        base_url: normalized.0,
        model_name: normalized.1,
        token: request
            .token
            .filter(|value| !value.trim().is_empty())
            .or(existing_token),
    }
}

fn set_active_model_profile_at_path(
    path: &Path,
    profile_id: &str,
) -> Result<ModelSettingsSnapshot, Box<dyn std::error::Error>> {
    let mut registry = read_stored_model_registry(path)?;

    if registry.profiles.iter().any(|profile| profile.id == profile_id) {
        registry.active_model_id = profile_id.to_string();
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_string_pretty(&registry)?)?;

    Ok(snapshot_from_stored_registry(&registry))
}

fn delete_model_profile_at_path(
    path: &Path,
    profile_id: &str,
) -> Result<ModelSettingsSnapshot, Box<dyn std::error::Error>> {
    let mut registry = read_stored_model_registry(path)?;

    if registry.profiles.len() > 1 {
        registry.profiles.retain(|profile| profile.id != profile_id);
        if !registry
            .profiles
            .iter()
            .any(|profile| profile.id == registry.active_model_id)
        {
            registry.active_model_id = registry.profiles[0].id.clone();
        }
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_string_pretty(&registry)?)?;

    Ok(snapshot_from_stored_registry(&registry))
}
```

Update `run_local_agent_prompt` signature and model resolution:

```rust
fn run_local_agent_prompt(
    app: AppHandle,
    prompt: String,
    request: Option<SendPiPromptRequest>,
    draft_model: Option<TestModelConnectionRequest>,
) -> Result<PiPromptResponse, String> {
    let settings_path = settings_path(&app)?;
    let registry = read_stored_model_registry(&settings_path).map_err(|error| error.to_string())?;
    let stored = if let Some(draft) = draft_model {
        draft_to_stored_profile(draft, &registry)
    } else {
        active_stored_model_profile(&registry)?
    };
    let token = stored
        .token
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "请先在模型接入里保存或填写 Token。".to_string())?;
    let agent_dir = local_agent_dir();
    let chat_history_memory = build_chat_history_memory_payload(&app, request.as_ref())?;
    let tool_policy_settings = read_tool_policy_settings_from_path(&tool_policy_settings_path(&app)?)
        .map_err(|error| error.to_string())?;
    let mut payload = build_local_agent_prompt_payload(
        std::env::current_dir()
            .map_err(|error| error.to_string())?
            .to_string_lossy()
            .to_string(),
        &StoredModelProfile {
            token: Some(token),
            ..stored
        },
        prompt,
        chat_history_memory,
        tool_policy_settings,
    );
```

Update `build_local_agent_prompt_payload` to accept `&StoredModelProfile`:

```rust
fn build_local_agent_prompt_payload(
    cwd: String,
    stored: &StoredModelProfile,
    prompt: String,
    chat_history_memory: Option<serde_json::Value>,
    tool_policy_settings: serde_json::Value,
) -> serde_json::Value {
```

The JSON body remains:

```rust
        "modelSettings": {
            "baseUrl": stored.base_url,
            "modelName": stored.model_name
        },
        "runtimeToken": stored.token.clone().unwrap_or_default(),
```

- [ ] **Step 6: Run Rust tests to verify they pass**

Run:

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml model_profile_tests
```

Expected: PASS for the four model profile tests.

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/desktop/src-tauri/src/lib.rs docs/superpowers/plans/2026-05-20-model-profiles.md
git commit -m "feat: persist desktop model profiles"
```

## Task 4: Settings UI And App Global State

**Files:**
- Modify: `apps/desktop/src/components/settings-model.test.ts`
- Modify: `apps/desktop/src/components/settings-model.ts`
- Modify: `apps/desktop/src/components/SystemSettingsPanel.tsx`
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: Write failing tab copy test**

Update `apps/desktop/src/components/settings-model.test.ts` to:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildSettingsTabs } from "./settings-model.ts";

test("buildSettingsTabs puts model access first", () => {
  const tabs = buildSettingsTabs();

  assert.equal(tabs[0]?.id, "model-provider");
  assert.equal(tabs[0]?.label, "模型接入");
  assert.match(tabs[0]?.description ?? "", /多模型配置/);
});
```

- [ ] **Step 2: Run tab test to verify it fails**

Run:

```bash
node --test apps/desktop/src/components/settings-model.test.ts
```

Expected: FAIL because the label is still `模型供应商`.

- [ ] **Step 3: Update settings tab copy**

In `apps/desktop/src/components/settings-model.ts`, change the first tab to:

```ts
    {
      id: "model-provider",
      label: "模型接入",
      description: "保存多模型配置档案，并选择当前聊天使用的模型。"
    },
```

- [ ] **Step 4: Update App to use active profile helpers**

In `apps/desktop/src/App.tsx`, update the model-settings import:

```ts
import {
  buildInitialModelSettings,
  getActiveModelProfile,
  isModelConfigured,
  type ModelSettingsState
} from "./components/model-settings-controller";
```

After `const modelReady = isModelConfigured(modelSettings);`, add:

```ts
  const activeModelProfile = getActiveModelProfile(modelSettings);
```

Replace the missing model system message text with:

```ts
            text: activeModelProfile
              ? `当前模型「${activeModelProfile.name}」还不可用。请先点左下角设置，填写 Base URL、Token 和模型名。`
              : "还没有可用模型。请先点左下角设置，添加一个模型配置档案。",
```

Replace `CompanionInput` `statusHint` with:

```tsx
          statusHint={
            modelReady
              ? undefined
              : activeModelProfile
                ? `当前模型未配置完成：${activeModelProfile.name}`
                : "未配置模型：请先添加模型配置档案"
          }
```

- [ ] **Step 5: Replace model settings form state in SystemSettingsPanel**

In `apps/desktop/src/components/SystemSettingsPanel.tsx`, update the model-settings import to:

```ts
  buildDraftModelProfile,
  buildInitialModelSettings,
  formatOpenAiCompatibleRequestPreview,
  getActiveModelProfile,
  normalizeOpenAiCompatibleSettings,
  type ModelSettingsState,
  type SavedModelProfile
```

Replace the single form state:

```ts
  const [baseUrl, setBaseUrl] = useState(buildInitialModelSettings().baseUrl);
  const [modelName, setModelName] = useState(buildInitialModelSettings().modelName);
  const [token, setToken] = useState("");
  const [tokenHint, setTokenHint] = useState<string | undefined>();
  const [hasToken, setHasToken] = useState(false);
```

with:

```ts
  const [modelSettings, setModelSettings] = useState<ModelSettingsState>(buildInitialModelSettings);
  const [selectedProfileId, setSelectedProfileId] = useState(getActiveModelProfile(buildInitialModelSettings())?.id ?? "default");
  const [draftProfile, setDraftProfile] = useState<SavedModelProfile>(() => getActiveModelProfile(buildInitialModelSettings()) ?? buildDraftModelProfile("default"));
  const [token, setToken] = useState("");
```

Add helpers inside the component before the first `useEffect`:

```ts
  function selectDraftProfile(settings: ModelSettingsState, profileId: string) {
    return settings.profiles.find((profile) => profile.id === profileId)
      ?? getActiveModelProfile(settings)
      ?? buildDraftModelProfile(profileId);
  }

  function updateDraftProfile(patch: Partial<SavedModelProfile>) {
    setDraftProfile((current) => ({ ...current, ...patch }));
    setSaveState("idle");
    setTestState("idle");
    setTestMessage("");
  }
```

In the `loadModelSettings` effect, replace single field setters with:

```ts
      const active = getActiveModelProfile(settings) ?? buildDraftModelProfile("default");
      setModelSettings(settings);
      setSelectedProfileId(active.id);
      setDraftProfile(active);
      setToken("");
      onModelSettingsChange?.(settings);
```

Replace normalized draft and route preview setup with:

```ts
  const activeProfile = getActiveModelProfile(modelSettings);
  const normalizedDraft = normalizeOpenAiCompatibleSettings(draftProfile);
  const routePreview = formatOpenAiCompatibleRequestPreview(draftProfile);
  const didNormalizeBaseUrl = normalizedDraft.baseUrl !== draftProfile.baseUrl.trim().replace(/\/+$/, "");
  const canUseDraft = Boolean(draftProfile.baseUrl.trim() && draftProfile.modelName.trim() && (draftProfile.hasToken || token.trim()));
```

Replace `saveModelSettings` with:

```ts
  async function saveModelSettings(options: { makeActive?: boolean } = {}) {
    setSaveState("saving");

    try {
      const settings = await desktopBackend.saveModelSettings({
        baseUrl: normalizedDraft.baseUrl,
        makeActive: options.makeActive,
        modelName: normalizedDraft.modelName,
        name: draftProfile.name,
        profileId: draftProfile.id,
        token: token.trim() || undefined
      });
      const nextDraft = selectDraftProfile(settings, draftProfile.id);
      setModelSettings(settings);
      setSelectedProfileId(nextDraft.id);
      setDraftProfile(nextDraft);
      setToken("");
      setSaveState("saved");
      setTestState("idle");
      setTestMessage("");
      onModelSettingsChange?.(settings);
    } catch {
      setSaveState("error");
    }
  }
```

Add:

```ts
  async function setActiveProfile(profileId: string) {
    setSaveState("saving");

    try {
      const settings = await desktopBackend.setActiveModelProfile(profileId);
      const nextDraft = selectDraftProfile(settings, profileId);
      setModelSettings(settings);
      setSelectedProfileId(nextDraft.id);
      setDraftProfile(nextDraft);
      setToken("");
      setSaveState("saved");
      onModelSettingsChange?.(settings);
    } catch {
      setSaveState("error");
    }
  }

  async function deleteSelectedProfile() {
    setSaveState("saving");

    try {
      const settings = await desktopBackend.deleteModelProfile(draftProfile.id);
      const nextDraft = getActiveModelProfile(settings) ?? buildDraftModelProfile("default");
      setModelSettings(settings);
      setSelectedProfileId(nextDraft.id);
      setDraftProfile(nextDraft);
      setToken("");
      setSaveState("saved");
      onModelSettingsChange?.(settings);
    } catch {
      setSaveState("error");
    }
  }

  function addModelProfile() {
    const id = `profile-${Date.now()}`;
    const draft = buildDraftModelProfile(id);
    setSelectedProfileId(id);
    setDraftProfile(draft);
    setToken("");
    setSaveState("idle");
    setTestState("idle");
    setTestMessage("");
  }

  function selectModelProfile(profileId: string) {
    const profile = selectDraftProfile(modelSettings, profileId);
    setSelectedProfileId(profile.id);
    setDraftProfile(profile);
    setToken("");
    setSaveState("idle");
    setTestState("idle");
    setTestMessage("");
  }
```

Replace `testModelConnection` with:

```ts
  async function testModelConnection() {
    setTestState("testing");
    setTestMessage("");

    try {
      const result = await desktopBackend.testModelConnection({
        baseUrl: normalizedDraft.baseUrl,
        modelName: normalizedDraft.modelName,
        name: draftProfile.name,
        profileId: draftProfile.id,
        token: token.trim() || undefined
      });
      setTestState("passed");
      setTestMessage(`模型测试通过：${result.text}`);
    } catch (error) {
      setTestState("error");
      setTestMessage(formatUnknownError(error, "模型测试失败。"));
    }
  }
```

- [ ] **Step 6: Replace the model-provider tab JSX**

Inside the `Tabs.Panel` with `id="model-provider"`, replace the current model-provider section with:

```tsx
          <section>
            <header className="settings-section-header">
              <div>
                <h3>{modelProviderTab.label}</h3>
                <p>{modelProviderTab.description}</p>
              </div>
              <Chip className="provider-status" size="sm" variant="soft">
                {activeProfile ? `当前：${activeProfile.name}` : "未选择模型"}
              </Chip>
            </header>

            <div className="model-profile-layout">
              <div className="model-profile-list" aria-label="模型配置档案">
                {modelSettings.profiles.map((profile) => (
                  <button
                    className={`model-profile-item ${selectedProfileId === profile.id ? "selected" : ""}`}
                    key={profile.id}
                    onClick={() => selectModelProfile(profile.id)}
                    type="button"
                  >
                    <span>{profile.name}</span>
                    <small>{profile.modelName || "未填写模型名"}</small>
                    {modelSettings.activeModelId === profile.id ? <strong>当前</strong> : null}
                  </button>
                ))}
                <Button className="settings-secondary-action" onPress={addModelProfile} type="button">
                  新增模型
                </Button>
              </div>

              <div className="openai-compatible-form">
                <label className="settings-input">
                  <span>配置名称</span>
                  <input
                    aria-label="模型配置名称"
                    onChange={(event) => updateDraftProfile({ name: event.target.value })}
                    placeholder="OpenAI GPT-5.2 / 智谱 GLM"
                    value={draftProfile.name}
                  />
                </label>
                <label className="settings-input">
                  <span>Base URL</span>
                  <input
                    aria-label="OpenAI 兼容接口 Base URL"
                    onChange={(event) => updateDraftProfile({ baseUrl: event.target.value })}
                    placeholder="https://open.bigmodel.cn/api/coding/paas/v4"
                    value={draftProfile.baseUrl}
                  />
                </label>
                <label className="settings-input">
                  <span>Token</span>
                  <input
                    aria-label="OpenAI 兼容接口 Token"
                    onChange={(event) => setToken(event.target.value)}
                    placeholder={draftProfile.hasToken ? "留空则继续使用已保存 Token" : "sk-..."}
                    type="password"
                    value={token}
                  />
                </label>
                <label className="settings-input">
                  <span>模型名</span>
                  <input
                    aria-label="OpenAI 兼容接口模型名"
                    onChange={(event) => updateDraftProfile({ modelName: event.target.value })}
                    placeholder="glm-5.1 / gpt-5.2 / qwen3-coder"
                    value={draftProfile.modelName}
                  />
                </label>

                <div className="provider-route-row">
                  <code className="provider-route">{routePreview}</code>
                  <div className="provider-actions">
                    <Button
                      className="settings-secondary-action"
                      isDisabled={!canUseDraft || testState === "testing" || saveState === "saving"}
                      onPress={testModelConnection}
                      type="button"
                    >
                      {testState === "testing" ? "测试中" : "测试模型"}
                    </Button>
                    <Button
                      className="settings-secondary-action"
                      isDisabled={!canUseDraft || saveState === "saving" || modelSettings.activeModelId === draftProfile.id}
                      onPress={() => saveModelSettings({ makeActive: true })}
                      type="button"
                    >
                      设为当前
                    </Button>
                    <Button
                      className="settings-primary-action"
                      isDisabled={!canUseDraft || saveState === "saving"}
                      onPress={() => saveModelSettings({ makeActive: modelSettings.activeModelId === draftProfile.id })}
                      type="button"
                    >
                      {saveState === "saving" ? "保存中" : "保存配置"}
                    </Button>
                  </div>
                </div>
                <div className="provider-actions">
                  <Button
                    className="settings-secondary-action"
                    isDisabled={modelSettings.profiles.length <= 1 || saveState === "saving"}
                    onPress={deleteSelectedProfile}
                    type="button"
                  >
                    删除配置
                  </Button>
                  <Chip className="provider-status" size="sm" variant="soft">
                    {draftProfile.hasToken ? `Token ${draftProfile.tokenHint ?? "已保存"}` : "未保存 Token"}
                  </Chip>
                </div>
                {saveState === "saved" ? <p className="settings-save-note">已保存，下一次发送会使用当前模型配置。</p> : null}
                {saveState === "error" ? <p className="settings-save-note error">保存失败，稍后再试。</p> : null}
                {testState === "passed" ? <p className="settings-save-note">{testMessage}</p> : null}
                {testState === "error" ? <p className="settings-save-note error">{testMessage}</p> : null}
                {didNormalizeBaseUrl ? (
                  <p className="settings-save-note">
                    已识别到 Base URL 里带了模型名或 /chat/completions，保存/测试时会自动改为 {normalizedDraft.baseUrl}。
                  </p>
                ) : null}
              </div>
            </div>
          </section>
```

- [ ] **Step 7: Add focused CSS for the profile list**

In `apps/desktop/src/styles.css`, add:

```css
.model-profile-layout {
  display: grid;
  gap: 16px;
  grid-template-columns: minmax(180px, 0.38fr) minmax(0, 1fr);
}

.model-profile-list {
  display: grid;
  gap: 8px;
  align-content: start;
}

.model-profile-item {
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: inherit;
  cursor: pointer;
  display: grid;
  gap: 4px;
  min-height: 72px;
  padding: 12px;
  text-align: left;
}

.model-profile-item.selected {
  border-color: rgba(125, 211, 252, 0.72);
  background: rgba(14, 165, 233, 0.16);
}

.model-profile-item span {
  font-size: 0.92rem;
  font-weight: 700;
}

.model-profile-item small,
.model-profile-item strong {
  color: rgba(255, 255, 255, 0.68);
  font-size: 0.76rem;
}

@media (max-width: 760px) {
  .model-profile-layout {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 8: Run UI-adjacent tests and typecheck**

Run:

```bash
node --test apps/desktop/src/components/settings-model.test.ts apps/desktop/src/components/model-settings-controller.test.ts apps/desktop/src/components/desktop-backend.test.ts
pnpm --dir apps/desktop typecheck
```

Expected: PASS for tests and typecheck.

- [ ] **Step 9: Commit**

Run:

```bash
git add apps/desktop/src/App.tsx apps/desktop/src/components/SystemSettingsPanel.tsx apps/desktop/src/components/settings-model.ts apps/desktop/src/components/settings-model.test.ts apps/desktop/src/styles.css docs/superpowers/plans/2026-05-20-model-profiles.md
git commit -m "feat: add model profile settings UI"
```

## Task 5: End-To-End Verification

**Files:**
- Modify only if verification exposes issues: files touched in Tasks 1-4.

- [ ] **Step 1: Run desktop component tests**

Run:

```bash
node --test apps/desktop/src/components/*.test.ts
```

Expected: PASS for all desktop component tests.

- [ ] **Step 2: Run local-agent tests**

Run:

```bash
pnpm --dir apps/local-agent test
```

Expected: PASS. This verifies the unchanged local-agent model resolver and prompt runner still accept a single active OpenAI-compatible model payload.

- [ ] **Step 3: Run Tauri Rust tests**

Run:

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

Expected: PASS for Rust tests.

- [ ] **Step 4: Run desktop typecheck**

Run:

```bash
pnpm --dir apps/desktop typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Optional browser preview smoke test**

Run:

```bash
pnpm --dir apps/desktop dev:vite
```

Expected: Vite serves the app on `http://127.0.0.1:1420`. Open it in the in-app browser, open settings, confirm `模型接入` shows a profile list, profile editor, route preview, and disabled/enabled actions according to token state.

- [ ] **Step 6: Commit fixes if verification required changes**

If Step 1-5 required additional fixes, run:

```bash
git add apps/desktop/src apps/desktop/src-tauri/src/lib.rs docs/superpowers/plans/2026-05-20-model-profiles.md
git commit -m "fix: stabilize model profile switching"
```

Skip this commit if verification passes without new changes.
