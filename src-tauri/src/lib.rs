mod auth;
mod cache;
mod matcher;
mod playlist;
mod scanner;

use auth::AuthState;
use cache::QueryCacheState;
use matcher::MatchCancellation;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Convert an open.spotify.com URL to a spotify: URI and open via OS protocol handler.
#[tauri::command]
fn open_spotify_uri(url: String) -> Result<(), String> {
    // https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6 → spotify:track:6rqhFgbbKwnb9MLmUQDhG6
    let uri = url
        .replace("https://open.spotify.com/", "spotify:")
        .replace('/', ":");
    open::that(&uri).map_err(|e| format!("Failed to open Spotify: {e}"))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(Arc::new(Mutex::new(AuthState::new())))
        .manage(Arc::new(MatchCancellation::new()))
        .manage(QueryCacheState::new())
        .invoke_handler(tauri::generate_handler![
            auth::set_client_id,
            auth::get_client_id,
            auth::login,
            auth::logout,
            auth::check_auth,
            scanner::scan_folders,
            scanner::scan_playlists,
            scanner::read_audio_file,
            matcher::match_tracks,
            matcher::cancel_matching,
            matcher::search_manual,
            playlist::create_playlist,
            cache::clear_match_cache,
            open_spotify_uri,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
