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

fn load_cache_from(path: &std::path::Path) -> MatchCache {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|data| serde_json::from_str(&data).ok())
        .unwrap_or_else(|| MatchCache { folders: HashMap::new() })
}

fn load_cache() -> MatchCache {
    let Some(path) = cache_path() else {
        return MatchCache { folders: HashMap::new() };
    };
    load_cache_from(&path)
}

fn save_cache_to(path: &std::path::Path, cache: &MatchCache) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create cache dir: {e}"))?;
    }
    let data = serde_json::to_string(cache).map_err(|e| format!("Serialize error: {e}"))?;
    fs::write(path, data).map_err(|e| format!("Failed to write cache: {e}"))?;
    Ok(())
}

fn save_cache(cache: &MatchCache) -> Result<(), String> {
    let path = cache_path().ok_or("Could not determine cache directory")?;
    save_cache_to(&path, cache)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::matcher::{MatchCandidate, MatchStatus};
    use crate::scanner::TrackInfo;

    fn make_result(artist: &str, title: &str) -> MatchResult {
        MatchResult {
            track: TrackInfo {
                path: format!("/music/{artist}/{title}.mp3"),
                file_name: format!("{title}.mp3"),
                artist: artist.to_string(),
                title: title.to_string(),
                album: None,
                album_artist: None,
                track_number: None,
                year: None,
            },
            status: MatchStatus::AutoMatched,
            candidates: vec![MatchCandidate {
                spotify_uri: format!("spotify:track:{title}"),
                name: title.to_string(),
                artist: artist.to_string(),
                album: "Album".to_string(),
                album_type: Some("album".to_string()),
                release_year: Some("2020".to_string()),
                popularity: 80,
                score: 90,
                external_url: None,
                preview_url: None,
            }],
            selected_uri: Some(format!("spotify:track:{title}")),
        }
    }

    #[test]
    fn test_save_and_load_cache() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cache.json");

        let results = vec![make_result("Artist", "Song")];
        let mut cache = MatchCache { folders: HashMap::new() };
        cache.folders.insert("/music/folder".to_string(), results.clone());

        save_cache_to(&path, &cache).unwrap();

        let loaded = load_cache_from(&path);
        let loaded_results = loaded.folders.get("/music/folder").unwrap();
        assert_eq!(loaded_results.len(), 1);
        assert_eq!(loaded_results[0].track.title, "Song");
        assert_eq!(loaded_results[0].track.artist, "Artist");
    }

    #[test]
    fn test_load_cache_nonexistent_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nonexistent.json");

        let cache = load_cache_from(&path);
        assert!(cache.folders.is_empty());
    }

    #[test]
    fn test_save_cache_creates_parent_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("deep").join("nested").join("cache.json");

        let cache = MatchCache { folders: HashMap::new() };
        save_cache_to(&path, &cache).unwrap();
        assert!(path.exists());
    }

    #[test]
    fn test_save_and_load_multiple_folders() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cache.json");

        let mut cache = MatchCache { folders: HashMap::new() };
        cache.folders.insert("/folder1".to_string(), vec![make_result("A1", "S1")]);
        cache.folders.insert("/folder2".to_string(), vec![
            make_result("A2", "S2"),
            make_result("A3", "S3"),
        ]);

        save_cache_to(&path, &cache).unwrap();

        let loaded = load_cache_from(&path);
        assert_eq!(loaded.folders.len(), 2);
        assert_eq!(loaded.folders["/folder1"].len(), 1);
        assert_eq!(loaded.folders["/folder2"].len(), 2);
    }

    #[test]
    fn test_load_cache_corrupt_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cache.json");
        fs::write(&path, "not valid json").unwrap();

        let cache = load_cache_from(&path);
        assert!(cache.folders.is_empty());
    }

    #[test]
    fn test_clear_cache_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cache.json");

        let cache = MatchCache { folders: HashMap::new() };
        save_cache_to(&path, &cache).unwrap();
        assert!(path.exists());

        fs::remove_file(&path).unwrap();
        assert!(!path.exists());
    }
}
