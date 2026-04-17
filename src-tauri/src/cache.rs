use crate::matcher::MatchResult;
use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MatchCache {
    /// Map of folder path → cached match results
    folders: HashMap<String, Vec<MatchResult>>,
}

fn cache_dir() -> Option<PathBuf> {
    ProjectDirs::from("com", "spotifyze", "Spotifyze")
        .map(|dirs| dirs.config_dir().join("cache"))
}

fn cache_path() -> Option<PathBuf> {
    cache_dir().map(|d| d.join("match_cache.json"))
}

fn load_cache() -> MatchCache {
    let Some(path) = cache_path() else {
        return MatchCache { folders: HashMap::new() };
    };
    fs::read_to_string(path)
        .ok()
        .and_then(|data| serde_json::from_str(&data).ok())
        .unwrap_or_else(|| MatchCache { folders: HashMap::new() })
}

fn save_cache(cache: &MatchCache) -> Result<(), String> {
    let path = cache_path().ok_or("Could not determine cache directory")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create cache dir: {e}"))?;
    }
    let data = serde_json::to_string(cache).map_err(|e| format!("Serialize error: {e}"))?;
    fs::write(&path, data).map_err(|e| format!("Failed to write cache: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn save_match_results(folder_path: String, results: Vec<MatchResult>) -> Result<(), String> {
    let mut cache = load_cache();
    cache.folders.insert(folder_path, results);
    save_cache(&cache)
}

#[tauri::command]
pub fn load_match_results(folder_path: String) -> Result<Option<Vec<MatchResult>>, String> {
    let cache = load_cache();
    Ok(cache.folders.get(&folder_path).cloned())
}

#[tauri::command]
pub fn clear_match_cache() -> Result<(), String> {
    if let Some(path) = cache_path()
        && path.exists()
    {
        fs::remove_file(&path).map_err(|e| format!("Failed to clear cache: {e}"))?;
    }
    Ok(())
}
