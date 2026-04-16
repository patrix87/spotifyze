use crate::auth::{get_valid_token, AuthState};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaylistResult {
    pub playlist_id: String,
    pub playlist_url: String,
    pub tracks_added: usize,
}

#[derive(Debug, Deserialize)]
struct CreatePlaylistResponse {
    id: String,
    external_urls: PlaylistExternalUrls,
}

#[derive(Debug, Deserialize)]
struct PlaylistExternalUrls {
    spotify: String,
}

async fn get_user_id(access_token: &str) -> Result<String, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.spotify.com/v1/me")
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch user: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Failed to get user: {}", resp.status()));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {e}"))?;

    body["id"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Missing user id".to_string())
}

async fn create_spotify_playlist(
    access_token: &str,
    user_id: &str,
    name: &str,
    public: bool,
) -> Result<CreatePlaylistResponse, String> {
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "name": name,
        "public": public,
        "description": "Created with Folder to Spotify Playlist"
    });

    let resp = client
        .post(format!(
            "https://api.spotify.com/v1/users/{user_id}/playlists"
        ))
        .bearer_auth(access_token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to create playlist: {e}"))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Create playlist failed: {body}"));
    }

    resp.json::<CreatePlaylistResponse>()
        .await
        .map_err(|e| format!("Parse error: {e}"))
}

async fn add_tracks_to_playlist(
    access_token: &str,
    playlist_id: &str,
    uris: &[String],
) -> Result<(), String> {
    let client = reqwest::Client::new();

    // Spotify allows max 100 tracks per request
    for chunk in uris.chunks(100) {
        let body = serde_json::json!({ "uris": chunk });

        let resp = client
            .post(format!(
                "https://api.spotify.com/v1/playlists/{playlist_id}/tracks"
            ))
            .bearer_auth(access_token)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Failed to add tracks: {e}"))?;

        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Add tracks failed: {body}"));
        }
    }

    Ok(())
}

#[cfg(test)]
pub fn batch_uris(uris: &[String], batch_size: usize) -> Vec<Vec<String>> {
    uris.chunks(batch_size)
        .map(|chunk| chunk.to_vec())
        .collect()
}

#[tauri::command]
pub async fn create_playlist(
    name: String,
    uris: Vec<String>,
    public: bool,
    state: tauri::State<'_, Arc<Mutex<AuthState>>>,
) -> Result<PlaylistResult, String> {
    if uris.is_empty() {
        return Err("Cannot create an empty playlist".to_string());
    }

    let access_token = get_valid_token(&state.inner().clone()).await?;
    let user_id = get_user_id(&access_token).await?;
    let playlist = create_spotify_playlist(&access_token, &user_id, &name, public).await?;
    add_tracks_to_playlist(&access_token, &playlist.id, &uris).await?;

    Ok(PlaylistResult {
        playlist_id: playlist.id,
        playlist_url: playlist.external_urls.spotify,
        tracks_added: uris.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_batch_uris_exact_multiple() {
        let uris: Vec<String> = (0..200).map(|i| format!("spotify:track:{i}")).collect();
        let batches = batch_uris(&uris, 100);
        assert_eq!(batches.len(), 2);
        assert_eq!(batches[0].len(), 100);
        assert_eq!(batches[1].len(), 100);
    }

    #[test]
    fn test_batch_uris_remainder() {
        let uris: Vec<String> = (0..250).map(|i| format!("spotify:track:{i}")).collect();
        let batches = batch_uris(&uris, 100);
        assert_eq!(batches.len(), 3);
        assert_eq!(batches[0].len(), 100);
        assert_eq!(batches[1].len(), 100);
        assert_eq!(batches[2].len(), 50);
    }

    #[test]
    fn test_batch_uris_small() {
        let uris: Vec<String> = (0..5).map(|i| format!("spotify:track:{i}")).collect();
        let batches = batch_uris(&uris, 100);
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].len(), 5);
    }

    #[test]
    fn test_batch_uris_empty() {
        let uris: Vec<String> = vec![];
        let batches = batch_uris(&uris, 100);
        assert!(batches.is_empty());
    }
}
