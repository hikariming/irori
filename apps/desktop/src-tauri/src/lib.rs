use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

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
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateOpeningMessageRequest {
    character_id: String,
    prompt: String,
    session_id: Option<String>,
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
async fn generate_opening_message(
    app: AppHandle,
    request: GenerateOpeningMessageRequest,
) -> Result<PiPromptResponse, String> {
    tauri::async_runtime::spawn_blocking(move || run_local_agent_opening_prompt(app, request))
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
fn append_chat_message(
    app: AppHandle,
    request: AppendChatMessageRequest,
) -> Result<ChatMessageRecord, String> {
    append_chat_message_to_path(&chat_history_path(&app)?, request, &current_timestamp())
        .map_err(|error| error.to_string())
}

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
    let tool_policy_settings =
        read_tool_policy_settings_from_path(&tool_policy_settings_path(&app)?)
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
    if request.is_some() {
        let memory_dir = memory_backend_dir(&app)?;
        fs::create_dir_all(&memory_dir).map_err(|error| format!("初始化记忆目录失败：{error}"))?;
        payload["memoryBackendConfig"] = build_memory_backend_config_payload(&memory_dir);
    }

    if let Some(run_id) = request.as_ref().and_then(|request| request.run_id.clone()) {
        payload["streamEvents"] = serde_json::Value::Bool(true);
        payload["runId"] = serde_json::Value::String(run_id);
        return execute_local_agent_prompt_streaming(app, agent_dir, payload);
    }

    execute_local_agent_prompt(agent_dir, payload)
}

fn run_local_agent_opening_prompt(
    app: AppHandle,
    request: GenerateOpeningMessageRequest,
) -> Result<PiPromptResponse, String> {
    let settings_path = settings_path(&app)?;
    let registry = read_stored_model_registry(&settings_path).map_err(|error| error.to_string())?;
    let stored = active_stored_model_profile(&registry)?;
    let token = stored
        .token
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "请先在模型接入里保存或填写 Token。".to_string())?;
    let agent_dir = local_agent_dir();
    let tool_policy_settings =
        read_tool_policy_settings_from_path(&tool_policy_settings_path(&app)?)
            .map_err(|error| error.to_string())?;
    let memory_dir = memory_backend_dir(&app)?;
    fs::create_dir_all(&memory_dir).map_err(|error| format!("初始化记忆目录失败：{error}"))?;
    let mut payload = build_local_agent_prompt_payload(
        std::env::current_dir()
            .map_err(|error| error.to_string())?
            .to_string_lossy()
            .to_string(),
        &StoredModelProfile {
            token: Some(token),
            ..stored
        },
        request.prompt.clone(),
        None,
        tool_policy_settings,
    );
    payload["memoryBackendConfig"] = build_memory_backend_config_payload(&memory_dir);
    payload["memoryRecallRequest"] = build_opening_memory_recall_payload(&request);

    execute_local_agent_prompt(agent_dir, payload)
}

fn execute_local_agent_prompt(
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

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "local-agent stdin 不可用。".to_string())?;
    stdin
        .write_all(payload.to_string().as_bytes())
        .map_err(|error| format!("写入 prompt 失败：{error}"))?;
    drop(stdin);

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "local-agent stdout 不可用。".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "local-agent stderr 不可用。".to_string())?;
    let stderr_reader = std::thread::spawn(move || {
        let mut text = String::new();
        let mut reader = BufReader::new(stderr);
        let _ = reader.read_to_string(&mut text);
        text
    });

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
            LocalAgentStreamMessage::Final(response) => {
                final_response = Some(response);
            }
        }
    }

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

fn build_opening_memory_recall_payload(
    request: &GenerateOpeningMessageRequest,
) -> serde_json::Value {
    let mut payload = serde_json::json!({
        "userId": "local-user",
        "characterId": request.character_id,
        "query": "开场白 自然 问候 用户偏好",
        "mode": "companion",
        "maxResults": 5
    });

    if let Some(session_id) = request.session_id.as_deref() {
        payload["sessionId"] = serde_json::Value::String(session_id.to_string());
    }

    payload
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

fn build_memory_backend_config_payload(memory_dir: &Path) -> serde_json::Value {
    serde_json::json!({
        "backend": "tencentdb",
        "tencentdb": {
            "dataDir": memory_dir.to_string_lossy()
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

        CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at
          ON chat_sessions(updated_at DESC);

        CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created_at
          ON chat_messages(session_id, created_at ASC);
        "#,
    )?;

    Ok(())
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
        .invoke_handler(tauri::generate_handler![
            append_chat_message,
            companion_status,
            create_chat_session,
            delete_model_profile,
            generate_opening_message,
            get_chat_session,
            get_memory_status,
            get_model_settings,
            get_tool_policy_settings,
            list_chat_sessions,
            save_model_settings,
            save_tool_policy_settings,
            set_active_model_profile,
            send_pi_prompt,
            test_model_connection
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
        build_memory_backend_config_payload, build_opening_memory_recall_payload,
        create_chat_session_at_path, delete_model_profile_at_path, get_chat_session_from_path,
        init_chat_history_at_path, list_chat_sessions_from_path, local_agent_prompt_command_args,
        memory_status_from_paths, normalize_openai_compatible_settings, parse_local_agent_stream_line,
        read_model_settings_from_path, read_stored_model_registry, read_tool_policy_settings_from_path,
        recent_memory_messages_from_path, save_model_settings_to_path,
        save_tool_policy_settings_to_path, set_active_model_profile_at_path,
        AppendChatMessageRequest, CreateChatSessionRequest, GenerateOpeningMessageRequest,
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
        );

        assert_eq!(value["backend"], "tencentdb");
        assert_eq!(
            value["tencentdb"]["dataDir"],
            "/tmp/cockapoo-app-data/memory-tdai"
        );
    }

    #[test]
    fn opening_memory_recall_payload_scopes_to_active_character_without_capture() {
        let value = build_opening_memory_recall_payload(&GenerateOpeningMessageRequest {
            character_id: "shili".to_string(),
            prompt: "请生成开场白。".to_string(),
            session_id: Some("session-1".to_string()),
        });

        assert_eq!(value["userId"], "local-user");
        assert_eq!(value["characterId"], "shili");
        assert_eq!(value["sessionId"], "session-1");
        assert_eq!(value["mode"], "companion");
        assert_eq!(value["maxResults"], 5);
        assert!(value.get("memoryCaptureTurn").is_none());
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
