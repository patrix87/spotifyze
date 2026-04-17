use crate::matcher::MatchCandidate;
use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct QueryCache {
    /// Map of normalized search query → cached Spotify candidates
    queries: HashMap<String, Vec<MatchCandidate>>,
}

fn cache_dir() -> Option<PathBuf> {
    ProjectDirs::from("com", "spotifyze", "Spotifyze")
        .map(|dirs| dirs.config_dir().join("cache"))
}

fn cache_path() -> Option<PathBuf> {
    cache_dir().map(|d| d.join("query_cache.json"))
}

fn load_cache_from(path: &std::path::Path) -> QueryCache {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|data| serde_json::from_str(&data).ok())
        .unwrap_or_else(|| QueryCache { queries: HashMap::new() })
}

fn load_cache() -> QueryCache {
    let Some(path) = cache_path() else {
        return QueryCache { queries: HashMap::new() };
    };
    load_cache_from(&path)
}

fn save_cache_to(path: &std::path::Path, cache: &QueryCache) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create cache dir: {e}"))?;
    }
    let data = serde_json::to_string(cache).map_err(|e| format!("Serialize error: {e}"))?;
    fs::write(path, data).map_err(|e| format!("Failed to write cache: {e}"))?;
    Ok(())
}

fn save_cache(cache: &QueryCache) -> Result<(), String> {
    let path = cache_path().ok_or("Could not determine cache directory")?;
    save_cache_to(&path, cache)
}

/// In-memory + disk query cache, shared across commands.
#[derive(Clone)]
pub struct QueryCacheState {
    inner: Arc<Mutex<QueryCache>>,
}

impl QueryCacheState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(load_cache())),
        }
    }

    /// Look up cached candidates for a query.
    pub fn get(&self, query: &str) -> Option<Vec<MatchCandidate>> {
        self.inner.lock().ok()?.queries.get(query).cloned()
    }

    /// Insert query results and persist to disk.
    pub fn insert(&self, query: String, candidates: Vec<MatchCandidate>) {
        if let Ok(mut cache) = self.inner.lock() {
            cache.queries.insert(query, candidates);
            let _ = save_cache(&cache);
        }
    }

    /// Clear all cached queries.
    pub fn clear(&self) {
        if let Ok(mut cache) = self.inner.lock() {
            cache.queries.clear();
        }
        if let Some(path) = cache_path() {
            if path.exists() {
                let _ = fs::remove_file(&path);
            }
        }
        // Also remove legacy folder-based cache if present
        if let Some(dir) = cache_dir() {
            let legacy = dir.join("match_cache.json");
            if legacy.exists() {
                let _ = fs::remove_file(&legacy);
            }
        }
    }
}

#[tauri::command]
pub fn clear_match_cache(
    cache: tauri::State<'_, QueryCacheState>,
) -> Result<(), String> {
    cache.clear();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::matcher::MatchCandidate;

    fn make_candidates(name: &str) -> Vec<MatchCandidate> {
        vec![MatchCandidate {
            spotify_uri: format!("spotify:track:{name}"),
            name: name.to_string(),
            artist: "Artist".to_string(),
            album: "Album".to_string(),
            album_type: Some("album".to_string()),
            release_year: Some("2020".to_string()),
            popularity: 80,
            score: 90,
            external_url: None,
            preview_url: None,
        }]
    }

    #[test]
    fn test_save_and_load_cache() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cache.json");

        let mut cache = QueryCache { queries: HashMap::new() };
        cache.queries.insert("artist:\"A\" track:\"S\"".to_string(), make_candidates("S"));

        save_cache_to(&path, &cache).unwrap();

        let loaded = load_cache_from(&path);
        let loaded_candidates = loaded.queries.get("artist:\"A\" track:\"S\"").unwrap();
        assert_eq!(loaded_candidates.len(), 1);
        assert_eq!(loaded_candidates[0].name, "S");
    }

    #[test]
    fn test_load_cache_nonexistent_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nonexistent.json");

        let cache = load_cache_from(&path);
        assert!(cache.queries.is_empty());
    }

    #[test]
    fn test_save_cache_creates_parent_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("deep").join("nested").join("cache.json");

        let cache = QueryCache { queries: HashMap::new() };
        save_cache_to(&path, &cache).unwrap();
        assert!(path.exists());
    }

    #[test]
    fn test_save_and_load_multiple_queries() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cache.json");

        let mut cache = QueryCache { queries: HashMap::new() };
        cache.queries.insert("query1".to_string(), make_candidates("S1"));
        cache.queries.insert("query2".to_string(), make_candidates("S2"));

        save_cache_to(&path, &cache).unwrap();

        let loaded = load_cache_from(&path);
        assert_eq!(loaded.queries.len(), 2);
        assert_eq!(loaded.queries["query1"].len(), 1);
        assert_eq!(loaded.queries["query2"].len(), 1);
    }

    #[test]
    fn test_load_cache_corrupt_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cache.json");
        fs::write(&path, "not valid json").unwrap();

        let cache = load_cache_from(&path);
        assert!(cache.queries.is_empty());
    }

    #[test]
    fn test_clear_cache_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cache.json");

        let cache = QueryCache { queries: HashMap::new() };
        save_cache_to(&path, &cache).unwrap();
        assert!(path.exists());

        fs::remove_file(&path).unwrap();
        assert!(!path.exists());
    }
}
