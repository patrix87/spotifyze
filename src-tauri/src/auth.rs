use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use directories::ProjectDirs;
use rand::RngExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;
use url::Url;

const REDIRECT_URI: &str = "http://localhost:8888/callback";
const AUTH_URL: &str = "https://accounts.spotify.com/authorize";
const TOKEN_URL: &str = "https://accounts.spotify.com/api/token";
const SCOPES: &str = "playlist-modify-public playlist-modify-private";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpotifyToken {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfile {
    pub display_name: Option<String>,
    pub id: String,
    pub images: Vec<SpotifyImage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpotifyImage {
    pub url: String,
    pub height: Option<u32>,
    pub width: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub client_id: String,
}

pub struct AuthState {
    pub token: Option<SpotifyToken>,
    pub client_id: Option<String>,
}

impl AuthState {
    pub fn new() -> Self {
        let config = load_config();
        Self {
            token: load_token(),
            client_id: config.map(|c| c.client_id),
        }
    }
}

fn config_dir() -> Option<PathBuf> {
    ProjectDirs::from("com", "folder-to-spotify", "Folder to Spotify Playlist")
        .map(|dirs| dirs.config_dir().to_path_buf())
}

fn token_path() -> Option<PathBuf> {
    config_dir().map(|d| d.join("token.json"))
}

fn config_path() -> Option<PathBuf> {
    config_dir().map(|d| d.join("config.json"))
}

fn load_token() -> Option<SpotifyToken> {
    let path = token_path()?;
    let data = fs::read_to_string(path).ok()?;
    serde_json::from_str(&data).ok()
}

fn save_token(token: &SpotifyToken) -> Result<(), String> {
    let path = token_path().ok_or("Could not determine config directory")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create config dir: {e}"))?;
    }
    let data = serde_json::to_string_pretty(token).map_err(|e| format!("Serialize error: {e}"))?;
    fs::write(&path, data).map_err(|e| format!("Failed to write token: {e}"))?;
    Ok(())
}

fn load_config() -> Option<AppConfig> {
    let path = config_path()?;
    let data = fs::read_to_string(path).ok()?;
    serde_json::from_str(&data).ok()
}

fn save_config(config: &AppConfig) -> Result<(), String> {
    let path = config_path().ok_or("Could not determine config directory")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create config dir: {e}"))?;
    }
    let data =
        serde_json::to_string_pretty(config).map_err(|e| format!("Serialize error: {e}"))?;
    fs::write(&path, data).map_err(|e| format!("Failed to write config: {e}"))?;
    Ok(())
}

fn generate_pkce_verifier() -> String {
    let mut rng = rand::rng();
    let bytes: Vec<u8> = (0..64).map(|_| rng.random::<u8>()).collect();
    URL_SAFE_NO_PAD.encode(bytes)
}

fn generate_pkce_challenge(verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let hash = hasher.finalize();
    URL_SAFE_NO_PAD.encode(hash)
}

pub fn build_auth_url(client_id: &str, verifier: &str) -> String {
    let challenge = generate_pkce_challenge(verifier);
    let mut url = Url::parse(AUTH_URL).unwrap();
    url.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("response_type", "code")
        .append_pair("redirect_uri", REDIRECT_URI)
        .append_pair("scope", SCOPES)
        .append_pair("code_challenge_method", "S256")
        .append_pair("code_challenge", &challenge);
    url.to_string()
}

fn wait_for_callback() -> Result<String, String> {
    let server =
        tiny_http::Server::http("127.0.0.1:8888").map_err(|e| format!("Server error: {e}"))?;

    let request = server
        .recv()
        .map_err(|e| format!("Failed to receive request: {e}"))?;

    let url_str = format!("http://localhost{}", request.url());
    let url = Url::parse(&url_str).map_err(|e| format!("Invalid callback URL: {e}"))?;

    let code = url
        .query_pairs()
        .find(|(key, _)| key == "code")
        .map(|(_, value)| value.to_string())
        .ok_or_else(|| {
            let error = url
                .query_pairs()
                .find(|(key, _)| key == "error")
                .map(|(_, value)| value.to_string())
                .unwrap_or_else(|| "unknown".to_string());
            format!("Authorization failed: {error}")
        })?;

    let response = tiny_http::Response::from_string(
        "<html><body><h1>Success!</h1><p>You can close this window and return to the app.</p></body></html>"
    )
    .with_header("Content-Type: text/html".parse::<tiny_http::Header>().unwrap());
    let _ = request.respond(response);

    Ok(code)
}

