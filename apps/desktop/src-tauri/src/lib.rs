use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

/// Keeps the local-agent child's stdin open for streaming runs so the desktop
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
    /// 工具审核模式："default"（用户手动）| "auto"（大模型审查）| "all"（全部通过）。
    #[serde(default)]
    review_mode: Option<String>,
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
enum LocalAgentStreamMessage {
    Progress(serde_json::Value),
    ConfirmRequest(serde_json::Value),
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
}

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

const DEFAULT_BASE_URL: &str = "https://api.openai.com/v1";
const DEFAULT_MODEL_NAME: &str = "gpt-5.5";

#[tauri::command]
fn companion_status() -> &'static str {
    "Cockapoo Pi Companion desktop shell is ready."
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
async fn send_pi_prompt(
    app: AppHandle,
    request: SendPiPromptRequest,
) -> Result<PiPromptResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let prompt = request
            .session_prompt
            .clone()
            .unwrap_or_else(|| format!("[character:{}]\n{}", request.character_id, request.prompt));

        run_local_agent_prompt(app, prompt, Some(request), None)
    })
    .await
    .map_err(|error| format!("等待 local-agent 后台任务失败：{error}"))?
}

#[tauri::command]
async fn test_model_connection(
    app: AppHandle,
    request: Option<TestModelConnectionRequest>,
) -> Result<PiPromptResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_local_agent_prompt(
            app,
            "请只回复两个字母：OK。不要解释，不要使用 Markdown。".to_string(),
            None,
            request,
        )
    })
    .await
    .map_err(|error| format!("等待 local-agent 后台任务失败：{error}"))?
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
fn get_memory_status(app: AppHandle) -> Result<MemoryStatus, String> {
    Ok(memory_status_from_paths(
        &memory_backend_dir(&app)?,
        &local_agent_dir(),
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

    if let Ok(workspace) = workspace_root_dir() {
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
    let agent_dir = local_agent_dir();
    let chat_history_memory = build_chat_history_memory_payload(&app, request.as_ref())?;
    let tool_policy_settings =
        read_tool_policy_settings_from_path(&tool_policy_settings_path(&app)?)
            .map_err(|error| error.to_string())?;
    let resolved = StoredModelProfile {
        token: Some(token),
        ..stored
    };
    let mut payload = build_local_agent_prompt_payload(
        std::env::current_dir()
            .map_err(|error| error.to_string())?
            .to_string_lossy()
            .to_string(),
        &resolved,
        prompt,
        chat_history_memory,
        tool_policy_settings,
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
    }

    if let Some(run_id) = request.as_ref().and_then(|request| request.run_id.clone()) {
        payload["streamEvents"] = serde_json::Value::Bool(true);
        payload["runId"] = serde_json::Value::String(run_id);
        return execute_sidecar_prompt_streaming(app, agent_dir, payload);
    }

    execute_sidecar_prompt(agent_dir, payload)
}

fn execute_sidecar_prompt(
    agent_dir: PathBuf,
    payload: serde_json::Value,
) -> Result<PiPromptResponse, String> {
    let mut command = Command::new("pnpm");
    for arg in sidecar_prompt_command_args(&agent_dir) {
        command.arg(arg);
    }

    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("启动 local-agent 失败：{error}"))?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(payload.to_string().as_bytes())
            .map_err(|error| format!("写入 prompt 失败：{error}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|error| format!("等待 local-agent 失败：{error}"))?;

    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if error.is_empty() {
            "local-agent prompt 执行失败。".to_string()
        } else {
            error
        });
    }

    let response: PiPromptResponse = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("解析 local-agent 响应失败：{error}"))?;

    if response.text.trim().is_empty() {
        return Err("模型连接成功但没有返回文本，请检查模型是否支持聊天补全。".to_string());
    }

    Ok(response)
}

fn parse_local_agent_stream_line(line: &str) -> Result<LocalAgentStreamMessage, String> {
    let value: serde_json::Value = serde_json::from_str(line)
        .map_err(|error| format!("解析 local-agent 流式响应失败：{error}"))?;

    match value.get("type").and_then(|item| item.as_str()) {
        Some("progress") => {
            let event = value
                .get("event")
                .cloned()
                .ok_or_else(|| "local-agent 进度事件缺少 event 字段。".to_string())?;

            Ok(LocalAgentStreamMessage::Progress(event))
        }
        Some("confirm_request") => Ok(LocalAgentStreamMessage::ConfirmRequest(value)),
        Some("final") => {
            let response = value
                .get("response")
                .cloned()
                .ok_or_else(|| "local-agent 最终响应缺少 response 字段。".to_string())?;

            serde_json::from_value(response)
                .map(LocalAgentStreamMessage::Final)
                .map_err(|error| format!("解析 local-agent 最终响应失败：{error}"))
        }
        _ => serde_json::from_value(value)
            .map(LocalAgentStreamMessage::Final)
            .map_err(|error| format!("解析 local-agent 响应失败：{error}")),
    }
}

fn read_local_agent_stream(
    app: &AppHandle,
    stdout: std::process::ChildStdout,
) -> Result<Option<PiPromptResponse>, String> {
    let mut final_response = None;
    let reader = BufReader::new(stdout);

    for line in reader.lines() {
        let line = line.map_err(|error| format!("读取 local-agent 流式响应失败：{error}"))?;
        let line = line.trim();

        if line.is_empty() {
            continue;
        }

        match parse_local_agent_stream_line(line)? {
            LocalAgentStreamMessage::Progress(event) => {
                app.emit("pi_prompt_progress", event)
                    .map_err(|error| format!("推送模型进度失败：{error}"))?;
            }
            LocalAgentStreamMessage::ConfirmRequest(request) => {
                app.emit("pi_tool_confirm", request)
                    .map_err(|error| format!("推送工具确认请求失败：{error}"))?;
            }
            LocalAgentStreamMessage::Final(response) => {
                final_response = Some(response);
            }
        }
    }

    Ok(final_response)
}

fn execute_local_agent_prompt_streaming(
    app: AppHandle,
    agent_dir: PathBuf,
    payload: serde_json::Value,
) -> Result<PiPromptResponse, String> {
    let mut command = Command::new("pnpm");
    for arg in local_agent_prompt_command_args(&agent_dir) {
        command.arg(arg);
    }

    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("启动 local-agent 失败：{error}"))?;

    let run_id = payload
        .get("runId")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "local-agent stdin 不可用。".to_string())?;
    // Take the output handles before parking stdin in the registry, so an
    // unexpected failure here can't leave a dangling confirm channel behind.
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "local-agent stdout 不可用。".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "local-agent stderr 不可用。".to_string())?;

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

    let stream_result = read_local_agent_stream(&app, stdout);

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
        .map_err(|error| format!("等待 local-agent 失败：{error}"))?;
    let stderr = stderr_reader.join().unwrap_or_default();

    if !output_status.success() {
        let error = stderr.trim().to_string();
        return Err(if error.is_empty() {
            "local-agent prompt 执行失败。".to_string()
        } else {
            error
        });
    }

    let response = final_response
        .ok_or_else(|| "local-agent prompt 没有返回最终响应。".to_string())?;

    if response.text.trim().is_empty() {
        return Err("模型连接成功但没有返回文本，请检查模型是否支持聊天补全。".to_string());
    }

    Ok(response)
}

