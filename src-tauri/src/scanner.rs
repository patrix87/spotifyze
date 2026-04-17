use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
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

fn parse_filename(path: &Path) -> Option<(String, String)> {
    let stem = path.file_stem()?.to_str()?;
    // Strip leading track numbers like "01 - ", "01. ", "1 - "
    let cleaned = stem
        .trim_start_matches(|c: char| c.is_ascii_digit())
        .trim_start_matches(['.', '-', '_', ' ']);

    // Try "Artist - Title" pattern
    for sep in [" - ", " – ", " — "] {
        if let Some((artist, title)) = cleaned.split_once(sep) {
            let artist = artist.trim();
            let title = title.trim();
            if !artist.is_empty() && !title.is_empty() {
                return Some((artist.to_string(), title.to_string()));
            }
        }
    }
    None
}

fn extract_metadata(path: &Path) -> Result<TrackInfo, String> {
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    let tagged_file = lofty::read_from_path(path);

    let tag = tagged_file
        .as_ref()
        .ok()
        .and_then(|tf| tf.primary_tag().or_else(|| tf.first_tag()));

    let tag_artist = tag
        .and_then(|t| t.artist().map(|s| s.to_string()))
        .filter(|s| !s.is_empty());

    let tag_title = tag
        .and_then(|t| t.title().map(|s| s.to_string()))
        .filter(|s| !s.is_empty());

    let (artist, title) = match (tag_artist, tag_title) {
        (Some(a), Some(t)) => (a, t),
        (Some(a), None) => {
            // Have artist from tag, try filename for title
            if let Some((_, ft)) = parse_filename(path) {
                (a, ft)
            } else {
                return Err("Missing title tag and could not parse filename".to_string());
            }
        }
        (None, Some(t)) => {
            // Have title from tag, try filename for artist
            if let Some((fa, _)) = parse_filename(path) {
                (fa, t)
            } else {
                return Err("Missing artist tag and could not parse filename".to_string());
            }
        }
        (None, None) => {
            // No tags at all, try filename
            if let Some((fa, ft)) = parse_filename(path) {
                (fa, ft)
            } else {
                return Err("No metadata tags and could not parse filename".to_string());
            }
        }
    };

    let album = tag
        .and_then(|t| t.album().map(|s| s.to_string()))
        .filter(|s| !s.is_empty());

    let album_artist = tag
        .and_then(|t| t.get_string(lofty::tag::ItemKey::AlbumArtist).map(|s| s.to_string()))
        .filter(|s| !s.is_empty());

    let track_number = tag.and_then(|t| t.track());
    let year = tag
        .and_then(|t| t.get_string(lofty::tag::ItemKey::Year).map(|s| s.to_string()))
        .and_then(|s| s.parse::<u32>().ok());

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

// --- M3U playlist parsing ---

struct M3uEntry {
    /// Artist/title parsed from #EXTINF line (if present)
    extinf_meta: Option<(String, String)>,
    /// Resolved file path from the M3U entry
    file_path: PathBuf,
}

fn read_file_lossy(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path)
        .map_err(|e| format!("Failed to read playlist file: {e}"))?;
    // Try UTF-8 first; fall back to Latin-1 (ISO 8859-1) for ANSI files
    match String::from_utf8(bytes.clone()) {
        Ok(s) => Ok(s),
        Err(_) => Ok(bytes.iter().map(|&b| b as char).collect()),
    }
}

fn parse_m3u(path: &Path) -> Result<Vec<M3uEntry>, String> {
    let content = read_file_lossy(path)?;
    // Strip UTF-8 BOM if present
    let content = content.strip_prefix('\u{feff}').unwrap_or(&content);
    let parent = path.parent().unwrap_or(Path::new("."));

    let mut entries = Vec::new();
    let mut current_extinf: Option<(String, String)> = None;

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line == "#EXTM3U" {
            continue;
        }
        if let Some(info) = line.strip_prefix("#EXTINF:") {
            // Format: #EXTINF:duration,Display Text
            if let Some((_duration, display)) = info.split_once(',') {
                let display = display.trim();
                // Try "Artist - Title" split
                for sep in [" - ", " – ", " — "] {
                    if let Some((artist, title)) = display.split_once(sep) {
                        let artist = artist.trim();
                        let title = title.trim();
                        if !artist.is_empty() && !title.is_empty() {
                            current_extinf = Some((artist.to_string(), title.to_string()));
                            break;
                        }
                    }
                }
                // If no separator found, treat whole display as title
                if current_extinf.is_none() && !display.is_empty() {
                    current_extinf = Some(("Unknown".to_string(), display.to_string()));
                }
            }
            continue;
        }
        if line.starts_with('#') {
            continue;
        }
        // This is a file path line
        let file_path = if Path::new(line).is_absolute() {
            PathBuf::from(line)
        } else {
            parent.join(line)
        };
        entries.push(M3uEntry {
            extinf_meta: current_extinf.take(),
            file_path,
        });
    }

    Ok(entries)
}

