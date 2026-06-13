use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{ChildStdin, Command, Stdio};
use std::str::FromStr;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::{Datelike, Local, TimeZone};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_notification::NotificationExt;

/// Keeps the sidecar child's stdin open for streaming runs so the desktop
/// can answer confirm_request prompts mid-run. Keyed by runId; the entry is
/// removed (closing stdin) when the run finishes.
#[derive(Default)]
struct PromptStdinRegistry(Mutex<HashMap<String, ChildStdin>>);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RespondPiToolConfirmRequest {
    run_id: String,
    confirm_id: String,
    approved: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveModelSettingsRequest {
    profile_id: String,
    name: String,
    base_url: String,
    model_name: String,
    token: Option<String>,
    make_active: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TestModelConnectionRequest {
    profile_id: String,
    name: String,
    base_url: String,
    model_name: String,
    token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelProfileSnapshot {
    id: String,
    name: String,
    base_url: String,
    model_name: String,
    has_token: bool,
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
    id: String,
    name: String,
    base_url: String,
    model_name: String,
    token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredModelRegistry {
    active_model_id: String,
    profiles: Vec<StoredModelProfile>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveWebAccessSettingsRequest {
    provider: String,
    workflow: String,
    #[serde(default = "default_true")]
    no_key_fallback: bool,
    #[serde(default)]
    allow_browser_cookies: bool,
    exa_api_key: Option<String>,
    perplexity_api_key: Option<String>,
    gemini_api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebAccessSettingsSnapshot {
    provider: String,
    workflow: String,
    no_key_fallback: bool,
    allow_browser_cookies: bool,
    exa_has_key: bool,
    exa_key_hint: Option<String>,
    perplexity_has_key: bool,
    perplexity_key_hint: Option<String>,
    gemini_has_key: bool,
    gemini_key_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredWebAccessSettings {
    #[serde(default = "default_web_access_provider")]
    provider: String,
    #[serde(default = "default_web_access_workflow")]
    workflow: String,
    #[serde(default = "default_true")]
    no_key_fallback: bool,
    #[serde(default)]
    allow_browser_cookies: bool,
    exa_api_key: Option<String>,
    perplexity_api_key: Option<String>,
    gemini_api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyStoredModelSettings {
    base_url: String,
    model_name: String,
    token: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendPiPromptRequest {
    character_id: String,
    prompt: String,
    run_id: Option<String>,
    session_prompt: Option<String>,
    session_id: Option<String>,
    browser_snapshot: Option<serde_json::Value>,
    /// 工具审核模式："default"（用户手动）| "auto"（大模型审查）| "all"（全部通过）。
    #[serde(default)]
    review_mode: Option<String>,
}

/// 高级设置：影响编程 / Agent 能力的复杂开关。目前只有子代理委派，默认关闭。
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdvancedSettings {
    #[serde(default)]
    enable_subagents: bool,
}

impl Default for AdvancedSettings {
    fn default() -> Self {
        Self {
            enable_subagents: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PiPromptResponse {
    memory_backend_source: Option<String>,
    model_route: String,
    provider_id: String,
    recalled_memories: Option<Vec<RecalledMemorySnapshot>>,
    text: String,
    tool_policy: Option<serde_json::Value>,
}

#[derive(Debug)]
enum SidecarStreamMessage {
    Progress(serde_json::Value),
    ConfirmRequest(serde_json::Value),
    ScheduleUpsert(serde_json::Value),
    ScheduleCancel(serde_json::Value),
    Final(PiPromptResponse),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecalledMemorySnapshot {
    id: String,
    scope: String,
    kind: String,
    text: String,
    user_id: Option<String>,
    character_id: Option<String>,
    project_id: Option<String>,
    session_id: Option<String>,
    confidence: Option<f64>,
    source_ref: Option<String>,
    approved: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MemoryStatus {
    configured_backend: String,
    fallback_backend: String,
    memory_dir: String,
    sqlite_vec_available: bool,
    tencent_db_package_available: bool,
    vectors_db_exists: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateChatSessionRequest {
    character_id: String,
    title: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppendChatMessageRequest {
    session_id: String,
    speaker: String,
    author: String,
    text: String,
    sticker_id: Option<String>,
    model_route: Option<String>,
    provider_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatSessionSummary {
    id: String,
    character_id: String,
    title: String,
    updated_at: String,
    last_message_preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatMessageRecord {
    id: String,
    session_id: String,
    speaker: String,
    author: String,
    text: String,
    sticker_id: Option<String>,
    model_route: Option<String>,
    provider_id: Option<String>,
    created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddCharacterMomentRequest {
    character_id: String,
    text: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToggleCharacterMomentLikeRequest {
    moment_id: String,
    actor_type: String,
    actor_id: String,
    liked: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddCharacterMomentCommentRequest {
    moment_id: String,
    actor_type: String,
    actor_id: String,
    text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CharacterMomentLikeRecord {
    actor_type: String,
    actor_id: String,
    created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CharacterMomentCommentRecord {
    id: String,
    actor_type: String,
    actor_id: String,
    text: String,
    created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CharacterMomentRecord {
    id: String,
    character_id: String,
    text: String,
    created_at: String,
    likes: Vec<CharacterMomentLikeRecord>,
    comments: Vec<CharacterMomentCommentRecord>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddCharacterLetterRequest {
    character_id: String,
    subject: String,
    body: String,
    mood: Option<String>,
    deliver_at: String,
    #[serde(default)]
    sender: Option<String>,
    #[serde(default)]
    reply_to: Option<String>,
    // 信物类型：postcard | note | gift，省略时按明信片兜底。
    #[serde(default)]
    kind: Option<String>,
    // 类型相关字段的 JSON 字符串（明信片 {place}、礼物 {item}）。
    #[serde(default)]
    meta: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CharacterLetterRecord {
    id: String,
    character_id: String,
    subject: String,
    body: String,
    mood: Option<String>,
    created_at: String,
    deliver_at: String,
    read_at: Option<String>,
    sender: String,
    reply_to: Option<String>,
    kind: String,
    // 原样回传的 JSON 字符串，由前端解析。
    meta: Option<String>,
    reaction: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveSkillRequest {
    name: String,
    description: String,
    body: String,
    #[serde(default)]
    disable_model_invocation: bool,
    #[serde(default)]
    allowed_tools: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillRecord {
    name: String,
    description: String,
    body: String,
    disable_model_invocation: bool,
    allowed_tools: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillAssignmentRecord {
    character_id: String,
    enabled: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveScheduledTaskRequest {
    id: Option<String>,
    character_id: String,
    title: String,
    prompt: String,
    schedule_kind: String,
    schedule_spec: String,
    enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScheduledTask {
    id: String,
    character_id: String,
    title: String,
    prompt: String,
    schedule_kind: String,
    schedule_spec: String,
    enabled: bool,
    source: String,
    /// 下次触发时刻（epoch 毫秒字符串），调度器据此判断到点；null 表示不再触发。
    next_run_at: Option<String>,
    last_run_at: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScheduledTaskRun {
    id: String,
    task_id: String,
    character_id: String,
    scheduled_for: String,
    ran_at: String,
    status: String,
    result: Option<String>,
    error: Option<String>,
    read: bool,
    created_at: String,
}

/// 正在执行中的定时任务 id 集合，防止同一任务（调度 tick 与手动试跑）并发重入。
#[derive(Default)]
struct SchedulerRunning(Mutex<std::collections::HashSet<String>>);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatSessionDetail {
    session: ChatSessionSummary,
    messages: Vec<ChatMessageRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MemoryChatMessage {
    id: String,
    speaker: String,
    text: String,
    created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceEntry {
    /// Absolute filesystem path; doubles as the tree node id on the frontend.
    id: String,
    name: String,
    /// "folder" | "file"
    kind: String,
    /// "workspace" | "computer"
    root_id: String,
    size: Option<u64>,
    modified_at: Option<u64>,
    has_children: bool,
}

/// One file the user dropped onto the chat, after it has been copied into the
/// workspace so the agent's workspace-scoped file tools can read it by `rel_path`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StagedAttachment {
    /// Stable id for the frontend chip; equals the (deduped) on-disk file name.
    id: String,
    /// Original file name shown to the user.
    name: String,
    /// Path relative to the workspace root, e.g. `attachments/report.pdf`.
    rel_path: String,
    /// Absolute path of the copied file.
    abs_path: String,
    size: u64,
    /// Coarse category used only for the UI icon: image | pdf | text | document | file.
    kind: String,
}

const DEFAULT_BASE_URL: &str = "https://api.openai.com/v1";
const DEFAULT_MODEL_NAME: &str = "gpt-5.5";

fn default_true() -> bool {
    true
}

fn default_web_access_provider() -> String {
    "auto".to_string()
}

fn default_web_access_workflow() -> String {
    "none".to_string()
}

#[tauri::command]
fn companion_status() -> &'static str {
    "Irori desktop shell is ready."
}

#[tauri::command]
fn get_model_settings(app: AppHandle) -> Result<ModelSettingsSnapshot, String> {
    read_model_settings_from_path(&settings_path(&app)?).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_model_settings(
    app: AppHandle,
    request: SaveModelSettingsRequest,
) -> Result<ModelSettingsSnapshot, String> {
    save_model_settings_to_path(&settings_path(&app)?, request).map_err(|error| error.to_string())
}

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

#[tauri::command]
fn get_web_access_settings(app: AppHandle) -> Result<WebAccessSettingsSnapshot, String> {
    read_web_access_settings_from_path(&web_access_settings_path(&app)?)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_web_access_settings(
    app: AppHandle,
    request: SaveWebAccessSettingsRequest,
) -> Result<WebAccessSettingsSnapshot, String> {
    save_web_access_settings_to_path(&web_access_settings_path(&app)?, request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn send_pi_prompt(
    app: AppHandle,
    request: SendPiPromptRequest,
) -> Result<PiPromptResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let prompt = request
            .session_prompt
            .clone()
            .unwrap_or_else(|| format!("[character:{}]\n{}", request.character_id, request.prompt));

        run_sidecar_prompt(app, prompt, Some(request), None)
    })
    .await
    .map_err(|error| format!("等待 sidecar 后台任务失败：{error}"))?
}

#[tauri::command]
async fn test_model_connection(
    app: AppHandle,
    request: Option<TestModelConnectionRequest>,
) -> Result<PiPromptResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_sidecar_prompt(
            app,
            "请只回复两个字母：OK。不要解释，不要使用 Markdown。".to_string(),
            None,
            request,
        )
    })
    .await
    .map_err(|error| format!("等待 sidecar 后台任务失败：{error}"))?
}

#[tauri::command]
fn respond_pi_tool_confirm(
    registry: State<'_, PromptStdinRegistry>,
    request: RespondPiToolConfirmRequest,
) -> Result<(), String> {
    let line = serde_json::json!({
        "type": "confirm_response",
        "confirmId": request.confirm_id,
        "approved": request.approved
    });

    let mut guard = registry
        .0
        .lock()
        .map_err(|_| "确认通道状态被污染。".to_string())?;
    let stdin = guard
        .get_mut(&request.run_id)
        .ok_or_else(|| "该请求已结束，无法再确认。".to_string())?;

    stdin
        .write_all(format!("{}\n", line).as_bytes())
        .map_err(|error| format!("写入确认结果失败：{error}"))?;
    stdin
        .flush()
        .map_err(|error| format!("写入确认结果失败：{error}"))?;

    Ok(())
}

#[tauri::command]
fn list_chat_sessions(app: AppHandle) -> Result<Vec<ChatSessionSummary>, String> {
    list_chat_sessions_from_path(&chat_history_path(&app)?).map_err(|error| error.to_string())
}

#[tauri::command]
fn create_chat_session(
    app: AppHandle,
    request: CreateChatSessionRequest,
) -> Result<ChatSessionSummary, String> {
    create_chat_session_at_path(&chat_history_path(&app)?, request, &current_timestamp())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_chat_session(app: AppHandle, session_id: String) -> Result<ChatSessionDetail, String> {
    get_chat_session_from_path(&chat_history_path(&app)?, &session_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_character_states(app: AppHandle) -> Result<serde_json::Value, String> {
    read_character_states_from_path(&chat_history_path(&app)?).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_character_states(
    app: AppHandle,
    states: serde_json::Value,
) -> Result<serde_json::Value, String> {
    save_character_states_to_path(&chat_history_path(&app)?, states, &current_timestamp())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn add_character_moment(
    app: AppHandle,
    request: AddCharacterMomentRequest,
) -> Result<CharacterMomentRecord, String> {
    insert_character_moment_to_path(&chat_history_path(&app)?, request, &current_timestamp())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_character_moments(
    app: AppHandle,
    character_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<CharacterMomentRecord>, String> {
    let limit = limit.unwrap_or(50).clamp(1, 200);
    list_character_moments_from_path(&chat_history_path(&app)?, character_id.as_deref(), limit)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn toggle_character_moment_like(
    app: AppHandle,
    request: ToggleCharacterMomentLikeRequest,
) -> Result<CharacterMomentRecord, String> {
    toggle_character_moment_like_to_path(&chat_history_path(&app)?, request, &current_timestamp())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn add_character_moment_comment(
    app: AppHandle,
    request: AddCharacterMomentCommentRequest,
) -> Result<CharacterMomentRecord, String> {
    add_character_moment_comment_to_path(&chat_history_path(&app)?, request, &current_timestamp())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn add_character_letter(
    app: AppHandle,
    request: AddCharacterLetterRequest,
) -> Result<CharacterLetterRecord, String> {
    insert_character_letter_to_path(&chat_history_path(&app)?, request, &current_timestamp())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_character_letters(
    app: AppHandle,
    character_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<CharacterLetterRecord>, String> {
    let limit = limit.unwrap_or(50).clamp(1, 200);
    list_character_letters_from_path(&chat_history_path(&app)?, character_id.as_deref(), limit)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn mark_character_letter_read(
    app: AppHandle,
    letter_id: String,
) -> Result<CharacterLetterRecord, String> {
    mark_character_letter_read_to_path(&chat_history_path(&app)?, &letter_id, &current_timestamp())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_character_letter_reaction(
    app: AppHandle,
    letter_id: String,
    reaction: Option<String>,
) -> Result<CharacterLetterRecord, String> {
    set_character_letter_reaction_to_path(
        &chat_history_path(&app)?,
        &letter_id,
        reaction.as_deref(),
        &current_timestamp(),
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_skills(app: AppHandle) -> Result<Vec<SkillRecord>, String> {
    list_skills_from_dir(&skills_root_dir(&app)?).map_err(|error| error.to_string())
}

#[tauri::command]
fn create_skill(app: AppHandle, request: SaveSkillRequest) -> Result<SkillRecord, String> {
    create_skill_at_dir(&skills_root_dir(&app)?, request).map_err(|error| error.to_string())
}

#[tauri::command]
fn update_skill(app: AppHandle, request: SaveSkillRequest) -> Result<SkillRecord, String> {
    update_skill_at_dir(&skills_root_dir(&app)?, request).map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_skill(app: AppHandle, name: String) -> Result<(), String> {
    delete_skill_at_dir(&skills_root_dir(&app)?, &chat_history_path(&app)?, &name)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_character_skills(app: AppHandle, character_id: String) -> Result<Vec<String>, String> {
    list_character_skills_from_path(&chat_history_path(&app)?, &character_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_character_skill(
    app: AppHandle,
    character_id: String,
    skill_name: String,
    enabled: bool,
) -> Result<(), String> {
    set_character_skill_to_path(
        &chat_history_path(&app)?,
        &character_id,
        &skill_name,
        enabled,
        &current_timestamp(),
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_skill_assignments(
    app: AppHandle,
    skill_name: String,
) -> Result<Vec<SkillAssignmentRecord>, String> {
    list_skill_assignments_from_path(&chat_history_path(&app)?, &skill_name)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_scheduled_tasks(
    app: AppHandle,
    character_id: Option<String>,
) -> Result<Vec<ScheduledTask>, String> {
    list_scheduled_tasks_from_path(&chat_history_path(&app)?, character_id.as_deref())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn create_scheduled_task(
    app: AppHandle,
    request: SaveScheduledTaskRequest,
) -> Result<ScheduledTask, String> {
    upsert_scheduled_task_at_path(&chat_history_path(&app)?, request, "user", &current_timestamp())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn update_scheduled_task(
    app: AppHandle,
    request: SaveScheduledTaskRequest,
) -> Result<ScheduledTask, String> {
    upsert_scheduled_task_at_path(&chat_history_path(&app)?, request, "user", &current_timestamp())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_scheduled_task(app: AppHandle, id: String) -> Result<(), String> {
    delete_scheduled_task_at_path(&chat_history_path(&app)?, &id).map_err(|error| error.to_string())
}

#[tauri::command]
fn set_scheduled_task_enabled(
    app: AppHandle,
    id: String,
    enabled: bool,
) -> Result<ScheduledTask, String> {
    set_scheduled_task_enabled_at_path(
        &chat_history_path(&app)?,
        &id,
        enabled,
        &current_timestamp(),
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
async fn run_scheduled_task_now(app: AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = chat_history_path(&app)?;
        let task = get_scheduled_task_from_path(&path, &id)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "定时任务不存在。".to_string())?;
        let now = current_timestamp();
        // 手动试跑：advance=false，不改动真实排程（只记录运行 + 通知）。
        execute_scheduled_task(&app, &task, &now, false);
        Ok::<(), String>(())
    })
    .await
    .map_err(|error| format!("等待定时任务执行失败：{error}"))?
}

#[tauri::command]
fn list_task_runs(app: AppHandle, task_id: String) -> Result<Vec<ScheduledTaskRun>, String> {
    list_task_runs_from_path(&chat_history_path(&app)?, &task_id, 30)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn scheduled_unread_count(app: AppHandle) -> Result<i64, String> {
    scheduled_unread_count_from_path(&chat_history_path(&app)?).map_err(|error| error.to_string())
}

#[tauri::command]
fn mark_task_runs_read(app: AppHandle, task_id: Option<String>) -> Result<(), String> {
    mark_task_runs_read_at_path(&chat_history_path(&app)?, task_id.as_deref())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_memory_status(app: AppHandle) -> Result<MemoryStatus, String> {
    Ok(memory_status_from_paths(
        &memory_backend_dir(&app)?,
        &sidecar_dir(&app),
    ))
}

#[tauri::command]
fn get_tool_policy_settings(app: AppHandle) -> Result<serde_json::Value, String> {
    read_tool_policy_settings_from_path(&tool_policy_settings_path(&app)?)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_tool_policy_settings(
    app: AppHandle,
    settings: serde_json::Value,
) -> Result<serde_json::Value, String> {
    save_tool_policy_settings_to_path(&tool_policy_settings_path(&app)?, settings)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_review_mode(app: AppHandle) -> Result<String, String> {
    read_review_mode_from_path(&review_mode_path(&app)?).map_err(|error| error.to_string())
}

#[tauri::command]
fn set_review_mode(app: AppHandle, mode: String) -> Result<String, String> {
    save_review_mode_to_path(&review_mode_path(&app)?, &mode).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_missed_task_policy(app: AppHandle) -> Result<String, String> {
    read_missed_task_policy_from_path(&missed_task_policy_path(&app)?)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn set_missed_task_policy(app: AppHandle, policy: String) -> Result<String, String> {
    save_missed_task_policy_to_path(&missed_task_policy_path(&app)?, &policy)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_advanced_settings(app: AppHandle) -> Result<AdvancedSettings, String> {
    read_advanced_settings_from_path(&advanced_settings_path(&app)?).map_err(|error| error.to_string())
}

#[tauri::command]
fn set_advanced_settings(
    app: AppHandle,
    settings: AdvancedSettings,
) -> Result<AdvancedSettings, String> {
    save_advanced_settings_to_path(&advanced_settings_path(&app)?, settings)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_workspace_path(app: AppHandle) -> Result<String, String> {
    Ok(workspace_root_dir(&app)?.to_string_lossy().to_string())
}

#[tauri::command]
fn set_workspace_path(app: AppHandle, path: String) -> Result<String, String> {
    save_workspace_path(&app, &path)
}

/// Opens the native folder picker and, if the user chooses a directory, persists
/// it as the workspace root and returns the saved path. Returns `None` when the
/// dialog is cancelled. The picker is dispatched off the main thread by the
/// plugin, so this command must be `async` to avoid deadlocking the event loop.
#[tauri::command]
async fn pick_workspace_path(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let (sender, receiver) = std::sync::mpsc::channel();
    app.dialog().file().pick_folder(move |picked| {
        let _ = sender.send(picked);
    });
    let picked = receiver.recv().map_err(|error| error.to_string())?;

    let Some(folder) = picked.and_then(|path| path.into_path().ok()) else {
        return Ok(None);
    };
    save_workspace_path(&app, &folder.to_string_lossy()).map(Some)
}

#[tauri::command]
fn append_chat_message(
    app: AppHandle,
    request: AppendChatMessageRequest,
) -> Result<ChatMessageRecord, String> {
    append_chat_message_to_path(&chat_history_path(&app)?, request, &current_timestamp())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_workspace_roots(app: AppHandle) -> Result<Vec<WorkspaceEntry>, String> {
    let mut roots = Vec::new();

    if let Ok(workspace) = workspace_root_dir(&app) {
        // build_workspace_entry already names it after the cwd folder (e.g. the repo dir).
        if let Some(entry) = build_workspace_entry(&workspace, "workspace") {
            roots.push(entry);
        }
    }

    if let Ok(home) = home_root_dir(&app) {
        if let Some(mut entry) = build_workspace_entry(&home, "computer") {
            entry.name = "这台电脑".to_string();
            roots.push(entry);
        }
    }

    Ok(roots)
}

#[tauri::command]
fn list_workspace_dir(
    app: AppHandle,
    path: String,
    root_id: String,
) -> Result<Vec<WorkspaceEntry>, String> {
    let canonical = fs::canonicalize(PathBuf::from(&path))
        .map_err(|error| format!("无法访问该目录：{error}"))?;

    if !workspace_path_allowed(&app, &canonical) {
        return Err("该路径不在工作区或用户目录内。".to_string());
    }
    if !canonical.is_dir() {
        return Err("该路径不是目录。".to_string());
    }

    read_workspace_dir(&canonical, &root_id)
}

/// Coarse category for the UI chip icon. Purely cosmetic — the agent still reads
/// whatever it finds; this only decides which glyph the chip shows.
fn attachment_kind(path: &Path) -> String {
    let ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_lowercase());

    match ext.as_deref() {
        Some("png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg" | "heic") => "image",
        Some("pdf") => "pdf",
        Some(
            "md" | "markdown" | "txt" | "log" | "json" | "yaml" | "yml" | "toml" | "csv" | "tsv"
            | "rs" | "ts" | "tsx" | "js" | "jsx" | "py" | "go" | "java" | "c" | "cpp" | "h",
        ) => "text",
        Some("docx" | "doc" | "pptx" | "ppt" | "xlsx" | "xls" | "rtf" | "odt") => "document",
        _ => "file",
    }
    .to_string()
}

/// Choose a name inside `dir` that doesn't collide with an existing file, inserting
/// ` (n)` before the extension so repeated drops of the same name never clobber.
fn unique_attachment_path(dir: &Path, file_name: &str) -> PathBuf {
    let candidate = dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }

    let source = Path::new(file_name);
    let stem = source
        .file_stem()
        .map(|stem| stem.to_string_lossy().to_string())
        .unwrap_or_else(|| file_name.to_string());
    let ext = source
        .extension()
        .map(|ext| ext.to_string_lossy().to_string());

    let mut counter = 1;
    loop {
        let next_name = match &ext {
            Some(ext) => format!("{stem} ({counter}).{ext}"),
            None => format!("{stem} ({counter})"),
        };
        let next = dir.join(&next_name);
        if !next.exists() {
            return next;
        }
        counter += 1;
    }
}

/// Copy files the user dropped onto the chat into `<workspace>/attachments/` so the
/// agent can open them with its workspace-scoped file tools, and return one
/// descriptor per file. Sources that aren't readable regular files are skipped
/// rather than failing the whole drop.
#[tauri::command]
fn stage_dropped_files(app: AppHandle, paths: Vec<String>) -> Result<Vec<StagedAttachment>, String> {
    let workspace = workspace_root_dir(&app)?;
    let attachments_dir = workspace.join("attachments");
    fs::create_dir_all(&attachments_dir)
        .map_err(|error| format!("无法创建 attachments 目录：{error}"))?;

    let mut staged = Vec::new();
    for raw in paths {
        let source = PathBuf::from(raw.trim());
        let Ok(metadata) = fs::metadata(&source) else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }

        let file_name = source
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "file".to_string());
        let dest = unique_attachment_path(&attachments_dir, &file_name);
        if fs::copy(&source, &dest).is_err() {
            continue;
        }

        let dest_name = dest
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| file_name.clone());
        staged.push(StagedAttachment {
            id: dest_name.clone(),
            name: file_name,
            rel_path: format!("attachments/{dest_name}"),
            abs_path: dest.to_string_lossy().to_string(),
            size: metadata.len(),
            kind: attachment_kind(&dest),
        });
    }

    Ok(staged)
}

fn run_sidecar_prompt(
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
    let sidecar_runtime = sidecar_runtime(&app)?;
    let chat_history_memory = build_chat_history_memory_payload(&app, request.as_ref())?;
    let tool_policy_settings =
        read_tool_policy_settings_from_path(&tool_policy_settings_path(&app)?)
            .map_err(|error| error.to_string())?;
    let web_access_settings =
        read_stored_web_access_settings(&web_access_settings_path(&app)?)
            .map_err(|error| error.to_string())?;
    let resolved = StoredModelProfile {
        token: Some(token),
        ..stored
    };
    let mut payload = build_sidecar_prompt_payload(
        workspace_root_dir(&app)?.to_string_lossy().to_string(),
        &resolved,
        prompt,
        chat_history_memory,
        tool_policy_settings,
        build_web_access_runtime_config(&web_access_settings),
        request
            .as_ref()
            .and_then(|request| request.browser_snapshot.clone()),
    );
    if let Some(request) = request.as_ref() {
        let memory_dir = memory_backend_dir(&app)?;
        fs::create_dir_all(&memory_dir).map_err(|error| format!("初始化记忆目录失败：{error}"))?;
        payload["memoryBackendConfig"] =
            build_memory_backend_config_payload(&memory_dir, &resolved);
        // 审核模式只对真实聊天（streaming）有意义。请求没带就读持久化设置，
        // 再没有就回落到最安全的「用户手动」。
        let review_mode = match request.review_mode.clone() {
            Some(mode) => sanitize_review_mode(Some(&mode)),
            None => read_review_mode_from_path(&review_mode_path(&app)?).unwrap_or_else(|_| "default".to_string()),
        };
        payload["reviewMode"] = serde_json::Value::String(review_mode);

        // 技能：把技能库根目录 + 该角色启用的技能名单交给 sidecar。sidecar 用
        // skillsOverride 白名单过滤，使本次会话只暴露这个角色会的技能。
        let skills_root = skills_root_dir(&app)?;
        let _ = fs::create_dir_all(&skills_root);
        payload["skillsRootPath"] =
            serde_json::Value::String(skills_root.to_string_lossy().to_string());
        let allowed_skill_names =
            list_character_skills_from_path(&chat_history_path(&app)?, &request.character_id)
                .unwrap_or_default();
        payload["allowedSkillNames"] = serde_json::json!(allowed_skill_names);

        // 技能声明的工具需求（allowed-tools 并集），交给 sidecar 按需放开。
        let skill_required_tools = character_skill_required_tools(
            &skills_root,
            &chat_history_path(&app)?,
            &request.character_id,
        )
        .unwrap_or_default();
        payload["skillRequiredTools"] = serde_json::json!(skill_required_tools);

        // 定时任务：把该角色已登记的任务（精简字段）交给 sidecar，供 schedule_list /
        // schedule_cancel 工具向模型展示与按 id 取消。
        payload["scheduledTasks"] =
            agent_visible_tasks_json(&chat_history_path(&app)?, &request.character_id);
    }

    // 高级设置：开启子代理委派时，让 sidecar 加载 pi-subagents、用持久化会话（worker
    // 默认 context: fork 需要），并把围栏策略写到子进程可继承的配置路径。
    let advanced =
        read_advanced_settings_from_path(&advanced_settings_path(&app)?).unwrap_or_default();
    if advanced.enable_subagents {
        payload["enableSubagents"] = serde_json::Value::Bool(true);
        payload["sessionMode"] = serde_json::Value::String("persistent".to_string());
        payload["toolGateConfigPath"] =
            serde_json::Value::String(tool_gate_config_path(&app)?.to_string_lossy().to_string());
    }

    if let Some(run_id) = request.as_ref().and_then(|request| request.run_id.clone()) {
        payload["streamEvents"] = serde_json::Value::Bool(true);
        payload["runId"] = serde_json::Value::String(run_id);
        let character_id = request.as_ref().map(|request| request.character_id.clone());
        return execute_sidecar_prompt_streaming(app, sidecar_runtime, payload, character_id);
    }

    execute_sidecar_prompt(sidecar_runtime, payload)
}

fn execute_sidecar_prompt(
    runtime: SidecarRuntime,
    payload: serde_json::Value,
) -> Result<PiPromptResponse, String> {
    let mut command = Command::new(&runtime.node_path);
    command.current_dir(&runtime.sidecar_dir);
    for arg in sidecar_prompt_command_args(&runtime.sidecar_dir) {
        command.arg(arg);
    }

    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("启动 sidecar 失败：{error}"))?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(payload.to_string().as_bytes())
            .map_err(|error| format!("写入 prompt 失败：{error}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|error| format!("等待 sidecar 失败：{error}"))?;

    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if error.is_empty() {
            "sidecar prompt 执行失败。".to_string()
        } else {
            error
        });
    }

    let response: PiPromptResponse = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("解析 sidecar 响应失败：{error}"))?;

    if response.text.trim().is_empty() {
        return Err("模型连接成功但没有返回文本，请检查模型是否支持聊天补全。".to_string());
    }

    Ok(response)
}

fn parse_sidecar_stream_line(line: &str) -> Result<SidecarStreamMessage, String> {
    let value: serde_json::Value = serde_json::from_str(line)
        .map_err(|error| format!("解析 sidecar 流式响应失败：{error}"))?;

    match value.get("type").and_then(|item| item.as_str()) {
        Some("progress") => {
            let event = value
                .get("event")
                .cloned()
                .ok_or_else(|| "sidecar 进度事件缺少 event 字段。".to_string())?;

            Ok(SidecarStreamMessage::Progress(event))
        }
        Some("confirm_request") => Ok(SidecarStreamMessage::ConfirmRequest(value)),
        Some("schedule_upsert") => Ok(SidecarStreamMessage::ScheduleUpsert(value)),
        Some("schedule_cancel") => Ok(SidecarStreamMessage::ScheduleCancel(value)),
        Some("final") => {
            let response = value
                .get("response")
                .cloned()
                .ok_or_else(|| "sidecar 最终响应缺少 response 字段。".to_string())?;

            serde_json::from_value(response)
                .map(SidecarStreamMessage::Final)
                .map_err(|error| format!("解析 sidecar 最终响应失败：{error}"))
        }
        _ => serde_json::from_value(value)
            .map(SidecarStreamMessage::Final)
            .map_err(|error| format!("解析 sidecar 响应失败：{error}")),
    }
}

fn read_sidecar_stream(
    app: &AppHandle,
    stdout: std::process::ChildStdout,
    character_id: Option<&str>,
) -> Result<Option<PiPromptResponse>, String> {
    let mut final_response = None;
    let reader = BufReader::new(stdout);

    for line in reader.lines() {
        let line = line.map_err(|error| format!("读取 sidecar 流式响应失败：{error}"))?;
        let line = line.trim();

        if line.is_empty() {
            continue;
        }

        match parse_sidecar_stream_line(line)? {
            SidecarStreamMessage::Progress(event) => {
                app.emit("pi_prompt_progress", event)
                    .map_err(|error| format!("推送模型进度失败：{error}"))?;
            }
            SidecarStreamMessage::ConfirmRequest(request) => {
                app.emit("pi_tool_confirm", request)
                    .map_err(|error| format!("推送工具确认请求失败：{error}"))?;
            }
            SidecarStreamMessage::ScheduleUpsert(message) => {
                // 角色在聊天里自建定时任务：落库（source=agent，归属当前角色），
                // 失败不打断对话流，只是不持久化。
                if let Some(character_id) = character_id {
                    if let Some(task) = message.get("task") {
                        let _ = persist_agent_scheduled_task(app, character_id, task);
                        let _ = app.emit("scheduled_task_changed", ());
                    }
                }
            }
            SidecarStreamMessage::ScheduleCancel(message) => {
                // 角色取消已有任务：只删属于当前角色的，删成功才广播刷新。
                if let Some(character_id) = character_id {
                    if let Some(task_id) = message.get("taskId").and_then(|value| value.as_str()) {
                        if cancel_agent_scheduled_task(app, character_id, task_id).unwrap_or(false) {
                            let _ = app.emit("scheduled_task_changed", ());
                        }
                    }
                }
            }
            SidecarStreamMessage::Final(response) => {
                final_response = Some(response);
            }
        }
    }

    Ok(final_response)
}

fn execute_sidecar_prompt_streaming(
    app: AppHandle,
    runtime: SidecarRuntime,
    payload: serde_json::Value,
    character_id: Option<String>,
) -> Result<PiPromptResponse, String> {
    let mut command = Command::new(&runtime.node_path);
    command.current_dir(&runtime.sidecar_dir);
    for arg in sidecar_prompt_command_args(&runtime.sidecar_dir) {
        command.arg(arg);
    }

    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("启动 sidecar 失败：{error}"))?;

    let run_id = payload
        .get("runId")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "sidecar stdin 不可用。".to_string())?;
    // Take the output handles before parking stdin in the registry, so an
    // unexpected failure here can't leave a dangling confirm channel behind.
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "sidecar stdout 不可用。".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "sidecar stderr 不可用。".to_string())?;

    // Newline-terminate the request so the agent's line reader can start work
    // while stdin stays open for confirm_response messages.
    stdin
        .write_all(format!("{}\n", payload).as_bytes())
        .map_err(|error| format!("写入 prompt 失败：{error}"))?;
    stdin
        .flush()
        .map_err(|error| format!("写入 prompt 失败：{error}"))?;

    if let Some(run_id) = run_id.as_deref() {
        app.state::<PromptStdinRegistry>()
            .0
            .lock()
            .map_err(|_| "确认通道状态被污染。".to_string())?
            .insert(run_id.to_string(), stdin);
    } else {
        drop(stdin);
    }

    let stderr_reader = std::thread::spawn(move || {
        let mut text = String::new();
        let mut reader = BufReader::new(stderr);
        let _ = reader.read_to_string(&mut text);
        text
    });

    let stream_result = read_sidecar_stream(&app, stdout, character_id.as_deref());

    // Always close stdin (drop the parked handle) before returning, so a failed
    // read loop can't leave a dangling confirm channel in the registry.
    if let Some(run_id) = run_id.as_deref() {
        if let Ok(mut registry) = app.state::<PromptStdinRegistry>().0.lock() {
            registry.remove(run_id);
        }
    }

    let final_response = stream_result?;

    let output_status = child
        .wait()
        .map_err(|error| format!("等待 sidecar 失败：{error}"))?;
    let stderr = stderr_reader.join().unwrap_or_default();

    if !output_status.success() {
        let error = stderr.trim().to_string();
        return Err(if error.is_empty() {
            "sidecar prompt 执行失败。".to_string()
        } else {
            error
        });
    }

    let response = final_response
        .ok_or_else(|| "sidecar prompt 没有返回最终响应。".to_string())?;

    if response.text.trim().is_empty() {
        return Err("模型连接成功但没有返回文本，请检查模型是否支持聊天补全。".to_string());
    }

    Ok(response)
}

fn sidecar_prompt_command_args(agent_dir: &Path) -> Vec<String> {
    vec![agent_dir
        .join("bin")
        .join("pi-prompt.mjs")
        .to_string_lossy()
        .to_string()]
}

fn build_sidecar_prompt_payload(
    cwd: String,
    stored: &StoredModelProfile,
    prompt: String,
    chat_history_memory: Option<serde_json::Value>,
    tool_policy_settings: serde_json::Value,
    web_access_settings: serde_json::Value,
    browser_snapshot: Option<serde_json::Value>,
) -> serde_json::Value {
    let mut payload = serde_json::json!({
        "cwd": cwd,
        "modelSettings": {
            "baseUrl": stored.base_url,
            "modelName": stored.model_name
        },
        "runtimeToken": stored.token.clone().unwrap_or_default(),
        "prompt": prompt,
        "toolPolicySettings": tool_policy_settings,
        "webAccessSettings": web_access_settings
    });

    if let Some(memory) = chat_history_memory {
        payload["chatHistoryMemory"] = memory;
    }

    if let Some(snapshot) = browser_snapshot {
        payload["browserSnapshot"] = snapshot;
    }

    payload
}

fn build_chat_history_memory_payload(
    app: &AppHandle,
    request: Option<&SendPiPromptRequest>,
) -> Result<Option<serde_json::Value>, String> {
    let Some(request) = request else {
        return Ok(None);
    };
    let Some(session_id) = request.session_id.as_deref() else {
        return Ok(None);
    };
    let messages = recent_memory_messages_from_path(&chat_history_path(app)?, session_id, 8)
        .map_err(|error| error.to_string())?;

    if messages.is_empty() {
        return Ok(None);
    }

    Ok(Some(serde_json::json!({
        "userId": "local-user",
        "characterId": request.character_id,
        "sessionId": session_id,
        "query": request.prompt,
        "userText": request.prompt,
        "mode": "companion",
        "maxResults": 5,
        "messages": messages
    })))
}

/// The agent's working directory. Defaults to the process cwd (the dir the app
/// was launched from), but the user can override it — see `set_workspace_path`.
/// A saved path that no longer points at a real directory is ignored so a stale
/// setting can't break file browsing or prompts.
fn workspace_root_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(saved) = read_saved_workspace_path(app) {
        return Ok(saved);
    }
    std::env::current_dir().map_err(|error| error.to_string())
}

fn workspace_path_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("workspace-path.json"))
}

fn read_saved_workspace_path(app: &AppHandle) -> Option<PathBuf> {
    let path = workspace_path_path(app).ok()?;
    if !path.exists() {
        return None;
    }
    let value: serde_json::Value = serde_json::from_str(&fs::read_to_string(path).ok()?).ok()?;
    let raw = value.get("path").and_then(|value| value.as_str())?.trim();
    if raw.is_empty() {
        return None;
    }
    let candidate = PathBuf::from(raw);
    candidate.is_dir().then_some(candidate)
}

fn save_workspace_path(app: &AppHandle, path: &str) -> Result<String, String> {
    let canonical = fs::canonicalize(PathBuf::from(path.trim()))
        .map_err(|error| format!("无法访问该目录：{error}"))?;
    if !canonical.is_dir() {
        return Err("该路径不是目录。".to_string());
    }
    let file = workspace_path_path(app)?;
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let value = canonical.to_string_lossy().to_string();
    fs::write(
        &file,
        serde_json::to_string_pretty(&serde_json::json!({ "path": value }))
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    Ok(value)
}

fn home_root_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().home_dir().map_err(|error| error.to_string())
}

/// File browsing is scoped to the workspace (cwd) and the user's home dir, so a
/// crafted path can't walk into arbitrary system locations. Both sides are
/// canonicalized first so symlinks / `..` can't slip past the prefix check.
fn workspace_path_allowed(app: &AppHandle, canonical: &Path) -> bool {
    [workspace_root_dir(app).ok(), home_root_dir(app).ok()]
        .into_iter()
        .flatten()
        .filter_map(|root| fs::canonicalize(root).ok())
        .any(|root| canonical.starts_with(&root))
}

fn entry_modified_ms(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|delta| delta.as_millis() as u64)
}

fn dir_has_children(path: &Path) -> bool {
    fs::read_dir(path)
        .map(|mut entries| entries.next().is_some())
        .unwrap_or(false)
}

fn build_workspace_entry(path: &Path, root_id: &str) -> Option<WorkspaceEntry> {
    let name = path.file_name()?.to_string_lossy().to_string();
    let metadata = fs::metadata(path).ok()?;
    let is_dir = metadata.is_dir();

    Some(WorkspaceEntry {
        id: path.to_string_lossy().to_string(),
        name,
        kind: if is_dir { "folder" } else { "file" }.to_string(),
        root_id: root_id.to_string(),
        size: if is_dir { None } else { Some(metadata.len()) },
        modified_at: entry_modified_ms(&metadata),
        has_children: is_dir && dir_has_children(path),
    })
}

/// List one directory level: folders first, then files, each name-sorted.
/// Unreadable entries are skipped rather than failing the whole listing.
fn read_workspace_dir(dir: &Path, root_id: &str) -> Result<Vec<WorkspaceEntry>, String> {
    let mut entries = Vec::new();

    for dir_entry in fs::read_dir(dir).map_err(|error| format!("读取目录失败：{error}"))? {
        let Ok(dir_entry) = dir_entry else { continue };
        if let Some(entry) = build_workspace_entry(&dir_entry.path(), root_id) {
            entries.push(entry);
        }
    }

    entries.sort_by(|left, right| match (left.kind.as_str(), right.kind.as_str()) {
        ("folder", "file") => std::cmp::Ordering::Less,
        ("file", "folder") => std::cmp::Ordering::Greater,
        _ => left.name.to_lowercase().cmp(&right.name.to_lowercase()),
    });

    Ok(entries)
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("model-settings.json"))
}

fn chat_history_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("chat-history.sqlite3"))
}

fn memory_backend_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("memory-tdai"))
}

fn tool_policy_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("tool-policy-settings.json"))
}

fn web_access_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("web-access-settings.json"))
}

fn review_mode_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("review-mode.json"))
}

fn missed_task_policy_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("missed-task-policy.json"))
}

fn advanced_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("advanced-settings.json"))
}

/// 技能库根目录。每个技能是一个子目录 `<name>/SKILL.md`（pi 标准 skill 形态），
/// 由 SkillsPanel 增删改、会话启动时按角色白名单喂给 pi。
fn skills_root_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("skills"))
}

/// 子代理委派需要一个稳定的 gate 配置路径：sidecar 把策略写到这里，子进程经
/// IRORI_TOOL_GATE_CONFIG 环境变量继承后读取同一份围栏。
fn tool_gate_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("irori-tool-gate.json"))
}

fn build_memory_backend_config_payload(
    memory_dir: &Path,
    stored: &StoredModelProfile,
) -> serde_json::Value {
    let mut llm = serde_json::json!({
        "baseUrl": stored.base_url,
        "model": stored.model_name
    });
    if let Some(token) = stored
        .token
        .as_deref()
        .map(str::trim)
        .filter(|token| !token.is_empty())
    {
        llm["apiKey"] = serde_json::Value::String(token.to_string());
    }

    serde_json::json!({
        "backend": "tencentdb",
        "tencentdb": {
            // rootDataDir is the per-character gateway root; dataDir is kept for
            // the legacy in-process backend that keys off a single store.
            "dataDir": memory_dir.to_string_lossy(),
            "rootDataDir": memory_dir.to_string_lossy(),
            "llm": llm
        }
    })
}

fn memory_status_from_paths(memory_dir: &Path, agent_dir: &Path) -> MemoryStatus {
    let tencentdb_package_dir = agent_dir
        .join("node_modules")
        .join("@tencentdb-agent-memory")
        .join("memory-tencentdb");
    let tencentdb_package_available = tencentdb_package_dir.exists();

    MemoryStatus {
        configured_backend: "tencentdb".to_string(),
        fallback_backend: "chat-history".to_string(),
        memory_dir: memory_dir.to_string_lossy().to_string(),
        sqlite_vec_available: tencentdb_package_available,
        tencent_db_package_available: tencentdb_package_available,
        vectors_db_exists: memory_dir.join("vectors.db").exists(),
    }
}

#[derive(Debug, Clone)]
struct SidecarRuntime {
    node_path: PathBuf,
    sidecar_dir: PathBuf,
}

fn sidecar_runtime(app: &AppHandle) -> Result<SidecarRuntime, String> {
    let sidecar_dir = sidecar_dir(app);
    let entrypoint = sidecar_dir.join("bin").join("pi-prompt.mjs");
    if !entrypoint.exists() {
        return Err(format!(
            "sidecar runtime 缺少入口文件：{}",
            entrypoint.display()
        ));
    }

    Ok(SidecarRuntime {
        node_path: node_command_path(app),
        sidecar_dir,
    })
}

fn node_command_path(app: &AppHandle) -> PathBuf {
    if let Some(path) = bundled_node_path(app) {
        return path;
    }

    PathBuf::from("node")
}

fn bundled_node_path(app: &AppHandle) -> Option<PathBuf> {
    let file_name = if cfg!(windows) { "node.exe" } else { "node" };
    let path = app
        .path()
        .resource_dir()
        .ok()?
        .join("node")
        .join(file_name);

    path.exists().then_some(path)
}

fn sidecar_dir(app: &AppHandle) -> PathBuf {
    if let Some(path) = bundled_sidecar_dir(app) {
        return path;
    }

    source_sidecar_dir()
}

fn bundled_sidecar_dir(app: &AppHandle) -> Option<PathBuf> {
    let path = app.path().resource_dir().ok()?.join("sidecar");
    path.join("bin").join("pi-prompt.mjs").exists().then_some(path)
}

// In development the Pi sidecar lives alongside the Tauri crate at
// apps/desktop/sidecar. Installed apps use the bundled resource copy instead.
fn source_sidecar_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("sidecar")
}

fn default_stored_model_profile() -> StoredModelProfile {
    StoredModelProfile {
        id: "default".to_string(),
        name: "OpenAI GPT-5.5".to_string(),
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
        id: stored.id.clone(),
        name: stored.name.clone(),
        base_url: stored.base_url.clone(),
        model_name: stored.model_name.clone(),
        has_token: token.is_some(),
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

fn read_stored_model_registry(
    path: &Path,
) -> Result<StoredModelRegistry, Box<dyn std::error::Error>> {
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
    Ok(snapshot_from_stored_registry(&read_stored_model_registry(
        path,
    )?))
}

fn save_model_settings_to_path(
    path: &Path,
    request: SaveModelSettingsRequest,
) -> Result<ModelSettingsSnapshot, Box<dyn std::error::Error>> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut registry = read_stored_model_registry(path)?;
    let normalized =
        normalize_openai_compatible_settings(request.base_url.trim(), request.model_name.trim());
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

    if registry
        .profiles
        .iter()
        .any(|profile| profile.id == profile_id)
    {
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

fn normalize_web_access_provider(provider: &str) -> String {
    match provider.trim().to_ascii_lowercase().as_str() {
        "exa" => "exa",
        "perplexity" => "perplexity",
        "gemini" => "gemini",
        _ => "auto",
    }
    .to_string()
}

fn normalize_web_access_workflow(workflow: &str) -> String {
    match workflow.trim().to_ascii_lowercase().as_str() {
        "summary-review" => "summary-review",
        _ => "none",
    }
    .to_string()
}

fn normalize_optional_secret(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn default_stored_web_access_settings() -> StoredWebAccessSettings {
    StoredWebAccessSettings {
        provider: default_web_access_provider(),
        workflow: default_web_access_workflow(),
        no_key_fallback: true,
        allow_browser_cookies: false,
        exa_api_key: None,
        perplexity_api_key: None,
        gemini_api_key: None,
    }
}

fn normalize_stored_web_access_settings(
    stored: StoredWebAccessSettings,
) -> StoredWebAccessSettings {
    StoredWebAccessSettings {
        provider: normalize_web_access_provider(&stored.provider),
        workflow: normalize_web_access_workflow(&stored.workflow),
        no_key_fallback: stored.no_key_fallback,
        allow_browser_cookies: stored.allow_browser_cookies,
        exa_api_key: normalize_optional_secret(stored.exa_api_key),
        perplexity_api_key: normalize_optional_secret(stored.perplexity_api_key),
        gemini_api_key: normalize_optional_secret(stored.gemini_api_key),
    }
}

fn read_stored_web_access_settings(
    path: &Path,
) -> Result<StoredWebAccessSettings, Box<dyn std::error::Error>> {
    if !path.exists() {
        return Ok(default_stored_web_access_settings());
    }

    let stored: StoredWebAccessSettings = serde_json::from_str(&fs::read_to_string(path)?)?;
    Ok(normalize_stored_web_access_settings(stored))
}

fn key_status(key: &Option<String>) -> (bool, Option<String>) {
    let value = key.as_deref().filter(|item| !item.trim().is_empty());
    (value.is_some(), value.map(token_hint))
}

fn snapshot_from_stored_web_access(
    stored: &StoredWebAccessSettings,
) -> WebAccessSettingsSnapshot {
    let (exa_has_key, exa_key_hint) = key_status(&stored.exa_api_key);
    let (perplexity_has_key, perplexity_key_hint) = key_status(&stored.perplexity_api_key);
    let (gemini_has_key, gemini_key_hint) = key_status(&stored.gemini_api_key);

    WebAccessSettingsSnapshot {
        provider: stored.provider.clone(),
        workflow: stored.workflow.clone(),
        no_key_fallback: stored.no_key_fallback,
        allow_browser_cookies: stored.allow_browser_cookies,
        exa_has_key,
        exa_key_hint,
        perplexity_has_key,
        perplexity_key_hint,
        gemini_has_key,
        gemini_key_hint,
    }
}

fn read_web_access_settings_from_path(
    path: &Path,
) -> Result<WebAccessSettingsSnapshot, Box<dyn std::error::Error>> {
    Ok(snapshot_from_stored_web_access(
        &read_stored_web_access_settings(path)?,
    ))
}

fn save_web_access_settings_to_path(
    path: &Path,
    request: SaveWebAccessSettingsRequest,
) -> Result<WebAccessSettingsSnapshot, Box<dyn std::error::Error>> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let existing = read_stored_web_access_settings(path)?;
    let stored = StoredWebAccessSettings {
        provider: normalize_web_access_provider(&request.provider),
        workflow: normalize_web_access_workflow(&request.workflow),
        no_key_fallback: request.no_key_fallback,
        allow_browser_cookies: request.allow_browser_cookies,
        exa_api_key: normalize_optional_secret(request.exa_api_key).or(existing.exa_api_key),
        perplexity_api_key: normalize_optional_secret(request.perplexity_api_key)
            .or(existing.perplexity_api_key),
        gemini_api_key: normalize_optional_secret(request.gemini_api_key)
            .or(existing.gemini_api_key),
    };

    fs::write(path, serde_json::to_string_pretty(&stored)?)?;

    Ok(snapshot_from_stored_web_access(&stored))
}

fn build_web_access_runtime_config(stored: &StoredWebAccessSettings) -> serde_json::Value {
    let mut value = serde_json::json!({
        "provider": stored.provider,
        "workflow": stored.workflow,
        "noKeyFallback": stored.no_key_fallback,
        "allowBrowserCookies": stored.allow_browser_cookies
    });

    if let Some(key) = stored.exa_api_key.as_deref() {
        value["exaApiKey"] = serde_json::Value::String(key.to_string());
    }
    if let Some(key) = stored.perplexity_api_key.as_deref() {
        value["perplexityApiKey"] = serde_json::Value::String(key.to_string());
    }
    if let Some(key) = stored.gemini_api_key.as_deref() {
        value["geminiApiKey"] = serde_json::Value::String(key.to_string());
    }

    value
}

fn default_tool_policy_settings() -> serde_json::Value {
    serde_json::json!({
        "builtinTools": {
            "read": true,
            "grep": true,
            "find": true,
            "ls": true,
            "bash": true,
            "edit": true,
            "write": true
        },
        "customTools": {
            "memory.read": true,
            "memory.write": true,
            "web.fetch": true,
            "web.search": true,
            "browser.view": true,
            "browser.action": true
        },
        "confirmTools": {
            "bash": true,
            "edit": true,
            "write": true,
            "memory.write": true,
            "browser.action": true
        },
        "protectedPaths": [
            ".env",
            ".env.*",
            "secrets.*",
            "credentials.*",
            ".ssh",
            ".aws",
            ".gnupg",
            "node_modules"
        ]
    })
}

fn sanitize_review_mode(value: Option<&str>) -> String {
    match value {
        Some("auto") => "auto",
        Some("all") => "all",
        _ => "default",
    }
    .to_string()
}

fn read_review_mode_from_path(path: &Path) -> Result<String, Box<dyn std::error::Error>> {
    if !path.exists() {
        return Ok("default".to_string());
    }

    let value: serde_json::Value = serde_json::from_str(&fs::read_to_string(path)?)?;
    Ok(sanitize_review_mode(
        value.get("mode").and_then(|mode| mode.as_str()),
    ))
}

fn save_review_mode_to_path(
    path: &Path,
    mode: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    let mode = sanitize_review_mode(Some(mode));

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_string_pretty(&serde_json::json!({ "mode": mode }))?)?;

    Ok(mode)
}

/// 错过补跑策略："catchup"（开机/久眠后把错过的任务补跑一次，默认）| "skip"
/// （不补跑，只把下次触发推到未来）。
fn sanitize_missed_task_policy(value: Option<&str>) -> String {
    match value {
        Some("skip") => "skip",
        _ => "catchup",
    }
    .to_string()
}

fn read_missed_task_policy_from_path(path: &Path) -> Result<String, Box<dyn std::error::Error>> {
    if !path.exists() {
        return Ok("catchup".to_string());
    }
    let value: serde_json::Value = serde_json::from_str(&fs::read_to_string(path)?)?;
    Ok(sanitize_missed_task_policy(
        value.get("policy").and_then(|policy| policy.as_str()),
    ))
}

fn save_missed_task_policy_to_path(
    path: &Path,
    policy: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    let policy = sanitize_missed_task_policy(Some(policy));
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(
        path,
        serde_json::to_string_pretty(&serde_json::json!({ "policy": policy }))?,
    )?;
    Ok(policy)
}

fn read_advanced_settings_from_path(
    path: &Path,
) -> Result<AdvancedSettings, Box<dyn std::error::Error>> {
    if !path.exists() {
        return Ok(AdvancedSettings::default());
    }

    Ok(serde_json::from_str(&fs::read_to_string(path)?).unwrap_or_default())
}

fn save_advanced_settings_to_path(
    path: &Path,
    settings: AdvancedSettings,
) -> Result<AdvancedSettings, Box<dyn std::error::Error>> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::write(path, serde_json::to_string_pretty(&settings)?)?;

    Ok(settings)
}

fn read_tool_policy_settings_from_path(
    path: &Path,
) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    if !path.exists() {
        return Ok(default_tool_policy_settings());
    }

    Ok(serde_json::from_str(&fs::read_to_string(path)?)?)
}

fn save_tool_policy_settings_to_path(
    path: &Path,
    settings: serde_json::Value,
) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::write(path, serde_json::to_string_pretty(&settings)?)?;

    Ok(settings)
}

fn normalize_openai_compatible_settings(base_url: &str, model_name: &str) -> (String, String) {
    let mut base_url = base_url.trim_end_matches('/').to_string();
    let model_name = model_name.trim().to_string();
    let lower_base_url = base_url.to_lowercase();
    let lower_model_name = model_name.to_lowercase();

    if !lower_model_name.is_empty() && lower_base_url.ends_with(&format!("/{lower_model_name}")) {
        let new_len = base_url.len().saturating_sub(model_name.len() + 1);
        base_url.truncate(new_len);
    }

    if base_url.to_lowercase().ends_with("/chat/completions") {
        let new_len = base_url.len().saturating_sub("/chat/completions".len());
        base_url.truncate(new_len);
    }

    (base_url, model_name)
}

fn current_timestamp() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();

    format!("{millis}")
}

fn compact_id(prefix: &str, timestamp: &str) -> String {
    let compact: String = timestamp
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect();
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();

    format!("{prefix}-{compact}-{suffix}")
}

fn init_chat_history_at_path(path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let connection = Connection::open(path)?;
    connection.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS chat_sessions (
          id TEXT PRIMARY KEY,
          character_id TEXT NOT NULL,
          title TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_message_preview TEXT NOT NULL DEFAULT '',
          pi_session_ref TEXT,
          archived INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS chat_messages (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          speaker TEXT NOT NULL,
          author TEXT NOT NULL,
          text TEXT NOT NULL,
          mode TEXT,
          sticker_id TEXT,
          model_route TEXT,
          provider_id TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY(session_id) REFERENCES chat_sessions(id)
        );

        CREATE TABLE IF NOT EXISTS character_state (
          character_id TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS character_moment (
          id TEXT PRIMARY KEY,
          character_id TEXT NOT NULL,
          text TEXT NOT NULL,
          mood TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS character_moment_like (
          moment_id TEXT NOT NULL,
          actor_type TEXT NOT NULL,
          actor_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY(moment_id, actor_type, actor_id),
          FOREIGN KEY(moment_id) REFERENCES character_moment(id)
        );

        CREATE TABLE IF NOT EXISTS character_moment_comment (
          id TEXT PRIMARY KEY,
          moment_id TEXT NOT NULL,
          actor_type TEXT NOT NULL,
          actor_id TEXT NOT NULL,
          text TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY(moment_id) REFERENCES character_moment(id)
        );

        CREATE TABLE IF NOT EXISTS character_letter (
          id TEXT PRIMARY KEY,
          character_id TEXT NOT NULL,
          subject TEXT NOT NULL,
          body TEXT NOT NULL,
          mood TEXT,
          created_at TEXT NOT NULL,
          deliver_at TEXT NOT NULL,
          read_at TEXT,
          sender TEXT NOT NULL DEFAULT 'character',
          reply_to TEXT,
          kind TEXT NOT NULL DEFAULT 'postcard',
          meta TEXT,
          reaction TEXT
        );

        CREATE TABLE IF NOT EXISTS character_skill (
          character_id TEXT NOT NULL,
          skill_name TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          PRIMARY KEY(character_id, skill_name)
        );

        CREATE TABLE IF NOT EXISTS scheduled_task (
          id TEXT PRIMARY KEY,
          character_id TEXT NOT NULL,
          title TEXT NOT NULL,
          prompt TEXT NOT NULL,
          schedule_kind TEXT NOT NULL,
          schedule_spec TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          source TEXT NOT NULL DEFAULT 'user',
          next_run_at TEXT,
          last_run_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS scheduled_task_run (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          character_id TEXT NOT NULL,
          scheduled_for TEXT NOT NULL,
          ran_at TEXT NOT NULL,
          status TEXT NOT NULL,
          result TEXT,
          error TEXT,
          read INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_scheduled_task_due
          ON scheduled_task(enabled, next_run_at);
        CREATE INDEX IF NOT EXISTS idx_scheduled_task_character
          ON scheduled_task(character_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_scheduled_task_run_task
          ON scheduled_task_run(task_id, ran_at DESC);
        CREATE INDEX IF NOT EXISTS idx_scheduled_task_run_unread
          ON scheduled_task_run(read);

        CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at
          ON chat_sessions(updated_at DESC);

        CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created_at
          ON chat_messages(session_id, created_at ASC);

        CREATE INDEX IF NOT EXISTS idx_character_moment_character_created_at
          ON character_moment(character_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_character_moment_like_moment
          ON character_moment_like(moment_id, created_at ASC);

        CREATE INDEX IF NOT EXISTS idx_character_moment_comment_moment
          ON character_moment_comment(moment_id, created_at ASC);

        CREATE INDEX IF NOT EXISTS idx_character_letter_character_deliver_at
          ON character_letter(character_id, deliver_at DESC);

        CREATE INDEX IF NOT EXISTS idx_character_skill_skill
          ON character_skill(skill_name);
        "#,
    )?;

    // 老库迁移：早于双向通信的 character_letter 没有 sender/reply_to 列，补上。
    // 列已存在时 ALTER 会报错，忽略即可。
    let _ = connection.execute(
        "ALTER TABLE character_letter ADD COLUMN sender TEXT NOT NULL DEFAULT 'character'",
        [],
    );
    let _ = connection.execute("ALTER TABLE character_letter ADD COLUMN reply_to TEXT", []);

    // 信物化迁移：把单一「信件」拆成明信片/便利贴/小礼物三种 kind，
    // meta 存生成期类型字段（地点/物件），reaction 存用户的表情/短回应。
    // 老库历史信件按 'postcard' 兜底渲染。列已存在时 ALTER 报错，忽略即可。
    let _ = connection.execute(
        "ALTER TABLE character_letter ADD COLUMN kind TEXT NOT NULL DEFAULT 'postcard'",
        [],
    );
    let _ = connection.execute("ALTER TABLE character_letter ADD COLUMN meta TEXT", []);
    let _ = connection.execute("ALTER TABLE character_letter ADD COLUMN reaction TEXT", []);

    Ok(())
}

fn read_character_states_from_path(
    path: &Path,
) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    let connection = open_chat_history(path)?;
    let mut statement = connection.prepare("SELECT character_id, payload FROM character_state")?;
    let rows = statement.query_map([], |row| {
        let id: String = row.get(0)?;
        let payload: String = row.get(1)?;
        Ok((id, payload))
    })?;

    let mut map = serde_json::Map::new();
    for row in rows {
        let (id, payload) = row?;
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&payload) {
            map.insert(id, value);
        }
    }

    Ok(serde_json::Value::Object(map))
}

fn save_character_states_to_path(
    path: &Path,
    states: serde_json::Value,
    now: &str,
) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    let connection = open_chat_history(path)?;
    if let Some(object) = states.as_object() {
        for (id, value) in object {
            let payload = serde_json::to_string(value)?;
            connection.execute(
                "INSERT INTO character_state (character_id, payload, updated_at)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(character_id)
                 DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
                params![id, payload, now],
            )?;
        }
    }

    Ok(states)
}

fn insert_character_moment_to_path(
    path: &Path,
    request: AddCharacterMomentRequest,
    now: &str,
) -> Result<CharacterMomentRecord, Box<dyn std::error::Error>> {
    let connection = open_chat_history(path)?;
    let id = compact_id("moment", &format!("{}{}", now, request.character_id));

    connection.execute(
        "INSERT INTO character_moment (id, character_id, text, created_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![id, request.character_id, request.text, now],
    )?;

    get_character_moment_record(&connection, &id)?
        .ok_or_else(|| "stored character moment could not be loaded".into())
}

fn list_character_moments_from_path(
    path: &Path,
    character_id: Option<&str>,
    limit: i64,
) -> Result<Vec<CharacterMomentRecord>, Box<dyn std::error::Error>> {
    let connection = open_chat_history(path)?;
    let mut moments = Vec::new();

    if let Some(character_id) = character_id {
        let mut statement = connection.prepare(
            "SELECT id, character_id, text, created_at
             FROM character_moment
             WHERE character_id = ?1
             ORDER BY created_at DESC
             LIMIT ?2",
        )?;
        let rows = statement.query_map(params![character_id, limit], row_to_character_moment_record)?;
        for row in rows {
            moments.push(hydrate_character_moment_record(&connection, row?)?);
        }
    } else {
        let mut statement = connection.prepare(
            "SELECT id, character_id, text, created_at
             FROM character_moment
             ORDER BY created_at DESC
             LIMIT ?1",
        )?;
        let rows = statement.query_map(params![limit], row_to_character_moment_record)?;
        for row in rows {
            moments.push(hydrate_character_moment_record(&connection, row?)?);
        }
    }

    Ok(moments)
}

fn get_character_moment_record(
    connection: &Connection,
    id: &str,
) -> Result<Option<CharacterMomentRecord>, rusqlite::Error> {
    connection
        .query_row(
            "SELECT id, character_id, text, created_at
             FROM character_moment
             WHERE id = ?1",
            params![id],
            row_to_character_moment_record,
        )
        .optional()?
        .map(|record| hydrate_character_moment_record(connection, record))
        .transpose()
}

fn row_to_character_moment_record(
    row: &rusqlite::Row<'_>,
) -> Result<CharacterMomentRecord, rusqlite::Error> {
    Ok(CharacterMomentRecord {
        id: row.get(0)?,
        character_id: row.get(1)?,
        text: row.get(2)?,
        created_at: row.get(3)?,
        likes: Vec::new(),
        comments: Vec::new(),
    })
}

fn hydrate_character_moment_record(
    connection: &Connection,
    mut record: CharacterMomentRecord,
) -> Result<CharacterMomentRecord, rusqlite::Error> {
    let mut likes_statement = connection.prepare(
        "SELECT actor_type, actor_id, created_at
         FROM character_moment_like
         WHERE moment_id = ?1
         ORDER BY created_at ASC",
    )?;
    let like_rows = likes_statement.query_map(params![&record.id], |row| {
        Ok(CharacterMomentLikeRecord {
            actor_type: row.get(0)?,
            actor_id: row.get(1)?,
            created_at: row.get(2)?,
        })
    })?;
    for row in like_rows {
        record.likes.push(row?);
    }

    let mut comments_statement = connection.prepare(
        "SELECT id, actor_type, actor_id, text, created_at
         FROM character_moment_comment
         WHERE moment_id = ?1
         ORDER BY created_at ASC",
    )?;
    let comment_rows = comments_statement.query_map(params![&record.id], |row| {
        Ok(CharacterMomentCommentRecord {
            id: row.get(0)?,
            actor_type: row.get(1)?,
            actor_id: row.get(2)?,
            text: row.get(3)?,
            created_at: row.get(4)?,
        })
    })?;
    for row in comment_rows {
        record.comments.push(row?);
    }

    Ok(record)
}

fn normalize_moment_actor(
    actor_type: &str,
    actor_id: &str,
) -> Result<(String, String), Box<dyn std::error::Error>> {
    let actor_type = actor_type.trim();
    let actor_id = actor_id.trim();
    if actor_type != "user" && actor_type != "character" {
        return Err("动态互动来源不合法。".into());
    }
    if actor_id.is_empty() {
        return Err("动态互动来源缺少 id。".into());
    }
    Ok((actor_type.to_string(), actor_id.to_string()))
}

fn toggle_character_moment_like_to_path(
    path: &Path,
    request: ToggleCharacterMomentLikeRequest,
    now: &str,
) -> Result<CharacterMomentRecord, Box<dyn std::error::Error>> {
    let connection = open_chat_history(path)?;
    if get_character_moment_record(&connection, &request.moment_id)?.is_none() {
        return Err("动态不存在。".into());
    }
    let (actor_type, actor_id) = normalize_moment_actor(&request.actor_type, &request.actor_id)?;

    if request.liked {
        connection.execute(
            "INSERT OR IGNORE INTO character_moment_like (moment_id, actor_type, actor_id, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![request.moment_id, actor_type, actor_id, now],
        )?;
    } else {
        connection.execute(
            "DELETE FROM character_moment_like
             WHERE moment_id = ?1 AND actor_type = ?2 AND actor_id = ?3",
            params![request.moment_id, actor_type, actor_id],
        )?;
    }

    get_character_moment_record(&connection, &request.moment_id)?
        .ok_or_else(|| "updated character moment could not be loaded".into())
}

fn add_character_moment_comment_to_path(
    path: &Path,
    request: AddCharacterMomentCommentRequest,
    now: &str,
) -> Result<CharacterMomentRecord, Box<dyn std::error::Error>> {
    let connection = open_chat_history(path)?;
    if get_character_moment_record(&connection, &request.moment_id)?.is_none() {
        return Err("动态不存在。".into());
    }
    let (actor_type, actor_id) = normalize_moment_actor(&request.actor_type, &request.actor_id)?;
    let text = request.text.trim();
    if text.is_empty() {
        return Err("评论不能为空。".into());
    }
    let id = compact_id("moment-comment", &format!("{}{}", now, request.moment_id));

    connection.execute(
        "INSERT INTO character_moment_comment (id, moment_id, actor_type, actor_id, text, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, request.moment_id, actor_type, actor_id, text, now],
    )?;

    get_character_moment_record(&connection, &request.moment_id)?
        .ok_or_else(|| "updated character moment could not be loaded".into())
}

fn insert_character_letter_to_path(
    path: &Path,
    request: AddCharacterLetterRequest,
    now: &str,
) -> Result<CharacterLetterRecord, Box<dyn std::error::Error>> {
    let connection = open_chat_history(path)?;
    let id = compact_id("letter", &format!("{}{}", now, request.character_id));
    let sender = match request.sender.as_deref() {
        Some("user") => "user",
        _ => "character",
    };
    let kind = match request.kind.as_deref() {
        Some("note") => "note",
        Some("gift") => "gift",
        _ => "postcard",
    };

    connection.execute(
        "INSERT INTO character_letter (id, character_id, subject, body, mood, created_at, deliver_at, read_at, sender, reply_to, kind, meta, reaction)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, ?9, ?10, ?11, NULL)",
        params![
            id,
            request.character_id,
            request.subject,
            request.body,
            request.mood,
            now,
            request.deliver_at,
            sender,
            request.reply_to,
            kind,
            request.meta
        ],
    )?;

    get_character_letter_record(&connection, &id)?
        .ok_or_else(|| "stored character letter could not be loaded".into())
}

fn list_character_letters_from_path(
    path: &Path,
    character_id: Option<&str>,
    limit: i64,
) -> Result<Vec<CharacterLetterRecord>, Box<dyn std::error::Error>> {
    let connection = open_chat_history(path)?;
    let mut letters = Vec::new();

    if let Some(character_id) = character_id {
        let mut statement = connection.prepare(
            "SELECT id, character_id, subject, body, mood, created_at, deliver_at, read_at, sender, reply_to, kind, meta, reaction
             FROM character_letter
             WHERE character_id = ?1
             ORDER BY deliver_at DESC
             LIMIT ?2",
        )?;
        let rows = statement.query_map(params![character_id, limit], row_to_character_letter_record)?;
        for row in rows {
            letters.push(row?);
        }
    } else {
        let mut statement = connection.prepare(
            "SELECT id, character_id, subject, body, mood, created_at, deliver_at, read_at, sender, reply_to, kind, meta, reaction
             FROM character_letter
             ORDER BY deliver_at DESC
             LIMIT ?1",
        )?;
        let rows = statement.query_map(params![limit], row_to_character_letter_record)?;
        for row in rows {
            letters.push(row?);
        }
    }

    Ok(letters)
}

fn mark_character_letter_read_to_path(
    path: &Path,
    letter_id: &str,
    now: &str,
) -> Result<CharacterLetterRecord, Box<dyn std::error::Error>> {
    let connection = open_chat_history(path)?;
    connection.execute(
        "UPDATE character_letter SET read_at = ?2 WHERE id = ?1 AND read_at IS NULL",
        params![letter_id, now],
    )?;

    get_character_letter_record(&connection, letter_id)?
        .ok_or_else(|| "character letter not found".into())
}

// 写入用户对某件信物的回应（表情 / 一句短话），reaction 为 JSON 字符串。
// 同时把这件信物标记为已读（点表情即视作看过）。
fn set_character_letter_reaction_to_path(
    path: &Path,
    letter_id: &str,
    reaction: Option<&str>,
    now: &str,
) -> Result<CharacterLetterRecord, Box<dyn std::error::Error>> {
    let connection = open_chat_history(path)?;
    connection.execute(
        "UPDATE character_letter
         SET reaction = ?2, read_at = COALESCE(read_at, ?3)
         WHERE id = ?1",
        params![letter_id, reaction, now],
    )?;

    get_character_letter_record(&connection, letter_id)?
        .ok_or_else(|| "character letter not found".into())
}

fn get_character_letter_record(
    connection: &Connection,
    id: &str,
) -> Result<Option<CharacterLetterRecord>, rusqlite::Error> {
    connection
        .query_row(
            "SELECT id, character_id, subject, body, mood, created_at, deliver_at, read_at, sender, reply_to, kind, meta, reaction
             FROM character_letter
             WHERE id = ?1",
            params![id],
            row_to_character_letter_record,
        )
        .optional()
}

fn row_to_character_letter_record(
    row: &rusqlite::Row<'_>,
) -> Result<CharacterLetterRecord, rusqlite::Error> {
    Ok(CharacterLetterRecord {
        id: row.get(0)?,
        character_id: row.get(1)?,
        subject: row.get(2)?,
        body: row.get(3)?,
        mood: row.get(4)?,
        created_at: row.get(5)?,
        deliver_at: row.get(6)?,
        read_at: row.get(7)?,
        sender: row.get(8)?,
        reply_to: row.get(9)?,
        kind: row.get(10)?,
        meta: row.get(11)?,
        reaction: row.get(12)?,
    })
}

fn open_chat_history(path: &Path) -> Result<Connection, Box<dyn std::error::Error>> {
    init_chat_history_at_path(path)?;
    Ok(Connection::open(path)?)
}

// ----- Skills (pi standard SKILL.md library) -----------------------------------

/// pi 的 skill 名约束（agentskills.io 规范）：1-64 字、全小写 `a-z0-9-`、不能首尾
/// 连字符、不能连续连字符，且必须等于父目录名。建库前先校验，避免 pi 静默丢弃。
fn is_valid_skill_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 64 {
        return false;
    }
    if name.starts_with('-') || name.ends_with('-') || name.contains("--") {
        return false;
    }
    name.chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// 把任意文本写成 YAML 双引号标量，保证 description 里的中文标点 / 冒号不破坏
/// frontmatter。与下面的 `yaml_unquote` 互逆。
fn yaml_quote(value: &str) -> String {
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

fn yaml_unquote(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() >= 2 && trimmed.starts_with('"') && trimmed.ends_with('"') {
        let inner = &trimmed[1..trimmed.len() - 1];
        inner.replace("\\\"", "\"").replace("\\\\", "\\")
    } else {
        trimmed.to_string()
    }
}

/// 解析 SKILL.md：拆出 description / disable-model-invocation / allowed-tools 与正文。
/// 技能名以目录名为准（pi 规范要求 name == 目录名），所以这里不解析 frontmatter 里的
/// name。`fallback_name` 仅用于无 frontmatter 时保持签名一致。
/// 返回 `(description, body, disable, allowed_tools)`。
fn parse_skill_md(content: &str, _fallback_name: &str) -> (String, String, bool, Vec<String>) {
    let normalized = content.replace("\r\n", "\n");
    let mut description = String::new();
    let mut disable = false;
    let mut allowed_tools = Vec::new();

    let body = if let Some(rest) = normalized.strip_prefix("---\n") {
        if let Some(end) = rest.find("\n---") {
            let front = &rest[..end];
            for line in front.lines() {
                let Some((key, raw)) = line.split_once(':') else {
                    continue;
                };
                match key.trim() {
                    "description" => description = yaml_unquote(raw),
                    "disable-model-invocation" => disable = raw.trim() == "true",
                    // pi 规范：allowed-tools 是空格分隔的工具名列表。
                    "allowed-tools" => {
                        allowed_tools = raw
                            .split_whitespace()
                            .map(str::to_string)
                            .collect();
                    }
                    _ => {}
                }
            }
            // 跳过闭合的 `---` 行后剩余内容即正文。
            let after = &rest[end + 4..];
            after.trim_start_matches('\n').to_string()
        } else {
            normalized.clone()
        }
    } else {
        normalized.clone()
    };

    (description, body.trim_end().to_string(), disable, allowed_tools)
}

fn render_skill_md(
    name: &str,
    description: &str,
    body: &str,
    disable: bool,
    allowed_tools: &[String],
) -> String {
    let tools_line = if allowed_tools.is_empty() {
        String::new()
    } else {
        format!("allowed-tools: {}\n", allowed_tools.join(" "))
    };
    format!(
        "---\nname: {name}\ndescription: {desc}\ndisable-model-invocation: {disable}\n{tools_line}---\n\n{body}\n",
        desc = yaml_quote(description.trim()),
        body = body.trim()
    )
}

fn read_skill_from_dir(dir: &Path, name: &str) -> Result<SkillRecord, Box<dyn std::error::Error>> {
    let content = fs::read_to_string(dir.join("SKILL.md"))?;
    let (description, body, disable, allowed_tools) = parse_skill_md(&content, name);
    Ok(SkillRecord {
        name: name.to_string(),
        description,
        body,
        disable_model_invocation: disable,
        allowed_tools,
    })
}

fn list_skills_from_dir(root: &Path) -> Result<Vec<SkillRecord>, Box<dyn std::error::Error>> {
    let mut skills = Vec::new();
    if !root.exists() {
        return Ok(skills);
    }
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_dir() || !path.join("SKILL.md").exists() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        skills.push(read_skill_from_dir(&path, name)?);
    }
    skills.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(skills)
}

fn create_skill_at_dir(
    root: &Path,
    request: SaveSkillRequest,
) -> Result<SkillRecord, Box<dyn std::error::Error>> {
    if !is_valid_skill_name(&request.name) {
        return Err("技能名只能用小写字母、数字和连字符，且不能以连字符开头/结尾。".into());
    }
    let dir = root.join(&request.name);
    if dir.exists() {
        return Err("已存在同名技能。".into());
    }
    fs::create_dir_all(&dir)?;
    fs::write(
        dir.join("SKILL.md"),
        render_skill_md(
            &request.name,
            &request.description,
            &request.body,
            request.disable_model_invocation,
            &request.allowed_tools,
        ),
    )?;
    read_skill_from_dir(&dir, &request.name)
}

fn update_skill_at_dir(
    root: &Path,
    request: SaveSkillRequest,
) -> Result<SkillRecord, Box<dyn std::error::Error>> {
    if !is_valid_skill_name(&request.name) {
        return Err("技能名不合法。".into());
    }
    let dir = root.join(&request.name);
    if !dir.exists() {
        return Err("技能不存在。".into());
    }
    fs::write(
        dir.join("SKILL.md"),
        render_skill_md(
            &request.name,
            &request.description,
            &request.body,
            request.disable_model_invocation,
            &request.allowed_tools,
        ),
    )?;
    read_skill_from_dir(&dir, &request.name)
}

fn delete_skill_at_dir(
    root: &Path,
    chat_history: &Path,
    name: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    if !is_valid_skill_name(name) {
        return Err("技能名不合法。".into());
    }
    let dir = root.join(name);
    if dir.exists() {
        fs::remove_dir_all(&dir)?;
    }
    // 清掉映射表里的孤儿行，避免删后角色还"会"一个不存在的技能。
    let connection = open_chat_history(chat_history)?;
    connection.execute(
        "DELETE FROM character_skill WHERE skill_name = ?1",
        params![name],
    )?;
    Ok(())
}

fn list_character_skills_from_path(
    path: &Path,
    character_id: &str,
) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let connection = open_chat_history(path)?;
    let mut statement = connection.prepare(
        "SELECT skill_name FROM character_skill
         WHERE character_id = ?1 AND enabled = 1
         ORDER BY skill_name ASC",
    )?;
    let rows = statement.query_map(params![character_id], |row| row.get::<_, String>(0))?;
    let mut names = Vec::new();
    for row in rows {
        names.push(row?);
    }
    Ok(names)
}

fn set_character_skill_to_path(
    path: &Path,
    character_id: &str,
    skill_name: &str,
    enabled: bool,
    now: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let connection = open_chat_history(path)?;
    connection.execute(
        "INSERT INTO character_skill (character_id, skill_name, enabled, created_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(character_id, skill_name) DO UPDATE SET enabled = excluded.enabled",
        params![character_id, skill_name, enabled as i64, now],
    )?;
    Ok(())
}

fn list_skill_assignments_from_path(
    path: &Path,
    skill_name: &str,
) -> Result<Vec<SkillAssignmentRecord>, Box<dyn std::error::Error>> {
    let connection = open_chat_history(path)?;
    let mut statement = connection.prepare(
        "SELECT character_id, enabled FROM character_skill
         WHERE skill_name = ?1
         ORDER BY character_id ASC",
    )?;
    let rows = statement.query_map(params![skill_name], |row| {
        Ok(SkillAssignmentRecord {
            character_id: row.get(0)?,
            enabled: row.get::<_, i64>(1)? != 0,
        })
    })?;
    let mut assignments = Vec::new();
    for row in rows {
        assignments.push(row?);
    }
    Ok(assignments)
}

/// 这个角色启用的所有技能声明的 allowed-tools 的并集（去重、保持出现顺序）。
/// sidecar 会把这个集合并入工具策略，并自行过滤到可授予白名单——绝不放开 bash 等。
fn character_skill_required_tools(
    skills_root: &Path,
    chat_history: &Path,
    character_id: &str,
) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let names = list_character_skills_from_path(chat_history, character_id)?;
    let mut tools = Vec::new();
    for name in names {
        let dir = skills_root.join(&name);
        // 技能可能在映射存在后被删了；读不到就跳过。
        let Ok(skill) = read_skill_from_dir(&dir, &name) else {
            continue;
        };
        for tool in skill.allowed_tools {
            if !tools.contains(&tool) {
                tools.push(tool);
            }
        }
    }
    Ok(tools)
}

fn create_chat_session_at_path(
    path: &Path,
    request: CreateChatSessionRequest,
    now: &str,
) -> Result<ChatSessionSummary, Box<dyn std::error::Error>> {
    let connection = open_chat_history(path)?;
    let id = compact_id("session", now);

    connection.execute(
        "INSERT INTO chat_sessions (id, character_id, title, created_at, updated_at, last_message_preview)
         VALUES (?1, ?2, ?3, ?4, ?5, '')",
        params![id, request.character_id, request.title, now, now],
    )?;

    get_chat_session_summary(&connection, &id)?
        .ok_or_else(|| "created chat session could not be loaded".into())
}

fn list_chat_sessions_from_path(
    path: &Path,
) -> Result<Vec<ChatSessionSummary>, Box<dyn std::error::Error>> {
    let connection = open_chat_history(path)?;
    let mut statement = connection.prepare(
        "SELECT id, character_id, title, updated_at, last_message_preview
         FROM chat_sessions
         WHERE archived = 0
         ORDER BY updated_at DESC",
    )?;

    let sessions = statement
        .query_map([], row_to_chat_session_summary)?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(sessions)
}

fn get_chat_session_from_path(
    path: &Path,
    session_id: &str,
) -> Result<ChatSessionDetail, Box<dyn std::error::Error>> {
    let connection = open_chat_history(path)?;
    let session = get_chat_session_summary(&connection, session_id)?
        .ok_or_else(|| format!("chat session not found: {session_id}"))?;
    let mut statement = connection.prepare(
        "SELECT id, session_id, speaker, author, text, mode, sticker_id, model_route, provider_id, created_at
         FROM chat_messages
         WHERE session_id = ?1
         ORDER BY created_at ASC, rowid ASC",
    )?;
    let messages = statement
        .query_map(params![session_id], row_to_chat_message_record)?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(ChatSessionDetail { session, messages })
}

fn recent_memory_messages_from_path(
    path: &Path,
    session_id: &str,
    limit: usize,
) -> Result<Vec<MemoryChatMessage>, Box<dyn std::error::Error>> {
    let connection = open_chat_history(path)?;
    let mut statement = connection.prepare(
        "SELECT id, speaker, text, created_at
         FROM (
           SELECT id, speaker, text, created_at, rowid
           FROM chat_messages
           WHERE session_id = ?1 AND speaker != 'system'
           ORDER BY created_at DESC, rowid DESC
           LIMIT ?2
         )
         ORDER BY created_at ASC, rowid ASC",
    )?;
    let messages = statement
        .query_map(params![session_id, limit as i64], |row| {
            Ok(MemoryChatMessage {
                id: row.get(0)?,
                speaker: row.get(1)?,
                text: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(messages)
}

fn append_chat_message_to_path(
    path: &Path,
    request: AppendChatMessageRequest,
    now: &str,
) -> Result<ChatMessageRecord, Box<dyn std::error::Error>> {
    let connection = open_chat_history(path)?;
    let id = compact_id("message", &format!("{}{}", now, request.speaker));

    connection.execute(
        "INSERT INTO chat_messages
          (id, session_id, speaker, author, text, mode, sticker_id, model_route, provider_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            id,
            request.session_id,
            request.speaker,
            request.author,
            request.text,
            Option::<String>::None,
            request.sticker_id,
            request.model_route,
            request.provider_id,
            now
        ],
    )?;
    connection.execute(
        "UPDATE chat_sessions
         SET updated_at = ?1, last_message_preview = ?2
         WHERE id = ?3",
        params![now, request.text, request.session_id],
    )?;

    get_chat_message_record(&connection, &id)?
        .ok_or_else(|| "stored chat message could not be loaded".into())
}

fn get_chat_session_summary(
    connection: &Connection,
    id: &str,
) -> Result<Option<ChatSessionSummary>, rusqlite::Error> {
    connection
        .query_row(
            "SELECT id, character_id, title, updated_at, last_message_preview
             FROM chat_sessions
             WHERE id = ?1 AND archived = 0",
            params![id],
            row_to_chat_session_summary,
        )
        .optional()
}

fn get_chat_message_record(
    connection: &Connection,
    id: &str,
) -> Result<Option<ChatMessageRecord>, rusqlite::Error> {
    connection
        .query_row(
            "SELECT id, session_id, speaker, author, text, mode, sticker_id, model_route, provider_id, created_at
             FROM chat_messages
             WHERE id = ?1",
            params![id],
            row_to_chat_message_record,
        )
        .optional()
}

fn row_to_chat_session_summary(
    row: &rusqlite::Row<'_>,
) -> Result<ChatSessionSummary, rusqlite::Error> {
    Ok(ChatSessionSummary {
        id: row.get(0)?,
        character_id: row.get(1)?,
        title: row.get(2)?,
        updated_at: row.get(3)?,
        last_message_preview: row.get(4)?,
    })
}

fn row_to_chat_message_record(
    row: &rusqlite::Row<'_>,
) -> Result<ChatMessageRecord, rusqlite::Error> {
    Ok(ChatMessageRecord {
        id: row.get(0)?,
        session_id: row.get(1)?,
        speaker: row.get(2)?,
        author: row.get(3)?,
        text: row.get(4)?,
        sticker_id: row.get(6)?,
        model_route: row.get(7)?,
        provider_id: row.get(8)?,
        created_at: row.get(9)?,
    })
}

// ------------------------------ 定时任务（schedule）------------------------------

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0)
}

/// 把标准 5 段 cron 补成 cron crate 需要的 6 段（前置秒位）；6/7 段原样。
fn normalize_cron(spec: &str) -> Option<String> {
    let fields: Vec<&str> = spec.split_whitespace().collect();
    match fields.len() {
        5 => Some(format!("0 {}", fields.join(" "))),
        6 | 7 => Some(fields.join(" ")),
        _ => None,
    }
}

fn parse_hm(spec: &str) -> Option<(u32, u32)> {
    let (hour, minute) = spec.trim().split_once(':')?;
    let hour: u32 = hour.trim().parse().ok()?;
    let minute: u32 = minute.trim().parse().ok()?;
    if hour < 24 && minute < 60 {
        Some((hour, minute))
    } else {
        None
    }
}

/// 把"本地某天的 HH:MM"换算成 epoch 毫秒，跨过 DST 空洞时向后顺延一小时。
fn local_millis_at(date: chrono::NaiveDate, hour: u32, minute: u32) -> Option<i64> {
    let naive = date.and_hms_opt(hour, minute, 0)?;
    match Local.from_local_datetime(&naive) {
        chrono::LocalResult::Single(dt) => Some(dt.timestamp_millis()),
        chrono::LocalResult::Ambiguous(dt, _) => Some(dt.timestamp_millis()),
        chrono::LocalResult::None => {
            let nudged = date.and_hms_opt((hour + 1).min(23), minute, 0)?;
            Local
                .from_local_datetime(&nudged)
                .single()
                .map(|dt| dt.timestamp_millis())
        }
    }
}

/// 算出严格晚于 `from_millis` 的下一次触发（epoch 毫秒）。`once` 返回其字面时刻
/// （可能在过去，由调度器补跑一次后停用）；`cron` 在 P1 暂不支持，返回 None。
fn compute_next_run_millis(kind: &str, spec: &str, from_millis: i64) -> Option<i64> {
    let from = Local.timestamp_millis_opt(from_millis).single()?;
    match kind {
        "once" => {
            let naive =
                chrono::NaiveDateTime::parse_from_str(spec.trim(), "%Y-%m-%dT%H:%M").ok()?;
            Local
                .from_local_datetime(&naive)
                .single()
                .map(|dt| dt.timestamp_millis())
        }
        "daily" => {
            let (hour, minute) = parse_hm(spec)?;
            for add in 0..=1 {
                let date = (from + chrono::Duration::days(add)).date_naive();
                if let Some(ms) = local_millis_at(date, hour, minute) {
                    if ms > from_millis {
                        return Some(ms);
                    }
                }
            }
            None
        }
        "weekdays" => {
            let (hour, minute) = parse_hm(spec)?;
            for add in 0..=7 {
                let day = from + chrono::Duration::days(add);
                if day.weekday().num_days_from_monday() <= 4 {
                    if let Some(ms) = local_millis_at(day.date_naive(), hour, minute) {
                        if ms > from_millis {
                            return Some(ms);
                        }
                    }
                }
            }
            None
        }
        "weekly" => {
            let (days_part, hm_part) = spec.split_once('@')?;
            let (hour, minute) = parse_hm(hm_part)?;
            let days: Vec<u32> = days_part
                .split(',')
                .filter_map(|value| value.trim().parse().ok())
                .filter(|day| *day < 7)
                .collect();
            if days.is_empty() {
                return None;
            }
            for add in 0..=7 {
                let day = from + chrono::Duration::days(add);
                if days.contains(&day.weekday().num_days_from_sunday()) {
                    if let Some(ms) = local_millis_at(day.date_naive(), hour, minute) {
                        if ms > from_millis {
                            return Some(ms);
                        }
                    }
                }
            }
            None
        }
        "cron" => {
            let normalized = normalize_cron(spec)?;
            let schedule = cron::Schedule::from_str(&normalized).ok()?;
            schedule.after(&from).next().map(|dt| dt.timestamp_millis())
        }
        _ => None,
    }
}

fn validate_schedule(kind: &str, spec: &str) -> Result<(), Box<dyn std::error::Error>> {
    let ok = match kind {
        "daily" | "weekdays" => parse_hm(spec).is_some(),
        "weekly" => spec
            .split_once('@')
            .map(|(days, hm)| {
                parse_hm(hm).is_some()
                    && days
                        .split(',')
                        .any(|value| value.trim().parse::<u32>().map(|d| d < 7).unwrap_or(false))
            })
            .unwrap_or(false),
        "once" => chrono::NaiveDateTime::parse_from_str(spec.trim(), "%Y-%m-%dT%H:%M").is_ok(),
        "cron" => normalize_cron(spec)
            .and_then(|normalized| cron::Schedule::from_str(&normalized).ok())
            .is_some(),
        _ => false,
    };
    if ok {
        Ok(())
    } else {
        Err("定时规则格式不正确。".into())
    }
}

fn row_to_scheduled_task(row: &rusqlite::Row<'_>) -> Result<ScheduledTask, rusqlite::Error> {
    Ok(ScheduledTask {
        id: row.get(0)?,
        character_id: row.get(1)?,
        title: row.get(2)?,
        prompt: row.get(3)?,
        schedule_kind: row.get(4)?,
        schedule_spec: row.get(5)?,
        enabled: row.get::<_, i64>(6)? != 0,
        source: row.get(7)?,
        next_run_at: row.get(8)?,
        last_run_at: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

const SCHEDULED_TASK_COLUMNS: &str = "id, character_id, title, prompt, schedule_kind, \
     schedule_spec, enabled, source, next_run_at, last_run_at, created_at, updated_at";

fn get_scheduled_task_from_path(
    path: &Path,
    id: &str,
) -> Result<Option<ScheduledTask>, Box<dyn std::error::Error>> {
    let connection = open_chat_history(path)?;
    let task = connection
        .query_row(
            &format!("SELECT {SCHEDULED_TASK_COLUMNS} FROM scheduled_task WHERE id = ?1"),
            params![id],
            row_to_scheduled_task,
        )
        .optional()?;
    Ok(task)
}

fn list_scheduled_tasks_from_path(
    path: &Path,
    character_id: Option<&str>,
) -> Result<Vec<ScheduledTask>, Box<dyn std::error::Error>> {
    let connection = open_chat_history(path)?;
    let mut tasks = Vec::new();
    if let Some(character_id) = character_id {
        let mut statement = connection.prepare(&format!(
            "SELECT {SCHEDULED_TASK_COLUMNS} FROM scheduled_task
             WHERE character_id = ?1 ORDER BY created_at DESC"
        ))?;
        let rows = statement.query_map(params![character_id], row_to_scheduled_task)?;
        for row in rows {
            tasks.push(row?);
        }
    } else {
        let mut statement = connection.prepare(&format!(
            "SELECT {SCHEDULED_TASK_COLUMNS} FROM scheduled_task ORDER BY created_at DESC"
        ))?;
        let rows = statement.query_map([], row_to_scheduled_task)?;
        for row in rows {
            tasks.push(row?);
        }
    }
    Ok(tasks)
}

fn upsert_scheduled_task_at_path(
    path: &Path,
    request: SaveScheduledTaskRequest,
    source: &str,
    now: &str,
) -> Result<ScheduledTask, Box<dyn std::error::Error>> {
    if request.title.trim().is_empty() {
        return Err("请填写任务名称。".into());
    }
    if request.prompt.trim().is_empty() {
        return Err("请填写要执行的指令。".into());
    }
    validate_schedule(&request.schedule_kind, &request.schedule_spec)?;

    let connection = open_chat_history(path)?;
    let next_run = if request.enabled {
        compute_next_run_millis(&request.schedule_kind, &request.schedule_spec, now_millis())
            .map(|ms| ms.to_string())
    } else {
        None
    };

    let id = match request.id {
        Some(id) if !id.trim().is_empty() => {
            connection.execute(
                "UPDATE scheduled_task SET character_id = ?2, title = ?3, prompt = ?4,
                   schedule_kind = ?5, schedule_spec = ?6, enabled = ?7,
                   next_run_at = ?8, updated_at = ?9
                 WHERE id = ?1",
                params![
                    id,
                    request.character_id,
                    request.title,
                    request.prompt,
                    request.schedule_kind,
                    request.schedule_spec,
                    request.enabled as i64,
                    next_run,
                    now,
                ],
            )?;
            id
        }
        _ => {
            let id = compact_id("sched", &format!("{}{}", now, request.character_id));
            connection.execute(
                "INSERT INTO scheduled_task (id, character_id, title, prompt, schedule_kind,
                   schedule_spec, enabled, source, next_run_at, last_run_at, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, ?10, ?10)",
                params![
                    id,
                    request.character_id,
                    request.title,
                    request.prompt,
                    request.schedule_kind,
                    request.schedule_spec,
                    request.enabled as i64,
                    source,
                    next_run,
                    now,
                ],
            )?;
            id
        }
    };

    get_scheduled_task_from_path(path, &id)?
        .ok_or_else(|| "保存后的定时任务无法读取。".into())
}

/// 角色在聊天里通过 schedule_create 工具发回的任务：归属当前角色、source=agent。
/// 字段从 JSON 里宽松读取，缺字段或规则非法则放弃（不打断对话）。
fn persist_agent_scheduled_task(
    app: &AppHandle,
    character_id: &str,
    task: &serde_json::Value,
) -> Result<ScheduledTask, Box<dyn std::error::Error>> {
    let read = |key: &str| -> String {
        task.get(key)
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string()
    };
    let request = SaveScheduledTaskRequest {
        id: None,
        character_id: character_id.to_string(),
        title: read("title"),
        prompt: read("prompt"),
        schedule_kind: read("scheduleKind"),
        schedule_spec: read("scheduleSpec"),
        enabled: true,
    };
    upsert_scheduled_task_at_path(
        &chat_history_path(app)?,
        request,
        "agent",
        &current_timestamp(),
    )
}

/// 该角色已登记任务的精简视图（喂给 schedule_list / schedule_cancel）。
fn agent_visible_tasks_json(path: &Path, character_id: &str) -> serde_json::Value {
    let tasks = list_scheduled_tasks_from_path(path, Some(character_id)).unwrap_or_default();
    serde_json::json!(tasks
        .into_iter()
        .map(|task| serde_json::json!({
            "id": task.id,
            "title": task.title,
            "scheduleKind": task.schedule_kind,
            "scheduleSpec": task.schedule_spec,
            "enabled": task.enabled,
        }))
        .collect::<Vec<_>>())
}

/// 角色取消任务：只允许删除属于当前角色的任务（防越权）。返回是否删掉。
fn cancel_agent_scheduled_task(
    app: &AppHandle,
    character_id: &str,
    task_id: &str,
) -> Result<bool, Box<dyn std::error::Error>> {
    let path = chat_history_path(app)?;
    match get_scheduled_task_from_path(&path, task_id)? {
        Some(task) if task.character_id == character_id => {
            delete_scheduled_task_at_path(&path, task_id)?;
            Ok(true)
        }
        _ => Ok(false),
    }
}

fn delete_scheduled_task_at_path(
    path: &Path,
    id: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let connection = open_chat_history(path)?;
    connection.execute("DELETE FROM scheduled_task_run WHERE task_id = ?1", params![id])?;
    connection.execute("DELETE FROM scheduled_task WHERE id = ?1", params![id])?;
    Ok(())
}

fn set_scheduled_task_enabled_at_path(
    path: &Path,
    id: &str,
    enabled: bool,
    now: &str,
) -> Result<ScheduledTask, Box<dyn std::error::Error>> {
    let task = get_scheduled_task_from_path(path, id)?.ok_or("定时任务不存在。")?;
    let next_run = if enabled {
        compute_next_run_millis(&task.schedule_kind, &task.schedule_spec, now_millis())
            .map(|ms| ms.to_string())
    } else {
        None
    };
    let connection = open_chat_history(path)?;
    connection.execute(
        "UPDATE scheduled_task SET enabled = ?2, next_run_at = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, enabled as i64, next_run, now],
    )?;
    get_scheduled_task_from_path(path, id)?.ok_or_else(|| "更新后的定时任务无法读取。".into())
}

fn row_to_scheduled_task_run(
    row: &rusqlite::Row<'_>,
) -> Result<ScheduledTaskRun, rusqlite::Error> {
    Ok(ScheduledTaskRun {
        id: row.get(0)?,
        task_id: row.get(1)?,
        character_id: row.get(2)?,
        scheduled_for: row.get(3)?,
        ran_at: row.get(4)?,
        status: row.get(5)?,
        result: row.get(6)?,
        error: row.get(7)?,
        read: row.get::<_, i64>(8)? != 0,
        created_at: row.get(9)?,
    })
}

fn list_task_runs_from_path(
    path: &Path,
    task_id: &str,
    limit: i64,
) -> Result<Vec<ScheduledTaskRun>, Box<dyn std::error::Error>> {
    let connection = open_chat_history(path)?;
    let mut statement = connection.prepare(
        "SELECT id, task_id, character_id, scheduled_for, ran_at, status, result, error, read, created_at
         FROM scheduled_task_run WHERE task_id = ?1 ORDER BY ran_at DESC LIMIT ?2",
    )?;
    let rows = statement.query_map(params![task_id, limit], row_to_scheduled_task_run)?;
    let mut runs = Vec::new();
    for row in rows {
        runs.push(row?);
    }
    Ok(runs)
}

fn scheduled_unread_count_from_path(path: &Path) -> Result<i64, Box<dyn std::error::Error>> {
    let connection = open_chat_history(path)?;
    let count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM scheduled_task_run WHERE read = 0",
        [],
        |row| row.get(0),
    )?;
    Ok(count)
}

fn mark_task_runs_read_at_path(
    path: &Path,
    task_id: Option<&str>,
) -> Result<(), Box<dyn std::error::Error>> {
    let connection = open_chat_history(path)?;
    if let Some(task_id) = task_id {
        connection.execute(
            "UPDATE scheduled_task_run SET read = 1 WHERE task_id = ?1",
            params![task_id],
        )?;
    } else {
        connection.execute("UPDATE scheduled_task_run SET read = 1", [])?;
    }
    Ok(())
}

fn record_task_run(
    path: &Path,
    task: &ScheduledTask,
    scheduled_for: &str,
    ran_at: &str,
    status: &str,
    result: Option<&str>,
    error: Option<&str>,
) -> Result<(), Box<dyn std::error::Error>> {
    let connection = open_chat_history(path)?;
    let id = compact_id("schedrun", &format!("{}{}", ran_at, task.id));
    // 结果文本截断保存，避免历史表膨胀。
    let trimmed = result.map(|text| text.chars().take(2000).collect::<String>());
    connection.execute(
        "INSERT INTO scheduled_task_run
           (id, task_id, character_id, scheduled_for, ran_at, status, result, error, read, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?5)",
        params![
            id,
            task.id,
            task.character_id,
            scheduled_for,
            ran_at,
            status,
            trimmed,
            error,
        ],
    )?;
    Ok(())
}

/// 跑完后推进 last_run_at / next_run_at；`once` 触发后停用、清空 next。
fn advance_schedule_after_run(
    path: &Path,
    task: &ScheduledTask,
    ran_at: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let connection = open_chat_history(path)?;
    if task.schedule_kind == "once" {
        connection.execute(
            "UPDATE scheduled_task SET enabled = 0, next_run_at = NULL, last_run_at = ?2, updated_at = ?2 WHERE id = ?1",
            params![task.id, ran_at],
        )?;
    } else {
        let next_run =
            compute_next_run_millis(&task.schedule_kind, &task.schedule_spec, now_millis())
                .map(|ms| ms.to_string());
        connection.execute(
            "UPDATE scheduled_task SET next_run_at = ?2, last_run_at = ?3, updated_at = ?3 WHERE id = ?1",
            params![task.id, next_run, ran_at],
        )?;
    }
    Ok(())
}

/// 占位：成功插入返回 true，已在运行则返回 false。State 临时量留在条件式里，
/// 避免它在局部变量之后才析构导致借用过期。
fn scheduler_try_acquire(app: &AppHandle, task_id: &str) -> bool {
    match app.state::<SchedulerRunning>().0.lock() {
        Ok(mut guard) => guard.insert(task_id.to_string()),
        Err(_) => false,
    }
}

fn scheduler_release(app: &AppHandle, task_id: &str) {
    if let Ok(mut guard) = app.state::<SchedulerRunning>().0.lock() {
        guard.remove(task_id);
    }
}

/// 错过判定阈值：到点容差。超过这个时长还没跑的，算"错过"（开机/久眠场景），
/// 受错过补跑策略约束；在容差内的算"准点"，无条件执行。比 tick 间隔略大。
const MISSED_GRACE_MS: i64 = 90_000;

/// 在 "skip" 策略下处理错过的任务：不补跑、不记历史，只把下次触发推到未来；
/// 一次性任务被跳过后永不再触发，停用。
fn skip_missed_task(path: &Path, task: &ScheduledTask) -> Result<(), Box<dyn std::error::Error>> {
    let connection = open_chat_history(path)?;
    let now = current_timestamp();
    if task.schedule_kind == "once" {
        connection.execute(
            "UPDATE scheduled_task SET enabled = 0, next_run_at = NULL, updated_at = ?2 WHERE id = ?1",
            params![task.id, now],
        )?;
    } else {
        let next = compute_next_run_millis(&task.schedule_kind, &task.schedule_spec, now_millis())
            .map(|ms| ms.to_string());
        connection.execute(
            "UPDATE scheduled_task SET next_run_at = ?2, updated_at = ?3 WHERE id = ?1",
            params![task.id, next, now],
        )?;
    }
    Ok(())
}

/// 执行一条定时任务：以该角色身份非交互地跑一遍 prompt，记录历史、弹通知、广播事件。
/// 单次定时执行的墙钟超时：防止某个挂起的 prompt 永久占住调度线程，拖垮其它任务。
const SCHEDULED_RUN_TIMEOUT_MS: u64 = 5 * 60 * 1000;

/// 执行一条定时任务。`advance` 为真时（调度器自动触发）先把排程推进到下次再执行；
/// 为假时（用户在面板「立即试跑」）只记录与通知，不动真实排程。
fn execute_scheduled_task(
    app: &AppHandle,
    task: &ScheduledTask,
    scheduled_for: &str,
    advance: bool,
) {
    // 重入保护：同一任务正在跑就跳过。
    if !scheduler_try_acquire(app, &task.id) {
        return;
    }

    let path = match chat_history_path(app) {
        Ok(path) => path,
        Err(_) => {
            scheduler_release(app, &task.id);
            return;
        }
    };

    let ran_at = current_timestamp();

    // 先推进排程、再执行：即便本次 prompt 挂起 / 崩溃 / 超时，next_run_at 也已落到
    // 未来，调度器不会在下一拍把同一任务重复触发、反复弹通知。手动「立即试跑」
    // （advance=false）不动排程。
    if advance {
        if let Err(error) = advance_schedule_after_run(&path, task, &ran_at) {
            eprintln!("推进定时任务排程失败（task={}）：{error}", task.id);
        }
    }

    let session_prompt = format!("[character:{}]\n{}", task.character_id, task.prompt);
    let request = SendPiPromptRequest {
        character_id: task.character_id.clone(),
        prompt: task.prompt.clone(),
        run_id: None,
        session_prompt: Some(session_prompt.clone()),
        session_id: None,
        browser_snapshot: None,
        // 无人值守：用最保守的审核模式，需确认的工具会被拒绝而非自动放行。
        review_mode: Some("default".to_string()),
    };

    // 带墙钟超时执行：在子线程跑 prompt，调度线程最多等 SCHEDULED_RUN_TIMEOUT_MS。
    // 超时则放弃等待（孤儿子进程会自然结束），调度器立即继续处理其它任务，不被
    // 任何单个挂起任务拖死。
    let outcome = {
        let (tx, rx) = std::sync::mpsc::channel();
        let app_for_run = app.clone();
        std::thread::spawn(move || {
            let result = run_sidecar_prompt(app_for_run, session_prompt, Some(request), None);
            let _ = tx.send(result);
        });
        match rx.recv_timeout(std::time::Duration::from_millis(SCHEDULED_RUN_TIMEOUT_MS)) {
            Ok(result) => result,
            Err(_) => Err("执行超时（超过 5 分钟），已中止本次定时任务。".to_string()),
        }
    };

    let (status, result_text, error_text) = match &outcome {
        Ok(response) => ("ok", Some(response.text.clone()), None),
        Err(error) => ("error", None, Some(error.clone())),
    };

    let _ = record_task_run(
        &path,
        task,
        scheduled_for,
        &ran_at,
        status,
        result_text.as_deref(),
        error_text.as_deref(),
    );

    // 系统通知：成功播报结果摘要，失败播报错误。
    let body = match &outcome {
        Ok(response) => response.text.chars().take(120).collect::<String>(),
        Err(error) => format!("执行失败：{error}"),
    };
    let _ = app
        .notification()
        .builder()
        .title(format!("定时任务 · {}", task.title))
        .body(if body.trim().is_empty() {
            "已完成。".to_string()
        } else {
            body
        })
        .show();

    let _ = app.emit(
        "scheduled_task_run",
        serde_json::json!({
            "taskId": task.id,
            "characterId": task.character_id,
            "status": status,
        }),
    );

    scheduler_release(app, &task.id);
}

/// 调度器一拍：取出所有到点（next_run_at <= now）的启用任务，逐个执行。
fn scheduler_tick(app: &AppHandle) {
    let path = match chat_history_path(app) {
        Ok(path) => path,
        Err(_) => return,
    };
    let tasks = match list_scheduled_tasks_from_path(&path, None) {
        Ok(tasks) => tasks,
        Err(_) => return,
    };
    // 错过补跑策略（全局）：catchup=补跑一次（默认）| skip=跳过、只推下次。
    let policy = missed_task_policy_path(app)
        .ok()
        .and_then(|policy_path| read_missed_task_policy_from_path(&policy_path).ok())
        .unwrap_or_else(|| "catchup".to_string());
    let now = now_millis();
    for task in tasks {
        if !task.enabled {
            continue;
        }
        let Some(next_run_at) = task.next_run_at.as_deref() else {
            continue;
        };
        let Ok(due_at) = next_run_at.parse::<i64>() else {
            continue;
        };
        if due_at > now {
            continue;
        }
        // 超过容差才算"错过"；skip 策略下不补跑，只把下次触发推到未来。
        if now - due_at > MISSED_GRACE_MS && policy == "skip" {
            let _ = skip_missed_task(&path, &task);
            continue;
        }
        execute_scheduled_task(app, &task, next_run_at, true);
    }
}

/// 进程内常驻调度线程：每分钟检查一次。首拍即补跑关机期间错过的任务。
fn start_scheduler(app: AppHandle) {
    std::thread::spawn(move || loop {
        // 单拍 panic 不能拖死整个调度线程：捕获后照常进入下一拍，否则一个坏任务
        // 会让本次会话的定时功能彻底失效且毫无信号。
        let app_for_tick = app.clone();
        if std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
            scheduler_tick(&app_for_tick);
        }))
        .is_err()
        {
            eprintln!("调度器 tick 发生 panic，已捕获并继续。");
        }
        std::thread::sleep(std::time::Duration::from_secs(60));
    });
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .manage(PromptStdinRegistry::default())
        .manage(SchedulerRunning::default())
        .setup(|app| {
            // 首启时带上下文请求系统通知权限：定时任务结果靠通知推送，若等到后台
            // 调度线程首次 .show() 才弹权限框，时机不定且易被忽略 → 通知被永久关闭。
            let handle = app.handle();
            if !matches!(
                handle.notification().permission_state(),
                Ok(tauri_plugin_notification::PermissionState::Granted)
            ) {
                let _ = handle.notification().request_permission();
            }
            start_scheduler(handle.clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            add_character_letter,
            add_character_moment,
            add_character_moment_comment,
            append_chat_message,
            companion_status,
            create_chat_session,
            create_scheduled_task,
            create_skill,
            delete_model_profile,
            delete_scheduled_task,
            delete_skill,
            get_character_states,
            get_chat_session,
            get_advanced_settings,
            get_memory_status,
            get_missed_task_policy,
            get_model_settings,
            get_review_mode,
            get_tool_policy_settings,
            get_web_access_settings,
            get_workspace_path,
            list_character_letters,
            list_character_moments,
            list_character_skills,
            list_chat_sessions,
            list_scheduled_tasks,
            list_skill_assignments,
            list_skills,
            list_task_runs,
            list_workspace_dir,
            list_workspace_roots,
            mark_character_letter_read,
            mark_task_runs_read,
            respond_pi_tool_confirm,
            run_scheduled_task_now,
            save_character_states,
            save_model_settings,
            save_tool_policy_settings,
            save_web_access_settings,
            scheduled_unread_count,
            set_active_model_profile,
            set_advanced_settings,
            set_character_letter_reaction,
            set_character_skill,
            set_missed_task_policy,
            set_review_mode,
            set_scheduled_task_enabled,
            set_workspace_path,
            pick_workspace_path,
            stage_dropped_files,
            send_pi_prompt,
            test_model_connection,
            toggle_character_moment_like,
            update_scheduled_task,
            update_skill
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Irori");
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{
        attachment_kind, unique_attachment_path,
        append_chat_message_to_path, build_memory_backend_config_payload,
        build_sidecar_prompt_payload,
        create_chat_session_at_path, delete_model_profile_at_path, get_chat_session_from_path,
        init_chat_history_at_path, insert_character_letter_to_path, insert_character_moment_to_path,
        add_character_moment_comment_to_path, toggle_character_moment_like_to_path,
        list_character_letters_from_path, list_character_moments_from_path,
        list_chat_sessions_from_path, sidecar_prompt_command_args,
        mark_character_letter_read_to_path, set_character_letter_reaction_to_path,
        memory_status_from_paths, normalize_openai_compatible_settings, parse_sidecar_stream_line,
        read_character_states_from_path, read_model_settings_from_path, read_stored_model_registry,
        read_advanced_settings_from_path, read_review_mode_from_path,
        read_tool_policy_settings_from_path,
        read_web_access_settings_from_path, read_workspace_dir,
        save_advanced_settings_to_path, save_review_mode_to_path,
        AdvancedSettings,
        recent_memory_messages_from_path, save_character_states_to_path, save_model_settings_to_path,
        save_tool_policy_settings_to_path, save_web_access_settings_to_path,
        set_active_model_profile_at_path,
        AddCharacterLetterRequest, AddCharacterMomentCommentRequest, AddCharacterMomentRequest,
        AppendChatMessageRequest, CreateChatSessionRequest,
        SidecarStreamMessage,
        ModelProfileSnapshot, ModelSettingsSnapshot, SaveModelSettingsRequest, StoredModelProfile,
        SaveWebAccessSettingsRequest, ToggleCharacterMomentLikeRequest,
        is_valid_skill_name, parse_skill_md, render_skill_md, list_skills_from_dir,
        create_skill_at_dir, update_skill_at_dir, delete_skill_at_dir,
        list_character_skills_from_path, set_character_skill_to_path,
        list_skill_assignments_from_path, character_skill_required_tools, SaveSkillRequest,
        read_missed_task_policy_from_path, save_missed_task_policy_to_path,
        compute_next_run_millis, validate_schedule, upsert_scheduled_task_at_path,
        get_scheduled_task_from_path, skip_missed_task, now_millis, SaveScheduledTaskRequest,
    };
    use chrono::TimeZone;

    fn temp_skills_root() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("irori-skills-{}", temp_path_nonce()))
    }

    fn save_skill_request(name: &str, description: &str, body: &str) -> SaveSkillRequest {
        SaveSkillRequest {
            name: name.to_string(),
            description: description.to_string(),
            body: body.to_string(),
            disable_model_invocation: false,
            allowed_tools: Vec::new(),
        }
    }

    static TEMP_PATH_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_path_nonce() -> String {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after epoch")
            .as_nanos();
        let count = TEMP_PATH_COUNTER.fetch_add(1, Ordering::Relaxed);

        format!("{timestamp}-{count}")
    }

    fn temp_settings_path() -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "irori-model-settings-{}.json",
            temp_path_nonce()
        ))
    }

    fn temp_chat_history_path() -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "irori-chat-history-{}.sqlite3",
            temp_path_nonce()
        ))
    }

    fn temp_tool_policy_path() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("irori-tool-policy-{}.json", temp_path_nonce()))
    }

    fn temp_web_access_path() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("irori-web-access-{}.json", temp_path_nonce()))
    }

    #[test]
    fn review_mode_round_trips_and_sanitizes() {
        let path = std::env::temp_dir().join(format!("irori-review-mode-{}.json", temp_path_nonce()));

        // Missing file → safe default.
        assert_eq!(read_review_mode_from_path(&path).expect("default"), "default");

        // Valid modes persist and read back.
        assert_eq!(save_review_mode_to_path(&path, "auto").expect("save"), "auto");
        assert_eq!(read_review_mode_from_path(&path).expect("read"), "auto");
        assert_eq!(save_review_mode_to_path(&path, "all").expect("save"), "all");
        assert_eq!(read_review_mode_from_path(&path).expect("read"), "all");

        // Bogus input is coerced to the safe default before writing.
        assert_eq!(save_review_mode_to_path(&path, "bogus").expect("save"), "default");
        assert_eq!(read_review_mode_from_path(&path).expect("read"), "default");

        fs::remove_file(&path).ok();
    }

    #[test]
    fn attachment_kind_maps_extensions_to_ui_categories() {
        assert_eq!(attachment_kind(&PathBuf::from("a/photo.PNG")), "image");
        assert_eq!(attachment_kind(&PathBuf::from("report.pdf")), "pdf");
        assert_eq!(attachment_kind(&PathBuf::from("notes.md")), "text");
        assert_eq!(attachment_kind(&PathBuf::from("deck.pptx")), "document");
        assert_eq!(attachment_kind(&PathBuf::from("mystery.bin")), "file");
        assert_eq!(attachment_kind(&PathBuf::from("noext")), "file");
    }

    #[test]
    fn unique_attachment_path_avoids_clobbering_existing_files() {
        let dir = std::env::temp_dir().join(format!("irori-attach-{}", temp_path_nonce()));
        fs::create_dir_all(&dir).expect("create dir");

        // 目录里没有同名文件时，直接用原名。
        let first = unique_attachment_path(&dir, "report.pdf");
        assert_eq!(first, dir.join("report.pdf"));

        // 占位后再来一次，应插入 " (1)" 而不是覆盖。
        fs::write(&first, b"x").expect("write");
        let second = unique_attachment_path(&dir, "report.pdf");
        assert_eq!(second, dir.join("report (1).pdf"));

        // 无扩展名文件也能让路。
        fs::write(dir.join("LICENSE"), b"x").expect("write");
        assert_eq!(unique_attachment_path(&dir, "LICENSE"), dir.join("LICENSE (1)"));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn missed_task_policy_round_trips_and_defaults_catchup() {
        let path =
            std::env::temp_dir().join(format!("irori-missed-policy-{}.json", temp_path_nonce()));

        // 缺文件 → 默认补跑。
        assert_eq!(read_missed_task_policy_from_path(&path).expect("default"), "catchup");

        assert_eq!(save_missed_task_policy_to_path(&path, "skip").expect("save"), "skip");
        assert_eq!(read_missed_task_policy_from_path(&path).expect("read"), "skip");

        // 非法值回落到 catchup。
        assert_eq!(save_missed_task_policy_to_path(&path, "bogus").expect("save"), "catchup");
        assert_eq!(read_missed_task_policy_from_path(&path).expect("read"), "catchup");

        fs::remove_file(&path).ok();
    }

    #[test]
    fn compute_next_run_handles_grids_and_cron() {
        // 用一个已知锚点：2026-06-05 是周五（num_days_from_sunday=5）。
        let anchor = chrono::Local
            .with_ymd_and_hms(2026, 6, 5, 19, 0, 0)
            .single()
            .expect("anchor")
            .timestamp_millis();

        // daily 20:00 当天还没到 → 今天 20:00。
        let daily = compute_next_run_millis("daily", "20:00", anchor).expect("daily");
        assert!(daily > anchor);
        // 间隔正好 1 小时。
        assert_eq!(daily - anchor, 60 * 60 * 1000);

        // weekly 周一(1) 09:00，从周五起 → 下周一。
        let weekly = compute_next_run_millis("weekly", "1@09:00", anchor).expect("weekly");
        assert!(weekly > anchor);

        // cron 标准 5 段：每天 20:00。
        let cron = compute_next_run_millis("cron", "0 20 * * *", anchor).expect("cron");
        assert_eq!(cron, daily);

        // 校验：合法通过、非法报错。
        assert!(validate_schedule("daily", "20:00").is_ok());
        assert!(validate_schedule("cron", "0 20 * * *").is_ok());
        assert!(validate_schedule("daily", "25:00").is_err());
        assert!(validate_schedule("cron", "not a cron").is_err());
    }

    #[test]
    fn skip_missed_task_reschedules_recurring_and_disables_once() {
        let path =
            std::env::temp_dir().join(format!("irori-skip-{}.sqlite", temp_path_nonce()));
        init_chat_history_at_path(&path).expect("init");

        let make = |kind: &str, spec: &str| SaveScheduledTaskRequest {
            id: None,
            character_id: "shili".to_string(),
            title: "t".to_string(),
            prompt: "p".to_string(),
            schedule_kind: kind.to_string(),
            schedule_spec: spec.to_string(),
            enabled: true,
        };

        // 循环任务被跳过 → 仍启用，next_run_at 推到未来。
        let daily = upsert_scheduled_task_at_path(&path, make("daily", "20:00"), "user", "1")
            .expect("create daily");
        skip_missed_task(&path, &daily).expect("skip daily");
        let after = get_scheduled_task_from_path(&path, &daily.id).expect("read").expect("exists");
        assert!(after.enabled);
        let next: i64 = after.next_run_at.expect("next").parse().expect("ms");
        assert!(next > now_millis());

        // 一次性任务被跳过 → 停用、清空 next。
        let once = upsert_scheduled_task_at_path(&path, make("once", "2020-01-01T08:00"), "user", "1")
            .expect("create once");
        skip_missed_task(&path, &once).expect("skip once");
        let after_once = get_scheduled_task_from_path(&path, &once.id).expect("read").expect("exists");
        assert!(!after_once.enabled);
        assert!(after_once.next_run_at.is_none());

        fs::remove_file(&path).ok();
    }

    #[test]
    fn advanced_settings_round_trip_defaults_subagents_off() {
        let path =
            std::env::temp_dir().join(format!("irori-advanced-{}.json", temp_path_nonce()));

        // Missing file → subagents off.
        assert!(!read_advanced_settings_from_path(&path).expect("default").enable_subagents);

        // Persist enabled and read back.
        let saved = save_advanced_settings_to_path(&path, AdvancedSettings { enable_subagents: true })
            .expect("save");
        assert!(saved.enable_subagents);
        assert!(read_advanced_settings_from_path(&path).expect("read").enable_subagents);

        // Corrupt file → safe default (off) rather than an error.
        fs::write(&path, "{ not json").expect("write garbage");
        assert!(!read_advanced_settings_from_path(&path).expect("default").enable_subagents);

        fs::remove_file(&path).ok();
    }

    #[test]
    fn read_workspace_dir_sorts_folders_first_and_reports_sizes() {
        let base = std::env::temp_dir().join(format!("irori-ws-{}", temp_path_nonce()));
        fs::create_dir_all(base.join("zeta-dir")).expect("subdir should create");
        fs::write(base.join("alpha.txt"), b"hello").expect("file should write");

        let entries = read_workspace_dir(&base, "workspace").expect("dir should list");

        assert_eq!(entries.len(), 2);
        // Folder sorts before the file even though "alpha" < "zeta" alphabetically.
        assert_eq!(entries[0].name, "zeta-dir");
        assert_eq!(entries[0].kind, "folder");
        assert_eq!(entries[0].size, None);
        assert_eq!(entries[1].name, "alpha.txt");
        assert_eq!(entries[1].kind, "file");
        assert_eq!(entries[1].size, Some(5));
        assert!(entries[1].id.ends_with("alpha.txt"));

        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn chat_history_initializes_schema() {
        let path = temp_chat_history_path();

        init_chat_history_at_path(&path).expect("chat history schema should initialize");

        assert!(path.exists());
    }

    #[test]
    fn chat_history_creates_session_and_lists_recent_sessions() {
        let path = temp_chat_history_path();
        let session = create_chat_session_at_path(
            &path,
            CreateChatSessionRequest {
                character_id: "shili".to_string(),
                title: "聊天历史设计".to_string(),
            },
            "2026-05-18T10:00:00.000+08:00",
        )
        .expect("session should be created");

        let sessions = list_chat_sessions_from_path(&path).expect("sessions should load");

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, session.id);
        assert_eq!(sessions[0].character_id, "shili");
        assert_eq!(sessions[0].title, "聊天历史设计");
        assert_eq!(sessions[0].last_message_preview, "");
    }

    #[test]
    fn chat_history_appends_messages_and_updates_session_preview() {
        let path = temp_chat_history_path();
        let session = create_chat_session_at_path(
            &path,
            CreateChatSessionRequest {
                character_id: "shili".to_string(),
                title: "本地历史".to_string(),
            },
            "2026-05-18T10:00:00.000+08:00",
        )
        .expect("session should be created");

        append_chat_message_to_path(
            &path,
            AppendChatMessageRequest {
                session_id: session.id.clone(),
                speaker: "user".to_string(),
                author: "你".to_string(),
                text: "先把聊天记录存起来".to_string(),
                sticker_id: None,
                model_route: None,
                provider_id: None,
            },
            "2026-05-18T10:01:00.000+08:00",
        )
        .expect("user message should be stored");
        append_chat_message_to_path(
            &path,
            AppendChatMessageRequest {
                session_id: session.id.clone(),
                speaker: "character".to_string(),
                author: "示璃".to_string(),
                text: "好，我先把 SQLite 这层铺好。".to_string(),
                sticker_id: Some("focused".to_string()),
                model_route: Some("https://api.openai.com/v1/gpt-5.5".to_string()),
                provider_id: Some("openai-compatible".to_string()),
            },
            "2026-05-18T10:02:00.000+08:00",
        )
        .expect("assistant message should be stored");

        let detail = get_chat_session_from_path(&path, &session.id).expect("session should load");
        let sessions = list_chat_sessions_from_path(&path).expect("sessions should load");

        assert_eq!(detail.messages.len(), 2);
        assert_eq!(detail.messages[0].speaker, "user");
        assert_eq!(detail.messages[1].speaker, "character");
        assert_eq!(detail.messages[1].sticker_id.as_deref(), Some("focused"));
        assert_eq!(
            sessions[0].last_message_preview,
            "好，我先把 SQLite 这层铺好。"
        );
        assert_eq!(sessions[0].updated_at, "2026-05-18T10:02:00.000+08:00");
    }

    #[test]
    fn chat_history_collects_recent_memory_messages_without_system_events() {
        let path = temp_chat_history_path();
        let session = create_chat_session_at_path(
            &path,
            CreateChatSessionRequest {
                character_id: "shili".to_string(),
                title: "记忆上下文".to_string(),
            },
            "2026-05-19T10:00:00.000+08:00",
        )
        .expect("session should be created");

        for (index, speaker, text) in [
            ("01", "user", "我喜欢你先给结论。"),
            ("02", "character", "好，我会先给结论。"),
            ("03", "system", "模型供应商错误。"),
            ("04", "user", "继续做记忆。"),
        ] {
            append_chat_message_to_path(
                &path,
                AppendChatMessageRequest {
                    session_id: session.id.clone(),
                    speaker: speaker.to_string(),
                    author: "测试".to_string(),
                    text: text.to_string(),
                    sticker_id: None,
                    model_route: None,
                    provider_id: None,
                },
                &format!("2026-05-19T10:{index}:00.000+08:00"),
            )
            .expect("message should be stored");
        }

        let messages = recent_memory_messages_from_path(&path, &session.id, 3)
            .expect("recent memory messages should load");

        assert_eq!(messages.len(), 3);
        assert_eq!(messages[0].text, "我喜欢你先给结论。");
        assert_eq!(messages[2].text, "继续做记忆。");
        assert!(messages.iter().all(|message| message.speaker != "system"));
    }

    #[test]
    fn memory_backend_config_points_to_local_tencentdb_directory() {
        let value = build_memory_backend_config_payload(
            PathBuf::from("/tmp/irori-app-data/memory-tdai").as_path(),
            &StoredModelProfile {
                id: "m1".to_string(),
                name: "Pi".to_string(),
                base_url: "https://pi.example/v1".to_string(),
                model_name: "pi-1".to_string(),
                token: Some("tok-123".to_string()),
            },
        );

        assert_eq!(value["backend"], "tencentdb");
        assert_eq!(
            value["tencentdb"]["dataDir"],
            "/tmp/irori-app-data/memory-tdai"
        );
        assert_eq!(
            value["tencentdb"]["rootDataDir"],
            "/tmp/irori-app-data/memory-tdai"
        );
        assert_eq!(value["tencentdb"]["llm"]["baseUrl"], "https://pi.example/v1");
        assert_eq!(value["tencentdb"]["llm"]["model"], "pi-1");
        assert_eq!(value["tencentdb"]["llm"]["apiKey"], "tok-123");
    }

    #[test]
    fn memory_backend_config_omits_api_key_when_token_blank() {
        let value = build_memory_backend_config_payload(
            PathBuf::from("/tmp/irori-app-data/memory-tdai").as_path(),
            &StoredModelProfile {
                id: "m1".to_string(),
                name: "Pi".to_string(),
                base_url: "https://pi.example/v1".to_string(),
                model_name: "pi-1".to_string(),
                token: Some("   ".to_string()),
            },
        );

        assert!(value["tencentdb"]["llm"].get("apiKey").is_none());
    }

    #[test]
    fn memory_status_reports_local_backend_paths() {
        let status = memory_status_from_paths(
            PathBuf::from("/tmp/irori-app-data/memory-tdai").as_path(),
            PathBuf::from("/tmp/irori-sidecar").as_path(),
        );

        assert_eq!(status.configured_backend, "tencentdb");
        assert_eq!(status.fallback_backend, "chat-history");
        assert_eq!(status.memory_dir, "/tmp/irori-app-data/memory-tdai");
        assert!(!status.vectors_db_exists);
    }

    #[test]
    fn tool_policy_settings_fall_back_to_defaults() {
        let path = temp_tool_policy_path();

        let settings =
            read_tool_policy_settings_from_path(&path).expect("default policy should load");

        assert_eq!(settings["customTools"]["memory.read"], true);
        assert_eq!(settings["builtinTools"]["bash"], true);
        assert_eq!(settings["confirmTools"]["bash"], true);
        assert!(settings["protectedPaths"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!(".env")));
    }

    #[test]
    fn character_states_default_to_empty_object() {
        let path = temp_chat_history_path();

        let states = read_character_states_from_path(&path).expect("empty states should load");
        assert_eq!(states, serde_json::json!({}));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn character_states_round_trip_and_upsert() {
        let path = temp_chat_history_path();
        let states = serde_json::json!({
            "lulin": { "affinity": 42, "mood": "warm", "energy": 70, "meetCount": 3, "impressions": [] },
            "cenji": { "affinity": 12, "mood": "calm", "energy": 80, "meetCount": 1, "impressions": [] }
        });

        save_character_states_to_path(&path, states.clone(), "1000").expect("states should save");
        let stored = read_character_states_from_path(&path).expect("saved states should load");
        assert_eq!(stored, states);

        // Upserting one character keeps the others intact.
        let update = serde_json::json!({
            "lulin": { "affinity": 50, "mood": "playful", "energy": 65, "meetCount": 4, "impressions": [] }
        });
        save_character_states_to_path(&path, update, "2000").expect("update should save");
        let after = read_character_states_from_path(&path).expect("updated states should load");
        assert_eq!(after["lulin"]["affinity"], 50);
        assert_eq!(after["cenji"]["affinity"], 12);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn character_moments_default_to_empty_list() {
        let path = temp_chat_history_path();

        let moments = list_character_moments_from_path(&path, Some("lulin"), 50)
            .expect("empty moments should load");
        assert!(moments.is_empty());

        let _ = fs::remove_file(path);
    }

    #[test]
    fn character_moments_insert_filter_and_order_newest_first() {
        let path = temp_chat_history_path();

        insert_character_moment_to_path(
            &path,
            AddCharacterMomentRequest {
                character_id: "lulin".into(),
                text: "清晨的实验室很安静".into(),
            },
            "1000",
        )
        .expect("first moment should save");
        let second = insert_character_moment_to_path(
            &path,
            AddCharacterMomentRequest {
                character_id: "lulin".into(),
                text: "午后想喝杯咖啡".into(),
            },
            "2000",
        )
        .expect("second moment should save");
        insert_character_moment_to_path(
            &path,
            AddCharacterMomentRequest {
                character_id: "cenji".into(),
                text: "别人的动态".into(),
            },
            "1500",
        )
        .expect("other character moment should save");

        let lulin = list_character_moments_from_path(&path, Some("lulin"), 50)
            .expect("lulin moments should load");
        assert_eq!(lulin.len(), 2);
        assert_eq!(lulin[0].id, second.id);
        assert_eq!(lulin[0].text, "午后想喝杯咖啡");
        assert!(lulin[0].likes.is_empty());
        assert!(lulin[0].comments.is_empty());

        let all = list_character_moments_from_path(&path, None, 50).expect("all moments should load");
        assert_eq!(all.len(), 3);

        let limited = list_character_moments_from_path(&path, Some("lulin"), 1)
            .expect("limited moments should load");
        assert_eq!(limited.len(), 1);
        assert_eq!(limited[0].id, second.id);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn character_moment_interactions_round_trip_with_moments() {
        let path = temp_chat_history_path();
        let moment = insert_character_moment_to_path(
            &path,
            AddCharacterMomentRequest {
                character_id: "lulin".into(),
                text: "午后想喝杯咖啡".into(),
            },
            "2000",
        )
        .expect("moment should save");

        let liked = toggle_character_moment_like_to_path(
            &path,
            ToggleCharacterMomentLikeRequest {
                moment_id: moment.id.clone(),
                actor_type: "user".into(),
                actor_id: "self".into(),
                liked: true,
            },
            "2100",
        )
        .expect("like should save");
        assert_eq!(liked.likes.len(), 1);
        assert_eq!(liked.likes[0].actor_type, "user");
        assert_eq!(liked.likes[0].actor_id, "self");

        let commented = add_character_moment_comment_to_path(
            &path,
            AddCharacterMomentCommentRequest {
                moment_id: moment.id.clone(),
                actor_type: "character".into(),
                actor_id: "shili".into(),
                text: "我也想喝。".into(),
            },
            "2200",
        )
        .expect("comment should save");
        assert_eq!(commented.comments.len(), 1);
        assert_eq!(commented.comments[0].actor_id, "shili");
        assert_eq!(commented.comments[0].text, "我也想喝。");

        let listed = list_character_moments_from_path(&path, None, 50).expect("moments should load");
        assert_eq!(listed[0].likes.len(), 1);
        assert_eq!(listed[0].comments.len(), 1);

        let unliked = toggle_character_moment_like_to_path(
            &path,
            ToggleCharacterMomentLikeRequest {
                moment_id: moment.id.clone(),
                actor_type: "user".into(),
                actor_id: "self".into(),
                liked: false,
            },
            "2300",
        )
        .expect("unlike should save");
        assert!(unliked.likes.is_empty());
        assert_eq!(unliked.comments.len(), 1);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn character_letters_default_to_empty_list() {
        let path = temp_chat_history_path();

        let letters = list_character_letters_from_path(&path, Some("lulin"), 50)
            .expect("empty letters should load");
        assert!(letters.is_empty());

        let _ = fs::remove_file(path);
    }

    #[test]
    fn character_letters_insert_order_by_deliver_at_and_mark_read() {
        let path = temp_chat_history_path();

        let first = insert_character_letter_to_path(
            &path,
            AddCharacterLetterRequest {
                character_id: "lulin".into(),
                subject: "好久不见".into(),
                body: "最近天气转凉了，记得加衣。".into(),
                mood: Some("warm".into()),
                deliver_at: "2024-01-01T08:00:00Z".into(),
                sender: None,
                reply_to: None,
                kind: None,
                meta: None,
            },
            "2024-01-01T00:00:00Z",
        )
        .expect("first letter should save");
        let later = insert_character_letter_to_path(
            &path,
            AddCharacterLetterRequest {
                character_id: "lulin".into(),
                subject: "今天的事".into(),
                body: "我去了海边，想起了你。".into(),
                mood: None,
                deliver_at: "2024-01-02T08:00:00Z".into(),
                sender: None,
                reply_to: None,
                kind: None,
                meta: None,
            },
            "2024-01-01T01:00:00Z",
        )
        .expect("second letter should save");
        insert_character_letter_to_path(
            &path,
            AddCharacterLetterRequest {
                character_id: "cenji".into(),
                subject: "别人的信".into(),
                body: "无关内容".into(),
                mood: None,
                deliver_at: "2024-01-03T08:00:00Z".into(),
                sender: None,
                reply_to: None,
                kind: None,
                meta: None,
            },
            "2024-01-01T02:00:00Z",
        )
        .expect("other character letter should save");

        let lulin = list_character_letters_from_path(&path, Some("lulin"), 50)
            .expect("lulin letters should load");
        assert_eq!(lulin.len(), 2);
        assert_eq!(lulin[0].id, later.id);
        assert_eq!(lulin[0].subject, "今天的事");
        assert!(lulin[0].read_at.is_none());
        assert_eq!(lulin[0].sender, "character");

        let all = list_character_letters_from_path(&path, None, 50).expect("all letters should load");
        assert_eq!(all.len(), 3);

        let marked = mark_character_letter_read_to_path(&path, &first.id, "2024-01-01T09:00:00Z")
            .expect("letter should mark read");
        assert_eq!(marked.read_at.as_deref(), Some("2024-01-01T09:00:00Z"));

        // 二次标记不会覆盖首次已读时间。
        let again = mark_character_letter_read_to_path(&path, &first.id, "2024-01-01T10:00:00Z")
            .expect("second mark read should be a no-op update");
        assert_eq!(again.read_at.as_deref(), Some("2024-01-01T09:00:00Z"));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn character_letters_store_user_sender_and_reply_link() {
        let path = temp_chat_history_path();

        let user_letter = insert_character_letter_to_path(
            &path,
            AddCharacterLetterRequest {
                character_id: "lulin".into(),
                subject: "想你了".into(),
                body: "最近还好吗？".into(),
                mood: None,
                deliver_at: "2024-02-01T00:00:00Z".into(),
                sender: Some("user".into()),
                reply_to: None,
                kind: None,
                meta: None,
            },
            "2024-02-01T00:00:00Z",
        )
        .expect("user letter should save");
        assert_eq!(user_letter.sender, "user");

        let reply = insert_character_letter_to_path(
            &path,
            AddCharacterLetterRequest {
                character_id: "lulin".into(),
                subject: "回信".into(),
                body: "我很好，谢谢你想着我。".into(),
                mood: Some("warm".into()),
                deliver_at: "2024-02-01T06:00:00Z".into(),
                sender: Some("character".into()),
                reply_to: Some(user_letter.id.clone()),
                kind: None,
                meta: None,
            },
            "2024-02-01T01:00:00Z",
        )
        .expect("reply should save");
        assert_eq!(reply.sender, "character");
        assert_eq!(reply.reply_to.as_deref(), Some(user_letter.id.as_str()));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn character_letters_store_kind_meta_and_reaction() {
        let path = temp_chat_history_path();

        // 明确指定 kind=gift + meta，回读应原样保留。
        let gift = insert_character_letter_to_path(
            &path,
            AddCharacterLetterRequest {
                character_id: "lulin".into(),
                subject: "给你的小东西".into(),
                body: "在沙滩上捡的，形状像你的耳朵。".into(),
                mood: Some("playful".into()),
                deliver_at: "2024-03-01T08:00:00Z".into(),
                sender: None,
                reply_to: None,
                kind: Some("gift".into()),
                meta: Some(r#"{"item":"贝壳"}"#.into()),
            },
            "2024-03-01T00:00:00Z",
        )
        .expect("gift keepsake should save");
        assert_eq!(gift.kind, "gift");
        assert_eq!(gift.meta.as_deref(), Some(r#"{"item":"贝壳"}"#));
        assert!(gift.reaction.is_none());

        // 不指定 kind 时按 postcard 兜底。
        let fallback = insert_character_letter_to_path(
            &path,
            AddCharacterLetterRequest {
                character_id: "lulin".into(),
                subject: "无 kind".into(),
                body: "兜底为明信片".into(),
                mood: None,
                deliver_at: "2024-03-02T08:00:00Z".into(),
                sender: None,
                reply_to: None,
                kind: None,
                meta: None,
            },
            "2024-03-02T00:00:00Z",
        )
        .expect("fallback keepsake should save");
        assert_eq!(fallback.kind, "postcard");

        // 写入回应：reaction 落库，且自动标记已读。
        let reacted = set_character_letter_reaction_to_path(
            &path,
            &gift.id,
            Some(r#"{"emoji":"🥰","text":"好喜欢","at":1709280000000}"#),
            "2024-03-01T09:00:00Z",
        )
        .expect("reaction should save");
        assert_eq!(
            reacted.reaction.as_deref(),
            Some(r#"{"emoji":"🥰","text":"好喜欢","at":1709280000000}"#)
        );
        assert_eq!(reacted.read_at.as_deref(), Some("2024-03-01T09:00:00Z"));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn tool_policy_settings_round_trip_json() {
        let path = temp_tool_policy_path();
        let settings = serde_json::json!({
            "builtinTools": { "read": true, "grep": true, "find": true, "ls": true, "bash": true },
            "customTools": { "memory.read": true, "memory.write": true, "web.fetch": true },
            "confirmTools": { "bash": true, "memory.write": true },
            "protectedPaths": [".env", ".ssh"]
        });

        save_tool_policy_settings_to_path(&path, settings.clone()).expect("policy should save");
        let stored = read_tool_policy_settings_from_path(&path).expect("saved policy should load");

        assert_eq!(stored, settings);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn web_access_settings_default_to_auto_no_key_fallback() {
        let path = temp_web_access_path();

        let snapshot = read_web_access_settings_from_path(&path).expect("default should load");

        assert_eq!(snapshot.provider, "auto");
        assert_eq!(snapshot.workflow, "none");
        assert!(snapshot.no_key_fallback);
        assert!(!snapshot.allow_browser_cookies);
        assert!(!snapshot.exa_has_key);
        assert!(!snapshot.perplexity_has_key);
        assert!(!snapshot.gemini_has_key);
    }

    #[test]
    fn web_access_settings_save_redacts_and_preserves_keys() {
        let path = temp_web_access_path();

        let saved = save_web_access_settings_to_path(
            &path,
            SaveWebAccessSettingsRequest {
                provider: "perplexity".to_string(),
                workflow: "summary-review".to_string(),
                no_key_fallback: true,
                allow_browser_cookies: true,
                exa_api_key: None,
                perplexity_api_key: Some("pplx-secret-abcdef".to_string()),
                gemini_api_key: None,
            },
        )
        .expect("web access settings should save");

        assert_eq!(saved.provider, "perplexity");
        assert!(saved.perplexity_has_key);
        assert_eq!(saved.perplexity_key_hint.as_deref(), Some("••••cdef"));

        let stored: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).expect("file should exist"))
                .expect("stored json should parse");
        assert_eq!(stored["perplexityApiKey"], "pplx-secret-abcdef");

        let preserved = save_web_access_settings_to_path(
            &path,
            SaveWebAccessSettingsRequest {
                provider: "auto".to_string(),
                workflow: "none".to_string(),
                no_key_fallback: true,
                allow_browser_cookies: false,
                exa_api_key: None,
                perplexity_api_key: Some("".to_string()),
                gemini_api_key: None,
            },
        )
        .expect("empty key should preserve existing");

        assert_eq!(preserved.provider, "auto");
        assert!(preserved.perplexity_has_key);
        assert_eq!(preserved.perplexity_key_hint.as_deref(), Some("••••cdef"));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn sidecar_prompt_payload_includes_tool_policy_settings() {
        let stored = StoredModelProfile {
            id: "default".to_string(),
            name: "OpenAI".to_string(),
            base_url: "https://api.openai.com/v1".to_string(),
            model_name: "gpt-5.5".to_string(),
            token: Some("sk-test".to_string()),
        };
        let tool_policy_settings = serde_json::json!({
            "builtinTools": { "read": true, "grep": true, "bash": false },
            "customTools": { "memory.read": true },
            "confirmTools": { "bash": true },
            "protectedPaths": [".env"]
        });

        let payload = build_sidecar_prompt_payload(
            "/tmp/irori-workspace".into(),
            &stored,
            "你好".to_string(),
            Some(serde_json::json!({ "sessionId": "session-1" })),
            tool_policy_settings.clone(),
            serde_json::json!({
                "provider": "auto",
                "workflow": "none",
                "noKeyFallback": true
            }),
            None,
        );

        assert_eq!(payload["cwd"], "/tmp/irori-workspace");
        assert_eq!(payload["toolPolicySettings"], tool_policy_settings);
        assert_eq!(payload["webAccessSettings"]["provider"], "auto");
        assert_eq!(payload["webAccessSettings"]["workflow"], "none");
        assert_eq!(payload["runtimeToken"], "sk-test");
    }

    #[test]
    fn sidecar_prompt_command_uses_node_entrypoint() {
        let args = sidecar_prompt_command_args(
            PathBuf::from("/tmp/irori-sidecar").as_path(),
        );

        assert_eq!(args, vec!["/tmp/irori-sidecar/bin/pi-prompt.mjs"]);
    }

    #[test]
    fn sidecar_stream_lines_parse_progress_and_final_records() {
        let progress = parse_sidecar_stream_line(
            r#"{"type":"progress","event":{"runId":"run-1","phase":"thinking","delta":"先想一下"}}"#,
        )
        .expect("progress line should parse");

        match progress {
            SidecarStreamMessage::Progress(event) => {
                assert_eq!(event["runId"], "run-1");
                assert_eq!(event["phase"], "thinking");
                assert_eq!(event["delta"], "先想一下");
            }
            _ => panic!("expected progress record"),
        }

        let final_record = parse_sidecar_stream_line(
            r#"{"type":"final","response":{"providerId":"openai-compatible","modelRoute":"POST http://localhost:11434/v1/chat/completions · body.model = qwen","text":"你好"}}"#,
        )
        .expect("final line should parse");

        match final_record {
            SidecarStreamMessage::Final(response) => {
                assert_eq!(response.provider_id, "openai-compatible");
                assert_eq!(response.model_route, "POST http://localhost:11434/v1/chat/completions · body.model = qwen");
                assert_eq!(response.text, "你好");
            }
            _ => panic!("expected final record"),
        }
    }

    #[test]
    fn sidecar_stream_lines_parse_confirm_request_records() {
        let confirm = parse_sidecar_stream_line(
            r#"{"type":"confirm_request","confirmId":"run-1-confirm-1","runId":"run-1","tool":{"name":"edit","target":"src/app.ts","reason":"需要确认"}}"#,
        )
        .expect("confirm line should parse");

        match confirm {
            SidecarStreamMessage::ConfirmRequest(request) => {
                assert_eq!(request["confirmId"], "run-1-confirm-1");
                assert_eq!(request["runId"], "run-1");
                assert_eq!(request["tool"]["name"], "edit");
            }
            _ => panic!("expected confirm request record"),
        }
    }

    #[test]
    fn model_profile_reads_legacy_model_settings_as_one_active_profile() {
        let path = temp_settings_path();
        fs::write(
            &path,
            r#"{"baseUrl":"http://localhost:11434/v1","modelName":"qwen3-coder","token":"ollama-token"}"#,
        )
        .expect("legacy settings should be written");

        let snapshot = read_model_settings_from_path(&path).expect("legacy settings should load");

        assert_eq!(snapshot.active_model_id, "default");
        assert_eq!(snapshot.profiles.len(), 1);
        assert_eq!(snapshot.profiles[0].id, "default");
        assert_eq!(snapshot.profiles[0].base_url, "http://localhost:11434/v1");
        assert_eq!(snapshot.profiles[0].model_name, "qwen3-coder");
        assert_eq!(snapshot.profiles[0].name, "qwen3-coder");
        assert!(snapshot.profiles[0].has_token);
        assert_eq!(snapshot.profiles[0].token_hint.as_deref(), Some("••••oken"));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn model_profile_saves_profile_and_preserves_existing_token_when_blank() {
        let path = temp_settings_path();
        save_model_settings_to_path(
            &path,
            SaveModelSettingsRequest {
                profile_id: "glm".to_string(),
                name: "智谱 GLM".to_string(),
                base_url: "https://open.bigmodel.cn/api/coding/paas/v4/GLM-5.1".to_string(),
                model_name: "glm-5.1".to_string(),
                token: Some("sk-glm-123456".to_string()),
                make_active: Some(true),
            },
        )
        .expect("settings should save");

        let snapshot = save_model_settings_to_path(
            &path,
            SaveModelSettingsRequest {
                profile_id: "glm".to_string(),
                name: "智谱 GLM".to_string(),
                base_url: "https://open.bigmodel.cn/api/coding/paas/v4".to_string(),
                model_name: "glm-5.1".to_string(),
                token: Some("   ".to_string()),
                make_active: Some(true),
            },
        )
        .expect("settings should update");

        assert_eq!(snapshot.active_model_id, "glm");
        let profile = snapshot
            .profiles
            .iter()
            .find(|profile| profile.id == "glm")
            .expect("saved profile should be present");
        assert_eq!(
            profile.base_url,
            "https://open.bigmodel.cn/api/coding/paas/v4"
        );
        assert_eq!(profile.model_name, "glm-5.1");
        assert!(profile.has_token);
        assert_eq!(profile.token_hint.as_deref(), Some("••••3456"));

        let raw = fs::read_to_string(&path).expect("settings file should exist");
        assert!(raw.contains("activeModelId"));
        assert!(raw.contains("profiles"));
        assert!(raw.contains("sk-glm-123456"));

        let stored = read_stored_model_registry(&path).expect("stored registry should load");
        let stored_profile = stored
            .profiles
            .iter()
            .find(|profile| profile.id == "glm")
            .expect("stored profile should be present");
        assert_eq!(stored_profile.token.as_deref(), Some("sk-glm-123456"));

        let _ = fs::remove_file(path);
    }

    #[test]
    fn model_profile_switches_active_profile() {
        let path = temp_settings_path();
        save_model_settings_to_path(
            &path,
            SaveModelSettingsRequest {
                profile_id: "glm".to_string(),
                name: "智谱 GLM".to_string(),
                base_url: "https://open.bigmodel.cn/api/coding/paas/v4".to_string(),
                model_name: "glm-5.1".to_string(),
                token: Some("sk-glm-123456".to_string()),
                make_active: Some(false),
            },
        )
        .expect("settings should save");

        let snapshot = set_active_model_profile_at_path(&path, "glm")
            .expect("existing profile should become active");

        assert_eq!(snapshot.active_model_id, "glm");

        let _ = fs::remove_file(path);
    }

    #[test]
    fn model_profile_deletes_active_profile_and_selects_remaining_profile() {
        let path = temp_settings_path();
        save_model_settings_to_path(
            &path,
            SaveModelSettingsRequest {
                profile_id: "glm".to_string(),
                name: "智谱 GLM".to_string(),
                base_url: "https://open.bigmodel.cn/api/coding/paas/v4".to_string(),
                model_name: "glm-5.1".to_string(),
                token: Some("sk-glm-123456".to_string()),
                make_active: Some(true),
            },
        )
        .expect("settings should save");

        let snapshot =
            delete_model_profile_at_path(&path, "glm").expect("active profile should delete");

        assert_eq!(snapshot.active_model_id, "default");
        assert!(snapshot.profiles.iter().all(|profile| profile.id != "glm"));
        assert_eq!(snapshot.profiles.len(), 1);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn model_profile_keeps_sidecar_prompt_payload_single_active_shape() {
        let stored = StoredModelProfile {
            id: "glm".to_string(),
            name: "智谱 GLM".to_string(),
            base_url: "https://open.bigmodel.cn/api/coding/paas/v4".to_string(),
            model_name: "glm-5.1".to_string(),
            token: Some("sk-glm-123456".to_string()),
        };

        let payload = build_sidecar_prompt_payload(
            "/tmp/irori-workspace".into(),
            &stored,
            "请只回复 OK".to_string(),
            None,
            serde_json::json!({}),
            serde_json::json!({ "provider": "auto", "workflow": "none" }),
            None,
        );

        assert_eq!(payload["modelSettings"]["baseUrl"], stored.base_url);
        assert_eq!(payload["modelSettings"]["modelName"], stored.model_name);
        assert_eq!(payload["runtimeToken"], "sk-glm-123456");
        assert!(payload["modelSettings"].get("token").is_none());
        assert!(payload.get("profiles").is_none());
    }

    #[test]
    fn sidecar_prompt_payload_includes_read_only_browser_snapshot() {
        let stored = StoredModelProfile {
            id: "glm".to_string(),
            name: "智谱 GLM".to_string(),
            base_url: "https://open.bigmodel.cn/api/coding/paas/v4".to_string(),
            model_name: "glm-5.1".to_string(),
            token: Some("sk-glm-123456".to_string()),
        };

        let payload = build_sidecar_prompt_payload(
            "/tmp/irori-workspace".into(),
            &stored,
            "请打开来源".to_string(),
            None,
            serde_json::json!({}),
            serde_json::json!({ "provider": "auto", "workflow": "none" }),
            Some(serde_json::json!({
                "currentUrl": "https://example.com/source",
                "title": "Source",
                "status": "loading"
            })),
        );

        assert_eq!(payload["browserSnapshot"]["currentUrl"], "https://example.com/source");
        assert_eq!(payload["browserSnapshot"]["title"], "Source");
        assert_eq!(payload["browserSnapshot"]["status"], "loading");
    }

    #[test]
    fn model_profile_settings_snapshot_serializes_camel_case_for_frontend() {
        let snapshot = ModelSettingsSnapshot {
            active_model_id: "glm".to_string(),
            profiles: vec![ModelProfileSnapshot {
                id: "glm".to_string(),
                name: "智谱 GLM".to_string(),
                base_url: "https://open.bigmodel.cn/api/coding/paas/v4".to_string(),
                model_name: "glm-5.1".to_string(),
                has_token: true,
                token_hint: Some("••••3456".to_string()),
            }],
        };

        let value = serde_json::to_value(snapshot).expect("snapshot should serialize");
        assert_eq!(value["activeModelId"], "glm");
        assert_eq!(value["profiles"][0]["id"], "glm");
        assert_eq!(
            value["profiles"][0]["baseUrl"],
            "https://open.bigmodel.cn/api/coding/paas/v4"
        );
        assert_eq!(value["profiles"][0]["modelName"], "glm-5.1");
        assert_eq!(value["profiles"][0]["hasToken"], true);
        assert_eq!(value["profiles"][0]["tokenHint"], "••••3456");
    }

    #[test]
    fn normalize_openai_settings_removes_model_suffix_from_base_url() {
        let normalized = normalize_openai_compatible_settings(
            "https://open.bigmodel.cn/api/coding/paas/v4/GLM-5.1",
            "glm-5.1",
        );

        assert_eq!(normalized.0, "https://open.bigmodel.cn/api/coding/paas/v4");
        assert_eq!(normalized.1, "glm-5.1");
    }

    #[test]
    fn skill_name_validation_matches_agentskills_rules() {
        assert!(is_valid_skill_name("tarot-reading"));
        assert!(is_valid_skill_name("weather2"));
        assert!(!is_valid_skill_name(""));
        assert!(!is_valid_skill_name("Tarot"));
        assert!(!is_valid_skill_name("-lead"));
        assert!(!is_valid_skill_name("trail-"));
        assert!(!is_valid_skill_name("double--hyphen"));
        assert!(!is_valid_skill_name("with space"));
        assert!(!is_valid_skill_name(&"a".repeat(65)));
    }

    #[test]
    fn skill_md_round_trips_frontmatter_and_body() {
        // A description with a colon and quotes must survive the YAML round-trip,
        // and allowed-tools must round-trip as a space-delimited list.
        let rendered = render_skill_md(
            "tarot-reading",
            "当用户想算塔罗：求\"指引\"时使用",
            "# 塔罗解读\n抽三张牌。",
            true,
            &["web.search".to_string(), "browser.view".to_string()],
        );
        let (description, body, disable, allowed_tools) = parse_skill_md(&rendered, "tarot-reading");
        assert_eq!(description, "当用户想算塔罗：求\"指引\"时使用");
        assert_eq!(body, "# 塔罗解读\n抽三张牌。");
        assert!(disable);
        assert_eq!(allowed_tools, vec!["web.search".to_string(), "browser.view".to_string()]);
    }

    #[test]
    fn skill_without_frontmatter_falls_back_to_dir_name() {
        let (description, body, disable, allowed_tools) = parse_skill_md("just a body", "fallback-name");
        assert_eq!(description, "");
        assert_eq!(body, "just a body");
        assert!(!disable);
        assert!(allowed_tools.is_empty());
    }

    #[test]
    fn character_skill_required_tools_unions_enabled_skills() {
        let root = temp_skills_root();
        let chat_history = temp_chat_history_path();

        // Two skills with overlapping tool needs, one disabled skill that must NOT count.
        create_skill_at_dir(
            &root,
            SaveSkillRequest {
                allowed_tools: vec!["web.search".to_string(), "browser.view".to_string()],
                ..save_skill_request("tarot-reading", "塔罗", "# x")
            },
        )
        .expect("create tarot");
        create_skill_at_dir(
            &root,
            SaveSkillRequest {
                allowed_tools: vec!["web.search".to_string(), "memory.read".to_string()],
                ..save_skill_request("weather-lookup", "天气", "# y")
            },
        )
        .expect("create weather");
        create_skill_at_dir(
            &root,
            SaveSkillRequest {
                allowed_tools: vec!["memory.write".to_string()],
                ..save_skill_request("secret-skill", "秘密", "# z")
            },
        )
        .expect("create secret");

        set_character_skill_to_path(&chat_history, "lulin", "tarot-reading", true, "t0").unwrap();
        set_character_skill_to_path(&chat_history, "lulin", "weather-lookup", true, "t1").unwrap();
        // Assigned but disabled — its tools must be excluded.
        set_character_skill_to_path(&chat_history, "lulin", "secret-skill", false, "t2").unwrap();

        let tools = character_skill_required_tools(&root, &chat_history, "lulin")
            .expect("union tools");

        // Deduped union of the two enabled skills, no memory.write from the disabled one.
        assert!(tools.contains(&"web.search".to_string()));
        assert!(tools.contains(&"browser.view".to_string()));
        assert!(tools.contains(&"memory.read".to_string()));
        assert!(!tools.contains(&"memory.write".to_string()));
        assert_eq!(tools.iter().filter(|t| *t == "web.search").count(), 1);

        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_file(&chat_history);
    }

    #[test]
    fn create_list_update_delete_skill_files() {
        let root = temp_skills_root();
        let chat_history = temp_chat_history_path();

        // Empty library starts empty.
        assert!(list_skills_from_dir(&root).expect("list empty").is_empty());

        // Create.
        let created = create_skill_at_dir(
            &root,
            save_skill_request("tarot-reading", "算塔罗时用", "# 抽牌"),
        )
        .expect("create skill");
        assert_eq!(created.name, "tarot-reading");
        assert_eq!(created.description, "算塔罗时用");

        // Duplicate name is rejected.
        assert!(create_skill_at_dir(
            &root,
            save_skill_request("tarot-reading", "x", "y")
        )
        .is_err());

        // Invalid name is rejected.
        assert!(create_skill_at_dir(&root, save_skill_request("Bad Name", "x", "y")).is_err());

        // List reflects the create.
        let listed = list_skills_from_dir(&root).expect("list one");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].body, "# 抽牌");

        // Update rewrites content.
        update_skill_at_dir(
            &root,
            save_skill_request("tarot-reading", "新描述", "# 新正文"),
        )
        .expect("update skill");
        let after_update = list_skills_from_dir(&root).expect("list after update");
        assert_eq!(after_update[0].description, "新描述");
        assert_eq!(after_update[0].body, "# 新正文");

        // Assign to a character, then delete the skill: the mapping is cleaned up.
        set_character_skill_to_path(&chat_history, "lulin", "tarot-reading", true, "t0")
            .expect("assign skill");
        assert_eq!(
            list_character_skills_from_path(&chat_history, "lulin").expect("list assigned"),
            vec!["tarot-reading".to_string()]
        );

        delete_skill_at_dir(&root, &chat_history, "tarot-reading").expect("delete skill");
        assert!(list_skills_from_dir(&root).expect("list after delete").is_empty());
        assert!(list_character_skills_from_path(&chat_history, "lulin")
            .expect("list after delete")
            .is_empty());

        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_file(&chat_history);
    }

    #[test]
    fn character_skill_assignment_round_trips_and_filters_disabled() {
        let path = temp_chat_history_path();

        set_character_skill_to_path(&path, "lulin", "tarot-reading", true, "t0").expect("enable");
        set_character_skill_to_path(&path, "lulin", "weather-lookup", true, "t1").expect("enable");
        set_character_skill_to_path(&path, "mio", "tarot-reading", true, "t2").expect("enable");

        // lulin knows both; mio only tarot.
        let mut lulin = list_character_skills_from_path(&path, "lulin").expect("list lulin");
        lulin.sort();
        assert_eq!(lulin, vec!["tarot-reading".to_string(), "weather-lookup".to_string()]);
        assert_eq!(
            list_character_skills_from_path(&path, "mio").expect("list mio"),
            vec!["tarot-reading".to_string()]
        );

        // Disabling drops it from the enabled list but keeps the assignment row.
        set_character_skill_to_path(&path, "lulin", "weather-lookup", false, "t3").expect("disable");
        assert_eq!(
            list_character_skills_from_path(&path, "lulin").expect("list after disable"),
            vec!["tarot-reading".to_string()]
        );

        // tarot-reading is assigned to two characters.
        let assignments =
            list_skill_assignments_from_path(&path, "tarot-reading").expect("assignments");
        assert_eq!(assignments.len(), 2);

        let _ = fs::remove_file(&path);
    }
}
