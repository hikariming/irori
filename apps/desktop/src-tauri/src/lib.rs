use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveModelSettingsRequest {
    base_url: String,
    model_name: String,
    token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelSettingsSnapshot {
    base_url: String,
    has_token: bool,
    model_name: String,
    token_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredModelSettings {
    base_url: String,
    model_name: String,
    token: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendPiPromptRequest {
    character_id: String,
    mode: String,
    prompt: String,
    session_prompt: Option<String>,
    session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PiPromptResponse {
    model_route: String,
    provider_id: String,
    text: String,
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
    mode: Option<String>,
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
    mode: Option<String>,
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
const DEFAULT_MODEL_NAME: &str = "gpt-5.2";

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
fn send_pi_prompt(app: AppHandle, request: SendPiPromptRequest) -> Result<PiPromptResponse, String> {
    let prompt = request.session_prompt.clone().unwrap_or_else(|| {
        format!(
            "[character:{}][mode:{}]\n{}",
            request.character_id, request.mode, request.prompt
        )
    });

    run_local_agent_prompt(app, prompt, Some(request))
}

#[tauri::command]
fn test_model_connection(app: AppHandle) -> Result<PiPromptResponse, String> {
    run_local_agent_prompt(
        app,
        "请只回复两个字母：OK。不要解释，不要使用 Markdown。".to_string(),
        None,
    )
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
) -> Result<PiPromptResponse, String> {
    let settings_path = settings_path(&app)?;
    let stored = read_stored_model_settings(&settings_path).map_err(|error| error.to_string())?;
    let token = stored
        .token
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "请先在模型供应商里保存 Token。".to_string())?;
    let agent_dir = local_agent_dir();
    let chat_history_memory = build_chat_history_memory_payload(&app, request.as_ref())?;
    let mut payload = serde_json::json!({
        "cwd": std::env::current_dir().map_err(|error| error.to_string())?,
        "modelSettings": {
            "baseUrl": stored.base_url,
            "modelName": stored.model_name
        },
        "runtimeToken": token,
        "prompt": prompt
    });

    if let Some(memory) = chat_history_memory {
        payload["chatHistoryMemory"] = memory;
    }
    if request.is_some() {
        let memory_dir = memory_backend_dir(&app)?;
        fs::create_dir_all(&memory_dir).map_err(|error| format!("初始化记忆目录失败：{error}"))?;
        payload["memoryBackendConfig"] = build_memory_backend_config_payload(&memory_dir);
    }
    let mut child = Command::new("pnpm")
        .arg("--dir")
        .arg(agent_dir)
        .arg("prompt")
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

    let response: PiPromptResponse =
        serde_json::from_slice(&output.stdout).map_err(|error| format!("解析 local-agent 响应失败：{error}"))?;

    if response.text.trim().is_empty() {
        return Err("模型连接成功但没有返回文本，请检查模型是否支持聊天补全。".to_string());
    }

    Ok(response)
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
        "mode": request.mode,
        "maxResults": 5,
        "messages": messages
    })))
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

fn build_memory_backend_config_payload(memory_dir: &Path) -> serde_json::Value {
    serde_json::json!({
        "backend": "tencentdb",
        "tencentdb": {
            "dataDir": memory_dir.to_string_lossy()
        }
    })
}

fn local_agent_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("local-agent")
}

fn default_stored_model_settings() -> StoredModelSettings {
    StoredModelSettings {
        base_url: DEFAULT_BASE_URL.to_string(),
        model_name: DEFAULT_MODEL_NAME.to_string(),
        token: None,
    }
}

fn token_hint(token: &str) -> String {
    if token.len() < 8 {
        "已保存".to_string()
    } else {
        format!("••••{}", &token[token.len() - 4..])
    }
}

fn snapshot_from_stored(stored: &StoredModelSettings) -> ModelSettingsSnapshot {
    let token = stored.token.as_deref().filter(|value| !value.is_empty());

    ModelSettingsSnapshot {
        base_url: stored.base_url.clone(),
        has_token: token.is_some(),
        model_name: stored.model_name.clone(),
        token_hint: token.map(token_hint),
    }
}

fn read_stored_model_settings(path: &Path) -> Result<StoredModelSettings, Box<dyn std::error::Error>> {
    if !path.exists() {
        return Ok(default_stored_model_settings());
    }

    Ok(serde_json::from_str(&fs::read_to_string(path)?)?)
}

fn read_model_settings_from_path(
    path: &Path,
) -> Result<ModelSettingsSnapshot, Box<dyn std::error::Error>> {
    Ok(snapshot_from_stored(&read_stored_model_settings(path)?))
}