pub fn scan_playlist(path: &str) -> ScanResult {
    let playlist_path = PathBuf::from(path);
    let mut tracks = Vec::new();
    let mut skipped = Vec::new();

    if !playlist_path.exists() || !playlist_path.is_file() {
        skipped.push(SkippedFile {
            path: path.to_string(),
            reason: "Playlist file does not exist".to_string(),
        });
        return ScanResult { tracks, skipped };
    }

    let entries = match parse_m3u(&playlist_path) {
        Ok(e) => e,
        Err(reason) => {
            skipped.push(SkippedFile {
                path: path.to_string(),
                reason,
            });
            return ScanResult { tracks, skipped };
        }
    };

    for entry in entries {
        let file_path = &entry.file_path;

        // If the referenced file exists and is a supported audio file, use full metadata extraction
        if file_path.is_file() && is_audio_file(file_path) {
            match extract_metadata(file_path) {
                Ok(track) => {
                    tracks.push(track);
                    continue;
                }
                Err(_) => {
                    // Fall through to EXTINF fallback
                }
            }
        }

        // Fallback: use EXTINF metadata if available
        if let Some((artist, title)) = entry.extinf_meta {
            let file_name = file_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string();
            tracks.push(TrackInfo {
                path: file_path.to_string_lossy().to_string(),
                file_name,
                artist,
                title,
                album: None,
                album_artist: None,
                track_number: None,
                year: None,
            });
        } else {
            skipped.push(SkippedFile {
                path: file_path.to_string_lossy().to_string(),
                reason: "File not found and no EXTINF metadata".to_string(),
            });
        }
    }

    ScanResult { tracks, skipped }
}

#[tauri::command]
pub fn scan_playlists(paths: Vec<String>) -> Vec<ScanResult> {
    paths.iter().map(|p| scan_playlist(p)).collect()
}

#[derive(Debug, Clone, Serialize)]
pub struct AudioFileData {
    pub data: String,
    pub mime: String,
}

