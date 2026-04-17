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

async fn create_spotify_playlist(
    api_base: &str,
    access_token: &str,
    name: &str,
) -> Result<CreatePlaylistResponse, String> {
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "name": name,
        "description": "Created with Spotifyze"
    });

    let resp = client
        .post(format!("{api_base}/v1/me/playlists"))
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
    api_base: &str,
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
                "{api_base}/v1/playlists/{playlist_id}/tracks"
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
    state: tauri::State<'_, Arc<Mutex<AuthState>>>,
) -> Result<PlaylistResult, String> {
    if uris.is_empty() {
        return Err("Cannot create an empty playlist".to_string());
    }

    let access_token = get_valid_token(&state.inner().clone()).await?;
    let playlist = create_spotify_playlist("https://api.spotify.com", &access_token, &name).await?;
    add_tracks_to_playlist("https://api.spotify.com", &access_token, &playlist.id, &uris).await?;

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

    // === Async API tests using mockito ===

    #[tokio::test]
    async fn test_create_spotify_playlist_success() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("POST", "/v1/me/playlists")
            .with_status(201)
            .with_header("content-type", "application/json")
            .with_body(r#"{"id":"pl123","external_urls":{"spotify":"https://open.spotify.com/playlist/pl123"}}"#)
            .create_async()
            .await;

        let result = create_spotify_playlist(&server.url(), "fake_token", "My Playlist").await;
        mock.assert_async().await;
        let playlist = result.unwrap();
        assert_eq!(playlist.id, "pl123");
        assert_eq!(playlist.external_urls.spotify, "https://open.spotify.com/playlist/pl123");
    }

    #[tokio::test]
    async fn test_create_spotify_playlist_failure() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("POST", "/v1/me/playlists")
            .with_status(403)
            .with_body("Forbidden")
            .create_async()
            .await;

        let result = create_spotify_playlist(&server.url(), "fake_token", "My Playlist").await;
        mock.assert_async().await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Forbidden"));
    }

    #[tokio::test]
    async fn test_add_tracks_to_playlist_success() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("POST", "/v1/playlists/pl123/tracks")
            .with_status(201)
            .with_header("content-type", "application/json")
            .with_body(r#"{"snapshot_id":"snap1"}"#)
            .create_async()
            .await;

        let uris = vec![
            "spotify:track:a".to_string(),
            "spotify:track:b".to_string(),
        ];
        let result = add_tracks_to_playlist(&server.url(), "fake_token", "pl123", &uris).await;
        mock.assert_async().await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_add_tracks_to_playlist_failure() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("POST", "/v1/playlists/pl123/tracks")
            .with_status(500)
            .with_body("Server Error")
            .create_async()
            .await;

        let uris = vec!["spotify:track:a".to_string()];
        let result = add_tracks_to_playlist(&server.url(), "fake_token", "pl123", &uris).await;
        mock.assert_async().await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Server Error"));
    }

    #[tokio::test]
    async fn test_add_tracks_chunked() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("POST", "/v1/playlists/pl123/tracks")
            .with_status(201)
            .with_header("content-type", "application/json")
            .with_body(r#"{"snapshot_id":"snap"}"#)
            .expect(2)
            .create_async()
            .await;

        // 150 tracks → should make 2 requests (100 + 50)
        let uris: Vec<String> = (0..150).map(|i| format!("spotify:track:{i}")).collect();
        let result = add_tracks_to_playlist(&server.url(), "fake_token", "pl123", &uris).await;
        mock.assert_async().await;
        assert!(result.is_ok());
    }
}
