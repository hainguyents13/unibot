mod desktop;
mod loopback;
mod recent_gateways;
mod token_store;

use std::path::PathBuf;
use std::time::Duration;

use loopback::Loopback;
use tauri::Manager;

/// Whether a debug build was started with `UNIBOT_DEMO=1`. Release builds never show the demo.
fn demo_requested(debug_build: bool, flag: Option<&str>) -> bool {
    debug_build && flag == Some("1")
}

#[tauri::command]
fn demo_mode() -> bool {
    demo_requested(
        cfg!(debug_assertions),
        std::env::var("UNIBOT_DEMO").ok().as_deref(),
    )
}

/// Starts the sign-in redirect listener and returns its port.
#[tauri::command]
async fn loopback_start(loopback: tauri::State<'_, Loopback>) -> Result<u16, String> {
    loopback.start().await
}

/// Waits for the sign-in redirect and returns its query string.
#[tauri::command]
async fn loopback_wait(
    loopback: tauri::State<'_, Loopback>,
    timeout_seconds: u64,
) -> Result<String, String> {
    loopback.wait(Duration::from_secs(timeout_seconds)).await
}

#[tauri::command]
fn loopback_cancel(loopback: tauri::State<'_, Loopback>) {
    loopback.cancel();
}

#[tauri::command]
fn token_load(gateway: String) -> Result<Option<String>, String> {
    token_store::load(&gateway)
}

#[tauri::command]
fn token_save(gateway: String, secret: String) -> Result<(), String> {
    token_store::save(&gateway, &secret)
}

#[tauri::command]
fn token_delete(gateway: String) -> Result<(), String> {
    token_store::delete(&gateway)
}

fn recent_gateways_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("recent-gateways.json"))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn gateways_load(app: tauri::AppHandle) -> Vec<String> {
    recent_gateways_path(&app)
        .map(|path| recent_gateways::load(&path))
        .unwrap_or_default()
}

#[tauri::command]
fn gateways_save(app: tauri::AppHandle, gateways: Vec<String>) -> Result<(), String> {
    recent_gateways::save(&recent_gateways_path(&app)?, &gateways)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // First, so a second launch hands over to the running app before anything else starts.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            desktop::show_main(app)
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_websocket::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Loopback::default())
        .setup(|app| {
            desktop::setup_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(desktop::on_window_event)
        .invoke_handler(tauri::generate_handler![
            demo_mode,
            loopback_start,
            loopback_wait,
            loopback_cancel,
            token_load,
            token_save,
            token_delete,
            gateways_load,
            gateways_save,
            desktop::set_attention,
            desktop::notify
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::demo_requested;

    #[test]
    fn demo_only_in_debug_builds_with_the_flag() {
        assert!(demo_requested(true, Some("1")));
        assert!(!demo_requested(false, Some("1")));
        assert!(!demo_requested(true, None));
        assert!(!demo_requested(true, Some("true")));
    }
}