#[tauri::command]
pub fn read_audio_file(path: String) -> Result<AudioFileData, String> {
    let p = Path::new(&path);
    if !p.is_file() {
        return Err("File not found".to_string());
    }
    if !is_audio_file(p) {
        return Err("Not a supported audio file".to_string());
    }
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let mime = match ext.as_str() {
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "m4a" => "audio/mp4",
        "ogg" => "audio/ogg",
        "wav" => "audio/wav",
        _ => "application/octet-stream",
    };
    let bytes = std::fs::read(p).map_err(|e| format!("Failed to read file: {e}"))?;
    Ok(AudioFileData {
        data: BASE64.encode(&bytes),
        mime: mime.to_string(),
    })
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

    // --- M3U tests ---

    #[test]
    fn test_parse_m3u_with_extinf() {
        let dir = TempDir::new().unwrap();
        let m3u = dir.path().join("playlist.m3u");
        fs::write(
            &m3u,
            "#EXTM3U\n#EXTINF:240,Pink Floyd - Comfortably Numb\nmusic/song.mp3\n",
        )
        .unwrap();

        let entries = parse_m3u(&m3u).unwrap();
        assert_eq!(entries.len(), 1);
        let (artist, title) = entries[0].extinf_meta.as_ref().unwrap();
        assert_eq!(artist, "Pink Floyd");
        assert_eq!(title, "Comfortably Numb");
        assert!(entries[0].file_path.ends_with("music/song.mp3"));
    }

    #[test]
    fn test_parse_m3u_bare_paths() {
        let dir = TempDir::new().unwrap();
        let m3u = dir.path().join("simple.m3u");
        fs::write(&m3u, "song1.mp3\nsong2.flac\n").unwrap();

        let entries = parse_m3u(&m3u).unwrap();
        assert_eq!(entries.len(), 2);
        assert!(entries[0].extinf_meta.is_none());
        assert!(entries[1].extinf_meta.is_none());
    }

    #[test]
    fn test_parse_m3u_relative_path_resolution() {
        let dir = TempDir::new().unwrap();
        let m3u = dir.path().join("test.m3u");
        fs::write(&m3u, "subdir/track.mp3\n").unwrap();

        let entries = parse_m3u(&m3u).unwrap();
        assert_eq!(entries[0].file_path, dir.path().join("subdir/track.mp3"));
    }

    #[test]
    fn test_parse_m3u_empty_file() {
        let dir = TempDir::new().unwrap();
        let m3u = dir.path().join("empty.m3u");
        fs::write(&m3u, "#EXTM3U\n").unwrap();

        let entries = parse_m3u(&m3u).unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn test_parse_m3u_utf8_bom() {
        let dir = TempDir::new().unwrap();
        let m3u = dir.path().join("bom.m3u8");
        fs::write(&m3u, "\u{feff}#EXTM3U\n#EXTINF:180,Artist - Song\nfile.mp3\n").unwrap();

        let entries = parse_m3u(&m3u).unwrap();
        assert_eq!(entries.len(), 1);
        assert!(entries[0].extinf_meta.is_some());
    }

    #[test]
    fn test_parse_m3u_title_without_artist_separator() {
        let dir = TempDir::new().unwrap();
        let m3u = dir.path().join("nosep.m3u");
        fs::write(&m3u, "#EXTINF:200,Just A Song Title\ntrack.mp3\n").unwrap();

        let entries = parse_m3u(&m3u).unwrap();
        let (artist, title) = entries[0].extinf_meta.as_ref().unwrap();
        assert_eq!(artist, "Unknown");
        assert_eq!(title, "Just A Song Title");
    }

    #[test]
    fn test_parse_m3u_latin1_encoding() {
        let dir = TempDir::new().unwrap();
        let m3u = dir.path().join("latin1.m3u");
        // Latin-1 bytes: "Beyoncé" = [66,101,121,111,110,99,0xe9]
        let mut content: Vec<u8> = b"#EXTINF:200,Beyonc".to_vec();
        content.push(0xe9); // é in Latin-1
        content.extend_from_slice(b" - Halo\ntrack.mp3\n");
        fs::write(&m3u, &content).unwrap();

        let entries = parse_m3u(&m3u).unwrap();
        assert_eq!(entries.len(), 1);
        let (artist, title) = entries[0].extinf_meta.as_ref().unwrap();
        assert_eq!(artist, "Beyoncé");
        assert_eq!(title, "Halo");
    }

    #[test]
    fn test_scan_playlist_with_extinf_fallback() {
        let dir = TempDir::new().unwrap();
        let m3u = dir.path().join("test.m3u");
        // File doesn't exist on disk, but EXTINF has metadata
        fs::write(
            &m3u,
            "#EXTM3U\n#EXTINF:300,Radiohead - Karma Police\nnonexistent.mp3\n",
        )
        .unwrap();

        let result = scan_playlist(m3u.to_str().unwrap());
        assert_eq!(result.tracks.len(), 1);
        assert_eq!(result.tracks[0].artist, "Radiohead");
        assert_eq!(result.tracks[0].title, "Karma Police");
        assert!(result.tracks[0].album.is_none());
        assert!(result.skipped.is_empty());
    }

    #[test]
    fn test_scan_playlist_missing_file_no_extinf() {
        let dir = TempDir::new().unwrap();
        let m3u = dir.path().join("test.m3u");
        // No EXTINF, file doesn't exist
        fs::write(&m3u, "missing.mp3\n").unwrap();

        let result = scan_playlist(m3u.to_str().unwrap());
        assert!(result.tracks.is_empty());
        assert_eq!(result.skipped.len(), 1);
        assert!(result.skipped[0].reason.contains("no EXTINF"));
    }

    #[test]
    fn test_scan_playlist_nonexistent_file() {
        let result = scan_playlist("/nonexistent/playlist.m3u");
        assert!(result.tracks.is_empty());
        assert_eq!(result.skipped.len(), 1);
        assert!(result.skipped[0].reason.contains("does not exist"));
    }

    #[test]
    fn test_scan_playlist_mixed_entries() {
        let dir = TempDir::new().unwrap();
        let m3u = dir.path().join("mixed.m3u");
        // Two entries: one with EXTINF (file missing), one without (file missing)
        fs::write(
            &m3u,
            "#EXTM3U\n#EXTINF:200,Artist A - Song A\nmissing_a.mp3\nmissing_b.mp3\n",
        )
        .unwrap();

        let result = scan_playlist(m3u.to_str().unwrap());
        assert_eq!(result.tracks.len(), 1); // Only the one with EXTINF
        assert_eq!(result.tracks[0].artist, "Artist A");
        assert_eq!(result.skipped.len(), 1); // The one without EXTINF
    }
}