fn local_agent_prompt_command_args(agent_dir: &Path) -> Vec<String> {
    vec![
        "--silent".to_string(),
        "--dir".to_string(),
        agent_dir.to_string_lossy().to_string(),
        "prompt".to_string(),
    ]
}

fn build_local_agent_prompt_payload(
    cwd: String,
    stored: &StoredModelProfile,
    prompt: String,
    chat_history_memory: Option<serde_json::Value>,
    tool_policy_settings: serde_json::Value,
) -> serde_json::Value {
    let mut payload = serde_json::json!({
        "cwd": cwd,
        "modelSettings": {
            "baseUrl": stored.base_url,
            "modelName": stored.model_name
        },
        "runtimeToken": stored.token.clone().unwrap_or_default(),
        "prompt": prompt,
        "toolPolicySettings": tool_policy_settings
    });

    if let Some(memory) = chat_history_memory {
        payload["chatHistoryMemory"] = memory;
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

fn workspace_root_dir() -> Result<PathBuf, String> {
    std::env::current_dir().map_err(|error| error.to_string())
}

fn home_root_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().home_dir().map_err(|error| error.to_string())
}

/// File browsing is scoped to the workspace (cwd) and the user's home dir, so a
/// crafted path can't walk into arbitrary system locations. Both sides are
/// canonicalized first so symlinks / `..` can't slip past the prefix check.
fn workspace_path_allowed(app: &AppHandle, canonical: &Path) -> bool {
    [workspace_root_dir().ok(), home_root_dir(app).ok()]
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

fn review_mode_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("review-mode.json"))
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

fn local_agent_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("local-agent")
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
          reply_to TEXT
        );

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
        "#,
    )?;

    // 老库迁移：早于双向通信的 character_letter 没有 sender/reply_to 列，补上。
    // 列已存在时 ALTER 会报错，忽略即可。
    let _ = connection.execute(
        "ALTER TABLE character_letter ADD COLUMN sender TEXT NOT NULL DEFAULT 'character'",
        [],
    );
    let _ = connection.execute("ALTER TABLE character_letter ADD COLUMN reply_to TEXT", []);

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

    connection.execute(
        "INSERT INTO character_letter (id, character_id, subject, body, mood, created_at, deliver_at, read_at, sender, reply_to)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, ?9)",
        params![
            id,
            request.character_id,
            request.subject,
            request.body,
            request.mood,
            now,
            request.deliver_at,
            sender,
            request.reply_to
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
            "SELECT id, character_id, subject, body, mood, created_at, deliver_at, read_at, sender, reply_to
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
            "SELECT id, character_id, subject, body, mood, created_at, deliver_at, read_at, sender, reply_to
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

fn get_character_letter_record(
    connection: &Connection,
    id: &str,
) -> Result<Option<CharacterLetterRecord>, rusqlite::Error> {
    connection
        .query_row(
            "SELECT id, character_id, subject, body, mood, created_at, deliver_at, read_at, sender, reply_to
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
    })
}

fn open_chat_history(path: &Path) -> Result<Connection, Box<dyn std::error::Error>> {
    init_chat_history_at_path(path)?;
    Ok(Connection::open(path)?)
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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(PromptStdinRegistry::default())
        .invoke_handler(tauri::generate_handler![
            add_character_letter,
            add_character_moment,
            add_character_moment_comment,
            append_chat_message,
            companion_status,
            create_chat_session,
            delete_model_profile,
            get_character_states,
            get_chat_session,
            get_memory_status,
            get_model_settings,
            get_review_mode,
            get_tool_policy_settings,
            list_character_letters,
            list_character_moments,
            list_chat_sessions,
            list_workspace_dir,
            list_workspace_roots,
            mark_character_letter_read,
            respond_pi_tool_confirm,
            save_character_states,
            save_model_settings,
            save_tool_policy_settings,
            set_active_model_profile,
            set_review_mode,
            send_pi_prompt,
            test_model_connection,
            toggle_character_moment_like
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Cockapoo Pi Companion");
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{
        append_chat_message_to_path, build_local_agent_prompt_payload,
        build_memory_backend_config_payload,
        create_chat_session_at_path, delete_model_profile_at_path, get_chat_session_from_path,
        init_chat_history_at_path, insert_character_letter_to_path, insert_character_moment_to_path,
        list_character_letters_from_path, list_character_moments_from_path,
        list_chat_sessions_from_path, local_agent_prompt_command_args,
        mark_character_letter_read_to_path,
        memory_status_from_paths, normalize_openai_compatible_settings, parse_local_agent_stream_line,
        read_character_states_from_path, read_model_settings_from_path, read_stored_model_registry,
        read_tool_policy_settings_from_path,
        recent_memory_messages_from_path, save_character_states_to_path, save_model_settings_to_path,
        save_tool_policy_settings_to_path, set_active_model_profile_at_path,
        AddCharacterLetterRequest, AddCharacterMomentRequest, AppendChatMessageRequest,
        CreateChatSessionRequest,
        LocalAgentStreamMessage,
        ModelProfileSnapshot, ModelSettingsSnapshot, SaveModelSettingsRequest, StoredModelProfile,
    };

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
            "cockapoo-model-settings-{}.json",
            temp_path_nonce()
        ))
    }

    fn temp_chat_history_path() -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "cockapoo-chat-history-{}.sqlite3",
            temp_path_nonce()
        ))
    }

    fn temp_tool_policy_path() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("cockapoo-tool-policy-{}.json", temp_path_nonce()))
    }

    #[test]
    fn review_mode_round_trips_and_sanitizes() {
        let path = std::env::temp_dir().join(format!("cockapoo-review-mode-{}.json", temp_path_nonce()));

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
    fn read_workspace_dir_sorts_folders_first_and_reports_sizes() {
        let base = std::env::temp_dir().join(format!("cockapoo-ws-{}", temp_path_nonce()));
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
            PathBuf::from("/tmp/cockapoo-app-data/memory-tdai").as_path(),
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
            "/tmp/cockapoo-app-data/memory-tdai"
        );
        assert_eq!(
            value["tencentdb"]["rootDataDir"],
            "/tmp/cockapoo-app-data/memory-tdai"
        );
        assert_eq!(value["tencentdb"]["llm"]["baseUrl"], "https://pi.example/v1");
        assert_eq!(value["tencentdb"]["llm"]["model"], "pi-1");
        assert_eq!(value["tencentdb"]["llm"]["apiKey"], "tok-123");
    }

    #[test]
    fn memory_backend_config_omits_api_key_when_token_blank() {
        let value = build_memory_backend_config_payload(
            PathBuf::from("/tmp/cockapoo-app-data/memory-tdai").as_path(),
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
            PathBuf::from("/tmp/cockapoo-app-data/memory-tdai").as_path(),
            PathBuf::from("/tmp/cockapoo-local-agent").as_path(),
        );

        assert_eq!(status.configured_backend, "tencentdb");
        assert_eq!(status.fallback_backend, "chat-history");
        assert_eq!(status.memory_dir, "/tmp/cockapoo-app-data/memory-tdai");
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
            },
            "2024-02-01T01:00:00Z",
        )
        .expect("reply should save");
        assert_eq!(reply.sender, "character");
        assert_eq!(reply.reply_to.as_deref(), Some(user_letter.id.as_str()));

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
    fn local_agent_prompt_payload_includes_tool_policy_settings() {
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

        let payload = build_local_agent_prompt_payload(
            "/tmp/cockapoo-workspace".into(),
            &stored,
            "你好".to_string(),
            Some(serde_json::json!({ "sessionId": "session-1" })),
            tool_policy_settings.clone(),
        );

        assert_eq!(payload["cwd"], "/tmp/cockapoo-workspace");
        assert_eq!(payload["toolPolicySettings"], tool_policy_settings);
        assert_eq!(payload["runtimeToken"], "sk-test");
    }

    #[test]
    fn local_agent_prompt_command_suppresses_pnpm_script_output() {
        let args = local_agent_prompt_command_args(
            PathBuf::from("/tmp/cockapoo-local-agent").as_path(),
        );

        assert_eq!(args[0], "--silent");
        assert_eq!(args[1], "--dir");
        assert_eq!(args[2], "/tmp/cockapoo-local-agent");
        assert_eq!(args[3], "prompt");
    }

    #[test]
    fn local_agent_stream_lines_parse_progress_and_final_records() {
        let progress = parse_local_agent_stream_line(
            r#"{"type":"progress","event":{"runId":"run-1","phase":"thinking","delta":"先想一下"}}"#,
        )
        .expect("progress line should parse");

        match progress {
            LocalAgentStreamMessage::Progress(event) => {
                assert_eq!(event["runId"], "run-1");
                assert_eq!(event["phase"], "thinking");
                assert_eq!(event["delta"], "先想一下");
            }
            _ => panic!("expected progress record"),
        }

        let final_record = parse_local_agent_stream_line(
            r#"{"type":"final","response":{"providerId":"openai-compatible","modelRoute":"POST http://localhost:11434/v1/chat/completions · body.model = qwen","text":"你好"}}"#,
        )
        .expect("final line should parse");

        match final_record {
            LocalAgentStreamMessage::Final(response) => {
                assert_eq!(response.provider_id, "openai-compatible");
                assert_eq!(response.model_route, "POST http://localhost:11434/v1/chat/completions · body.model = qwen");
                assert_eq!(response.text, "你好");
            }
            _ => panic!("expected final record"),
        }
    }

    #[test]
    fn local_agent_stream_lines_parse_confirm_request_records() {
        let confirm = parse_local_agent_stream_line(
            r#"{"type":"confirm_request","confirmId":"run-1-confirm-1","runId":"run-1","tool":{"name":"edit","target":"src/app.ts","reason":"需要确认"}}"#,
        )
        .expect("confirm line should parse");

        match confirm {
            LocalAgentStreamMessage::ConfirmRequest(request) => {
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
    fn model_profile_keeps_local_agent_prompt_payload_single_active_shape() {
        let stored = StoredModelProfile {
            id: "glm".to_string(),
            name: "智谱 GLM".to_string(),
            base_url: "https://open.bigmodel.cn/api/coding/paas/v4".to_string(),
            model_name: "glm-5.1".to_string(),
            token: Some("sk-glm-123456".to_string()),
        };

        let payload = build_local_agent_prompt_payload(
            "/tmp/cockapoo-workspace".into(),
            &stored,
            "请只回复 OK".to_string(),
            None,
            serde_json::json!({}),
        );

        assert_eq!(payload["modelSettings"]["baseUrl"], stored.base_url);
        assert_eq!(payload["modelSettings"]["modelName"], stored.model_name);
        assert_eq!(payload["runtimeToken"], "sk-glm-123456");
        assert!(payload["modelSettings"].get("token").is_none());
        assert!(payload.get("profiles").is_none());
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
}