async fn exchange_code(
    client_id: &str,
    code: &str,
    verifier: &str,
) -> Result<SpotifyToken, String> {
    let client = reqwest::Client::new();
    let params = [
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", REDIRECT_URI),
        ("client_id", client_id),
        ("code_verifier", verifier),
    ];

    let resp = client
        .post(TOKEN_URL)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Token request failed: {e}"))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Token exchange failed: {body}"));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse token response: {e}"))?;

    let expires_in = body["expires_in"].as_u64().unwrap_or(3600);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    Ok(SpotifyToken {
        access_token: body["access_token"]
            .as_str()
            .ok_or("Missing access_token")?
            .to_string(),
        refresh_token: body["refresh_token"].as_str().map(|s| s.to_string()),
        expires_at: now + expires_in,
    })
}

pub async fn refresh_token(client_id: &str, refresh: &str) -> Result<SpotifyToken, String> {
    let client = reqwest::Client::new();
    let params = [
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh),
        ("client_id", client_id),
    ];

    let resp = client
        .post(TOKEN_URL)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Refresh request failed: {e}"))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Token refresh failed: {body}"));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse refresh response: {e}"))?;

    let expires_in = body["expires_in"].as_u64().unwrap_or(3600);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    Ok(SpotifyToken {
        access_token: body["access_token"]
            .as_str()
            .ok_or("Missing access_token")?
            .to_string(),
        refresh_token: body["refresh_token"]
            .as_str()
            .map(|s| s.to_string())
            .or_else(|| Some(refresh.to_string())),
        expires_at: now + expires_in,
    })
}

pub async fn get_valid_token(state: &Arc<Mutex<AuthState>>) -> Result<String, String> {
    let mut guard = state.lock().await;
    let client_id = guard
        .client_id
        .clone()
        .ok_or("No client ID configured")?;

    if let Some(ref token) = guard.token {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        if now < token.expires_at.saturating_sub(60) {
            return Ok(token.access_token.clone());
        }

        if let Some(ref refresh) = token.refresh_token {
            let new_token = refresh_token(&client_id, refresh).await?;
            save_token(&new_token)?;
            let access = new_token.access_token.clone();
            guard.token = Some(new_token);
            return Ok(access);
        }
    }

    Err("Not authenticated. Please log in first.".to_string())
}

// --- Tauri Commands ---

#[tauri::command]
pub async fn set_client_id(
    client_id: String,
    state: tauri::State<'_, Arc<Mutex<AuthState>>>,
) -> Result<(), String> {
    if client_id.trim().is_empty() {
        return Err("Client ID cannot be empty".to_string());
    }
    let config = AppConfig {
        client_id: client_id.trim().to_string(),
    };
    save_config(&config)?;
    let mut guard = state.lock().await;
    guard.client_id = Some(config.client_id);
    Ok(())
}

#[tauri::command]
pub async fn get_client_id(
    state: tauri::State<'_, Arc<Mutex<AuthState>>>,
) -> Result<Option<String>, String> {
    let guard = state.lock().await;
    Ok(guard.client_id.clone())
}