fn save_model_settings_to_path(
    path: &Path,
    request: SaveModelSettingsRequest,
) -> Result<ModelSettingsSnapshot, Box<dyn std::error::Error>> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let previous = read_stored_model_settings(path)?;
    let normalized = normalize_openai_compatible_settings(
        request.base_url.trim(),
        request.model_name.trim(),
    );
    let stored = StoredModelSettings {
        base_url: normalized.0,
        model_name: normalized.1,
        token: request.token.filter(|value| !value.trim().is_empty()).or(previous.token),
    };

    fs::write(path, serde_json::to_string_pretty(&stored)?)?;

    Ok(snapshot_from_stored(&stored))
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
            request.mode,
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

fn row_to_chat_session_summary(row: &rusqlite::Row<'_>) -> Result<ChatSessionSummary, rusqlite::Error> {
    Ok(ChatSessionSummary {
        id: row.get(0)?,
        character_id: row.get(1)?,
        title: row.get(2)?,
        updated_at: row.get(3)?,
        last_message_preview: row.get(4)?,
    })
}

fn row_to_chat_message_record(row: &rusqlite::Row<'_>) -> Result<ChatMessageRecord, rusqlite::Error> {
    Ok(ChatMessageRecord {
        id: row.get(0)?,
        session_id: row.get(1)?,
        speaker: row.get(2)?,
        author: row.get(3)?,
        text: row.get(4)?,
        mode: row.get(5)?,
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
            get_chat_session,
            get_model_settings,
            list_chat_sessions,
            save_model_settings,
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
        append_chat_message_to_path, create_chat_session_at_path, get_chat_session_from_path,
        init_chat_history_at_path, list_chat_sessions_from_path,
        build_memory_backend_config_payload, recent_memory_messages_from_path,
        AppendChatMessageRequest, CreateChatSessionRequest, normalize_openai_compatible_settings,
        read_model_settings_from_path, save_model_settings_to_path, ModelSettingsSnapshot,
        SaveModelSettingsRequest,
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
        std::env::temp_dir().join(format!("cockapoo-model-settings-{}.json", temp_path_nonce()))
    }

    fn temp_chat_history_path() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("cockapoo-chat-history-{}.sqlite3", temp_path_nonce()))
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
                mode: Some("agent".to_string()),
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
                mode: None,
                sticker_id: Some("focused".to_string()),
                model_route: Some("https://api.openai.com/v1/gpt-5.2".to_string()),
                provider_id: Some("openai-compatible".to_string()),
            },
            "2026-05-18T10:02:00.000+08:00",
        )
        .expect("assistant message should be stored");

        let detail = get_chat_session_from_path(&path, &session.id).expect("session should load");
        let sessions = list_chat_sessions_from_path(&path).expect("sessions should load");

        assert_eq!(detail.messages.len(), 2);
        assert_eq!(detail.messages[0].speaker, "user");
        assert_eq!(detail.messages[0].mode.as_deref(), Some("agent"));
        assert_eq!(detail.messages[1].speaker, "character");
        assert_eq!(detail.messages[1].sticker_id.as_deref(), Some("focused"));
        assert_eq!(sessions[0].last_message_preview, "好，我先把 SQLite 这层铺好。");
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
                    mode: None,
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
    fn save_model_settings_redacts_token_and_tracks_endpoint() {
        let path = temp_settings_path();
        let snapshot = save_model_settings_to_path(
            &path,
            SaveModelSettingsRequest {
                base_url: "http://localhost:11434/v1".to_string(),
                model_name: "qwen3-coder".to_string(),
                token: Some("sk-test-123456".to_string()),
            },
        )
        .expect("settings should save");

        assert_eq!(snapshot.base_url, "http://localhost:11434/v1");
        assert_eq!(snapshot.model_name, "qwen3-coder");
        assert!(snapshot.has_token);
        assert_eq!(snapshot.token_hint.as_deref(), Some("••••3456"));

        let raw = fs::read_to_string(&path).expect("settings file should exist");
        assert!(raw.contains("sk-test-123456"));
    }

    #[test]
    fn read_model_settings_uses_defaults_when_file_is_missing() {
        let path = temp_settings_path();
        let snapshot = read_model_settings_from_path(&path).expect("default settings should load");

        assert_eq!(snapshot.base_url, "https://api.openai.com/v1");
        assert_eq!(snapshot.model_name, "gpt-5.2");
        assert!(!snapshot.has_token);
    }

    #[test]
    fn model_settings_snapshot_serializes_for_frontend() {
        let snapshot = ModelSettingsSnapshot {
            base_url: "http://localhost:11434/v1".to_string(),
            has_token: true,
            model_name: "qwen3-coder".to_string(),
            token_hint: Some("••••3456".to_string()),
        };

        let value = serde_json::to_value(snapshot).expect("snapshot should serialize");
        assert_eq!(value["baseUrl"], "http://localhost:11434/v1");
        assert_eq!(value["modelName"], "qwen3-coder");
        assert_eq!(value["hasToken"], true);
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
