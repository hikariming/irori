# Pi Web Access WebUI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate Pi web search/fetch access into Cockapoo Pi Companion with a settings UI, provider/key configuration, and a no-key fallback path.

**Architecture:** The desktop sidecar continues to own the embedded Pi SDK session. Cockapoo maps product-level tool ids (`web.search`, `web.fetch`) to the Pi extension tool names registered by `pi-web-access`, loads the package through Pi's `DefaultResourceLoader`, and keeps the safety gate as the final allow/confirm/block authority. Tauri persists web-access settings and the React settings panel edits those settings.

**Tech Stack:** Tauri 2, React 19, TypeScript, Node sidecar ESM, Pi SDK `@earendil-works/pi-coding-agent`, `pi-web-access`.

---

### Task 1: Runtime Tool Mapping

**Files:**
- Modify: `apps/desktop/sidecar/src/tool-policy-runtime.mjs`
- Modify: `apps/desktop/sidecar/test/tool-policy-runtime.test.mjs`
- Modify: `packages/safety/src/runtime.mjs`
- Modify: `packages/safety/src/index.ts`

**Steps:**
1. Write a failing test that enabling `web.search` adds `web_search` and enabling `web.fetch` adds `fetch_content` plus `get_search_content`.
2. Verify the test fails because the current runtime marks web tools unsupported.
3. Add product-tool to Pi-tool mapping and classify web tools as read-only gate tools.
4. Run the focused sidecar and safety tests.

### Task 2: Pi Web Access Package Loading

**Files:**
- Modify: `apps/desktop/sidecar/package.json`
- Modify: `apps/desktop/sidecar/src/pi-session-adapter.mjs`
- Modify: `apps/desktop/sidecar/test/pi-session-adapter.test.mjs`
- Modify: `pnpm-lock.yaml`

**Steps:**
1. Write a failing test proving the sidecar passes a package source for `pi-web-access` into `DefaultResourceLoader`.
2. Add the npm dependency and package source hook while preserving existing extension factories.
3. Configure curator defaults so headless sidecar usage does not require a browser curator.
4. Install/update lockfile, then run sidecar tests.

### Task 3: Web Access Settings Model

**Files:**
- Create: `apps/desktop/src/components/web-access-settings.ts`
- Create: `apps/desktop/src/components/web-access-settings.test.ts`
- Modify: `apps/desktop/src/components/desktop-backend.ts`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

**Steps:**
1. Write tests for default settings, provider normalization, and key presence summaries.
2. Add Tauri commands to load/save settings without exposing saved secret values back to the UI.
3. Ensure defaults use provider `auto`, curator workflow `none`, and no-key fallback enabled.
4. Run component model tests and Rust unit tests that cover payload persistence.

### Task 4: Settings Panel UI

**Files:**
- Modify: `apps/desktop/src/components/settings-model.ts`
- Modify: `apps/desktop/src/components/settings-model.test.ts`
- Modify: `apps/desktop/src/components/SystemSettingsPanel.tsx`
- Modify: `apps/desktop/src/styles.css`

**Steps:**
1. Write tests showing a web-access tab exists and summarizes provider/fallback state.
2. Add the settings tab with provider selection, API key fields, feature toggles, and save feedback.
3. Keep the existing safety tab for per-tool enable/confirm behavior.
4. Run React/component tests and typecheck.

### Task 5: End-to-End Verification

**Files:**
- Modify tests as needed only when behavior changes are intentional.

**Steps:**
1. Run sidecar tests for prompt runner, Pi session adapter, and tool policy.
2. Run frontend model tests and `tsc --noEmit`.
3. Run a dry runtime smoke check that creates a Pi session with web tools enabled and confirms registered tool names are active.
4. Start the desktop dev server if feasible and inspect the settings UI in browser.