#[tauri::command]
pub async fn login(state: tauri::State<'_, Arc<Mutex<AuthState>>>) -> Result<UserProfile, String> {
    let client_id = {
        let guard = state.lock().await;
        guard
            .client_id
            .clone()
            .ok_or("No client ID configured. Please set it first.")?
    };

    let verifier = generate_pkce_verifier();
    let auth_url = build_auth_url(&client_id, &verifier);

    open::that(&auth_url).map_err(|e| format!("Failed to open browser: {e}"))?;

    let code = tokio::task::spawn_blocking(wait_for_callback)
        .await
        .map_err(|e| format!("Task error: {e}"))??;

    let token = exchange_code(&client_id, &code, &verifier).await?;
    save_token(&token)?;

    let profile = fetch_profile(&token.access_token).await?;

    {
        let mut guard = state.lock().await;
        guard.token = Some(token);
    }

    Ok(profile)
}

#[tauri::command]
pub async fn logout(state: tauri::State<'_, Arc<Mutex<AuthState>>>) -> Result<(), String> {
    let mut guard = state.lock().await;
    guard.token = None;
    if let Some(path) = token_path() {
        let _ = fs::remove_file(path);
    }
    Ok(())
}

#[tauri::command]
pub async fn check_auth(
    state: tauri::State<'_, Arc<Mutex<AuthState>>>,
) -> Result<Option<UserProfile>, String> {
    let access_token = match get_valid_token(&state.inner().clone()).await {
        Ok(t) => t,
        Err(_) => return Ok(None),
    };
    match fetch_profile(&access_token).await {
        Ok(profile) => Ok(Some(profile)),
        Err(_) => Ok(None),
    }
}

pub async fn fetch_profile(access_token: &str) -> Result<UserProfile, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.spotify.com/v1/me")
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("Profile request failed: {e}"))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Profile fetch failed: {body}"));
    }

    resp.json::<UserProfile>()
        .await
        .map_err(|e| format!("Failed to parse profile: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pkce_verifier_length() {
        let verifier = generate_pkce_verifier();
        // Base64 of 64 bytes = 86 chars (URL_SAFE_NO_PAD)
        assert!(verifier.len() >= 43, "Verifier must be at least 43 chars");
        assert!(verifier.len() <= 128, "Verifier must be at most 128 chars");
    }

    #[test]
    fn test_pkce_verifier_charset() {
        let verifier = generate_pkce_verifier();
        for ch in verifier.chars() {
            assert!(
                ch.is_ascii_alphanumeric() || ch == '-' || ch == '_',
                "Invalid character in verifier: {ch}"
            );
        }
    }

    #[test]
    fn test_pkce_challenge_is_deterministic() {
        let verifier = "test_verifier_12345";
        let c1 = generate_pkce_challenge(verifier);
        let c2 = generate_pkce_challenge(verifier);
        assert_eq!(c1, c2);
    }

    #[test]
    fn test_pkce_challenge_differs_for_different_verifiers() {
        let c1 = generate_pkce_challenge("verifier_a");
        let c2 = generate_pkce_challenge("verifier_b");
        assert_ne!(c1, c2);
    }

    #[test]
    fn test_auth_url_contains_required_params() {
        let verifier = "test_verifier";
        let url_str = build_auth_url("test_client_id", verifier);
        let url = Url::parse(&url_str).unwrap();

        let params: std::collections::HashMap<_, _> = url.query_pairs().collect();
        assert_eq!(params.get("client_id").unwrap(), "test_client_id");
        assert_eq!(params.get("response_type").unwrap(), "code");
        assert_eq!(params.get("redirect_uri").unwrap(), REDIRECT_URI);
        assert_eq!(params.get("scope").unwrap(), SCOPES);
        assert_eq!(params.get("code_challenge_method").unwrap(), "S256");
        assert!(params.contains_key("code_challenge"));
    }

    #[test]
    fn test_auth_url_challenge_matches_verifier() {
        let verifier = "my_test_verifier_value";
        let url_str = build_auth_url("cid", verifier);
        let url = Url::parse(&url_str).unwrap();
        let params: std::collections::HashMap<_, _> = url.query_pairs().collect();
        let expected = generate_pkce_challenge(verifier);
        assert_eq!(params.get("code_challenge").unwrap().as_ref(), expected);
    }
}
