use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PiPromptResponse {
    model_route: String,
    provider_id: String,
    text: String,
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

    run_local_agent_prompt(app, prompt)
}

#[tauri::command]
fn test_model_connection(app: AppHandle) -> Result<PiPromptResponse, String> {
    run_local_agent_prompt(
        app,
        "请只回复两个字母：OK。不要解释，不要使用 Markdown。".to_string(),
    )
}

fn run_local_agent_prompt(app: AppHandle, prompt: String) -> Result<PiPromptResponse, String> {
    let settings_path = settings_path(&app)?;
    let stored = read_stored_model_settings(&settings_path).map_err(|error| error.to_string())?;
    let token = stored
        .token
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "请先在模型供应商里保存 Token。".to_string())?;
    let agent_dir = local_agent_dir();
    let payload = serde_json::json!({
        "cwd": std::env::current_dir().map_err(|error| error.to_string())?,
        "modelSettings": {
            "baseUrl": stored.base_url,
            "modelName": stored.model_name
        },
        "runtimeToken": token,
        "prompt": prompt
    });
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

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("model-settings.json"))
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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            companion_status,
            get_model_settings,
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
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{
        normalize_openai_compatible_settings, read_model_settings_from_path,
        save_model_settings_to_path, ModelSettingsSnapshot, SaveModelSettingsRequest,
    };

    fn temp_settings_path() -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after epoch")
            .as_nanos();

        std::env::temp_dir().join(format!("cockapoo-model-settings-{nonce}.json"))
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
