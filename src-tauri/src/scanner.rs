use lofty::file::TaggedFileExt;
use lofty::tag::Accessor;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

const SUPPORTED_EXTENSIONS: &[&str] = &["mp3", "flac", "m4a", "ogg", "wav"];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackInfo {
    pub path: String,
    pub file_name: String,
    pub artist: String,
    pub title: String,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_number: Option<u32>,
    pub year: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkippedFile {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    pub tracks: Vec<TrackInfo>,
    pub skipped: Vec<SkippedFile>,
}

fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| SUPPORTED_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

fn extract_metadata(path: &Path) -> Result<TrackInfo, String> {
    let tagged_file =
        lofty::read_from_path(path).map_err(|e| format!("Failed to read file: {e}"))?;

    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag())
        .ok_or_else(|| "No metadata tags found".to_string())?;

    let artist = tag
        .artist()
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Missing artist tag".to_string())?;

    let title = tag
        .title()
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Missing title tag".to_string())?;

    let album = tag
        .album()
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty());

    let album_artist = tag
        .get_string(&lofty::tag::ItemKey::AlbumArtist)
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty());

    let track_number = tag.track();
    let year = tag.year();

    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    Ok(TrackInfo {
        path: path.to_string_lossy().to_string(),
        file_name,
        artist,
        title,
        album,
        album_artist,
        track_number,
        year,
    })
}

pub fn scan_folder(folder: &str, recursive: bool) -> ScanResult {
    let folder_path = PathBuf::from(folder);
    let mut tracks = Vec::new();
    let mut skipped = Vec::new();

    if !folder_path.exists() || !folder_path.is_dir() {
        skipped.push(SkippedFile {
            path: folder.to_string(),
            reason: "Path does not exist or is not a directory".to_string(),
        });
        return ScanResult { tracks, skipped };
    }

    let entries: Box<dyn Iterator<Item = PathBuf>> = if recursive {
        Box::new(
            WalkDir::new(&folder_path)
                .into_iter()
                .filter_map(|e| e.ok())
                .map(|e| e.into_path()),
        )
    } else {
        Box::new(
            std::fs::read_dir(&folder_path)
                .into_iter()
                .flat_map(|rd| rd.into_iter())
                .filter_map(|e| e.ok())
                .map(|e| e.path()),
        )
    };

    for path in entries {
        if !path.is_file() || !is_audio_file(&path) {
            continue;
        }
        match extract_metadata(&path) {
            Ok(track) => tracks.push(track),
            Err(reason) => skipped.push(SkippedFile {
                path: path.to_string_lossy().to_string(),
                reason,
            }),
        }
    }

    // Sort by filename for consistent ordering
    tracks.sort_by(|a, b| a.file_name.cmp(&b.file_name));

    ScanResult { tracks, skipped }
}

#[tauri::command]
pub fn scan_folders(paths: Vec<String>, recursive: bool) -> Vec<ScanResult> {
    paths
        .iter()
        .map(|p| scan_folder(p, recursive))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_is_audio_file() {
        assert!(is_audio_file(Path::new("song.mp3")));
        assert!(is_audio_file(Path::new("song.MP3")));
        assert!(is_audio_file(Path::new("song.flac")));
        assert!(is_audio_file(Path::new("song.m4a")));
        assert!(is_audio_file(Path::new("song.ogg")));
        assert!(is_audio_file(Path::new("song.wav")));
        assert!(!is_audio_file(Path::new("readme.txt")));
        assert!(!is_audio_file(Path::new("image.png")));
        assert!(!is_audio_file(Path::new("noext")));
    }

    #[test]
    fn test_scan_empty_folder() {
        let dir = TempDir::new().unwrap();
        let result = scan_folder(dir.path().to_str().unwrap(), false);
        assert!(result.tracks.is_empty());
        assert!(result.skipped.is_empty());
    }

    #[test]
    fn test_scan_nonexistent_folder() {
        let result = scan_folder("/nonexistent/path/xyz", false);
        assert!(result.tracks.is_empty());
        assert_eq!(result.skipped.len(), 1);
        assert!(result.skipped[0].reason.contains("does not exist"));
    }

    #[test]
    fn test_scan_skips_non_audio_files() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("readme.txt"), "hello").unwrap();
        fs::write(dir.path().join("notes.md"), "# Notes").unwrap();
        let result = scan_folder(dir.path().to_str().unwrap(), false);
        assert!(result.tracks.is_empty());
        assert!(result.skipped.is_empty()); // non-audio files are silently ignored
    }

    #[test]
    fn test_scan_folder_recursive_vs_flat() {
        let dir = TempDir::new().unwrap();
        let sub = dir.path().join("subdir");
        fs::create_dir(&sub).unwrap();
        // Create empty files with audio extensions (they'll fail metadata extraction)
        fs::write(dir.path().join("top.mp3"), &[0u8; 10]).unwrap();
        fs::write(sub.join("nested.mp3"), &[0u8; 10]).unwrap();

        // Flat scan — should only see top.mp3 (skipped due to invalid metadata)
        let flat = scan_folder(dir.path().to_str().unwrap(), false);
        assert_eq!(flat.tracks.len() + flat.skipped.len(), 1);

        // Recursive scan — should see both
        let recursive = scan_folder(dir.path().to_str().unwrap(), true);
        assert_eq!(recursive.tracks.len() + recursive.skipped.len(), 2);
    }

    #[test]
    fn test_scan_invalid_audio_file_is_skipped() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join("bad.mp3"), "not actually audio").unwrap();
        let result = scan_folder(dir.path().to_str().unwrap(), false);
        assert!(result.tracks.is_empty());
        assert_eq!(result.skipped.len(), 1);
    }
}
