mod auth;
mod matcher;
mod playlist;
mod scanner;

use auth::AuthState;
use std::sync::Arc;
use tokio::sync::Mutex;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(Arc::new(Mutex::new(AuthState::new())))
        .invoke_handler(tauri::generate_handler![
            auth::set_client_id,
            auth::get_client_id,
            auth::login,
            auth::logout,
            auth::check_auth,
            scanner::scan_folders,
            matcher::match_tracks,
            playlist::create_playlist,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
