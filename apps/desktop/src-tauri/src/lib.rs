#[tauri::command]
fn companion_status() -> &'static str {
    "Cockapoo Pi Companion desktop shell is ready."
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![companion_status])
        .run(tauri::generate_context!())
        .expect("failed to run Cockapoo Pi Companion");
}
