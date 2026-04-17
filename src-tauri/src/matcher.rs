use crate::auth::{get_valid_token, AuthState};
use crate::cache::QueryCacheState;
use futures::stream::{self, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use tauri::Emitter;
use tokio::sync::Mutex;

use crate::scanner::TrackInfo;

const CONFIDENCE_THRESHOLD_DEFAULT: u8 = 80;

/// Shared cancellation flag for match_tracks.
pub struct MatchCancellation {
    cancelled: AtomicBool,
}

impl MatchCancellation {
    pub fn new() -> Self {
        Self {
            cancelled: AtomicBool::new(false),
        }
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    pub fn reset(&self) {
        self.cancelled.store(false, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchCandidate {
    pub spotify_uri: String,
    pub name: String,
    pub artist: String,
    pub album: String,
    pub album_type: Option<String>,
    pub release_year: Option<String>,
    pub popularity: u32,
    pub score: u8,
    pub external_url: Option<String>,
    pub preview_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MatchStatus {
    AutoMatched,
    NeedsReview,
    NotFound,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchResult {
    pub track: TrackInfo,
    pub status: MatchStatus,
    pub candidates: Vec<MatchCandidate>,
    pub selected_uri: Option<String>,
}

fn normalize(s: &str) -> String {
    s.to_lowercase()
        .replace(['(', ')', '[', ']', '{', '}'], "")
        .replace("feat.", "")
        .replace("ft.", "")
        .replace("featuring", "")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

fn score_candidate(track: &TrackInfo, candidate: &SpotifyTrack) -> u8 {
    let local_artist = normalize(&track.artist);
    let local_title = normalize(&track.title);
    let local_album = track.album.as_deref().map(normalize);

    let spotify_artist = normalize(&candidate.artist_name());
    let spotify_title = normalize(&candidate.name);
    let spotify_album = normalize(&candidate.album.name);

    // Artist similarity (40 pts)
    let artist_sim = strsim::jaro_winkler(&local_artist, &spotify_artist);
    let artist_score = (artist_sim * 40.0) as u8;

    // Title similarity (30 pts)
    let title_sim = strsim::jaro_winkler(&local_title, &spotify_title);
    let mut title_score = (title_sim * 30.0) as u8;

    // Penalize if Spotify title contains "remix", "mix", "live", "acoustic" but local doesn't
    let remix_keywords = ["remix", "mix", "live", "acoustic", "radio edit", "instrumental"];
    let spotify_title_lower = candidate.name.to_lowercase();
    let local_title_lower = track.title.to_lowercase();
    for keyword in &remix_keywords {
        if spotify_title_lower.contains(keyword) && !local_title_lower.contains(keyword) {
            title_score = title_score.saturating_sub(15);
            break;
        }
    }

    // Album similarity (15 pts)
    let album_score = if let Some(ref local_alb) = local_album {
        let sim = strsim::jaro_winkler(local_alb, &spotify_album);
        (sim * 15.0) as u8
    } else {
        8 // Neutral when no local album info
    };

    // Album type bonus (10 pts) — prefer "album" over "compilation" or "single"
    let type_score = match candidate.album.album_type.as_deref() {
        Some("album") => 10,
        Some("single") => 5,
        Some("compilation") => 0,
        _ => 5,
    };

    // Popularity tiebreaker (5 pts)
    let pop_score = ((candidate.popularity as f64 / 100.0) * 5.0) as u8;

    let total = artist_score + title_score + album_score + type_score + pop_score;
    total.min(100)
}

fn clean_title_for_search(title: &str) -> String {
    let s = title.to_string();
    // Strip leading track numbers like "04 - ", "15 "
    let s = s.trim_start_matches(|c: char| c.is_ascii_digit())
        .trim_start_matches(['-', '.', ' ']);
    // Remove feat/ft sections and everything in brackets after them
    let mut result = s.to_string();
    for pattern in ["(feat.", "(ft.", "[feat.", "[ft.", "feat.", "ft.", "featuring"] {
        if let Some(pos) = result.to_lowercase().find(pattern) {
            result.truncate(pos);
        }
    }
    result.trim().to_string()
}

fn clean_artist_for_search(artist: &str) -> String {
    // Strip "Ft.", "Feat.", "and", "vs" suffixes that include featured artists
    let mut result = artist.to_string();
    for pattern in [" feat.", " feat ", " ft.", " ft ", " featuring "] {
        if let Some(pos) = result.to_lowercase().find(pattern) {
            result.truncate(pos);
        }
    }
    result.trim().to_string()
}

fn build_search_query(track: &TrackInfo) -> String {
    let artist = sanitize_query(&clean_artist_for_search(&track.artist));
    let title = sanitize_query(&clean_title_for_search(&track.title));
    let mut query = format!("artist:\"{artist}\" track:\"{title}\"");

    if let Some(ref album) = track.album {
        let album_clean = sanitize_query(album);
        if !album_clean.is_empty() {
            query = format!("{query} album:\"{album_clean}\"");
        }
    }
    query
}

fn sanitize_query(s: &str) -> String {
    s.replace(['"', '\''], "")
        .replace('&', "and")
        .replace(['[', ']', '(', ')', '{', '}'], "")
        .replace(['!', '?'], "")
        .trim()
        .to_string()
}

// Spotify API response types
#[derive(Debug, Deserialize)]
struct SpotifySearchResponse {
    tracks: Option<SpotifyTracksResult>,
}

#[derive(Debug, Deserialize)]
struct SpotifyTracksResult {
    items: Vec<SpotifyTrack>,
}

#[derive(Debug, Deserialize)]
struct SpotifyTrack {
    uri: String,
    name: String,
    artists: Vec<SpotifyArtist>,
    album: SpotifyAlbum,
    popularity: u32,
    external_urls: Option<SpotifyExternalUrls>,
    preview_url: Option<String>,
}

impl SpotifyTrack {
    fn artist_name(&self) -> String {
        self.artists
            .first()
            .map(|a| a.name.clone())
            .unwrap_or_default()
    }
}

#[derive(Debug, Deserialize)]
struct SpotifyArtist {
    name: String,
}

#[derive(Debug, Deserialize)]
struct SpotifyAlbum {
    name: String,
    album_type: Option<String>,
    release_date: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SpotifyExternalUrls {
    spotify: Option<String>,
}

const MAX_RETRIES: u32 = 10;

async fn search_spotify(
    api_base: &str,
    access_token: &str,
    query: &str,
) -> Result<Vec<SpotifyTrack>, String> {
    let client = reqwest::Client::new();
    let mut last_err = String::new();

    for attempt in 0..=MAX_RETRIES {
        let resp = client
            .get(format!("{api_base}/v1/search"))
            .bearer_auth(access_token)
            .query(&[("q", query), ("type", "track"), ("limit", "10")])
            .send()
            .await
            .map_err(|e| format!("Search request failed: {e}"))?;

        if resp.status().as_u16() == 429 {
            if attempt == MAX_RETRIES {
                return Err("Search failed: rate limited after max retries".to_string());
            }
            let header_secs = resp
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or(0);
            let wait_secs = header_secs + (attempt as u64 + 1);
            eprintln!(
                "[matcher] Rate limited (attempt {}/{}), waiting {wait_secs}s",
                attempt + 1,
                MAX_RETRIES
            );
            tokio::time::sleep(std::time::Duration::from_secs(wait_secs)).await;
            continue;
        }

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            last_err = format!("Search failed ({status}): {body}");
            if attempt < MAX_RETRIES {
                tokio::time::sleep(std::time::Duration::from_secs(attempt as u64 + 1)).await;
                continue;
            }
            return Err(last_err);
        }

        let body: SpotifySearchResponse = resp
            .json()
            .await
            .map_err(|e| format!("Parse error: {e}"))?;
        return Ok(body.tracks.map(|t| t.items).unwrap_or_default());
    }

    Err(last_err)
}

fn build_fallback_query(track: &TrackInfo) -> String {
    let artist = sanitize_query(&track.artist);
    let title = sanitize_query(&track.title);
    format!("{artist} {title}")
}

async fn match_single_track(
    api_base: &str,
    access_token: &str,
    track: &TrackInfo,
    confidence: u8,
    cache: Option<&QueryCacheState>,
) -> MatchResult {
    let query = build_search_query(track);

    // Check query cache first
    if let Some(cache) = cache
        && let Some(cached_candidates) = cache.get(&query)
    {
        let status = if cached_candidates.first().map(|c| c.score).unwrap_or(0) >= confidence {
            MatchStatus::AutoMatched
        } else if cached_candidates.is_empty() {
            MatchStatus::NotFound
        } else {
            MatchStatus::NeedsReview
        };
        let selected_uri = cached_candidates.first().map(|c| c.spotify_uri.clone());
        return MatchResult {
            track: track.clone(),
            status,
            candidates: cached_candidates,
            selected_uri,
        };
    }

    let spotify_tracks = match search_spotify(api_base, access_token, &query).await {
        Ok(tracks) => tracks,
        Err(e) => {
            eprintln!("[matcher] Search error for '{}' - '{}': {e}", track.artist, track.title);
            return MatchResult {
                track: track.clone(),
                status: MatchStatus::NotFound,
                candidates: vec![],
                selected_uri: None,
            };
        }
    };

    // If field-filtered query returned nothing, try a plain text fallback
    let spotify_tracks = if spotify_tracks.is_empty() {
        let fallback = build_fallback_query(track);
        search_spotify(api_base, access_token, &fallback).await.unwrap_or_default()
    } else {
        spotify_tracks
    };

    if spotify_tracks.is_empty() {
        // Cache the empty result
        if let Some(cache) = cache {
            cache.insert(query, vec![]);
        }
        return MatchResult {
            track: track.clone(),
            status: MatchStatus::NotFound,
            candidates: vec![],
            selected_uri: None,
        };
    }

    let mut candidates: Vec<MatchCandidate> = spotify_tracks
        .iter()
        .map(|st| {
            let score = score_candidate(track, st);
            MatchCandidate {
                spotify_uri: st.uri.clone(),
                name: st.name.clone(),
                artist: st.artist_name(),
                album: st.album.name.clone(),
                album_type: st.album.album_type.clone(),
                release_year: st
                    .album
                    .release_date
                    .as_ref()
                    .map(|d| d.chars().take(4).collect()),
                popularity: st.popularity,
                score,
                external_url: st
                    .external_urls
                    .as_ref()
                    .and_then(|u| u.spotify.clone()),
                preview_url: st.preview_url.clone(),
            }
        })
        .collect();

    candidates.sort_by_key(|c| std::cmp::Reverse(c.score));
    candidates.truncate(5);

    // Cache the candidates for this query
    if let Some(cache) = cache {
        cache.insert(query, candidates.clone());
    }

    let status = if candidates.first().map(|c| c.score).unwrap_or(0) >= confidence {
        MatchStatus::AutoMatched
    } else {
        MatchStatus::NeedsReview
    };

    let selected_uri = candidates.first().map(|c| c.spotify_uri.clone());

    MatchResult {
        track: track.clone(),
        status,
        candidates,
        selected_uri,
    }
}

#[derive(Debug, Clone, Serialize)]
struct MatchProgress {
    current: usize,
    total: usize,
    artist: String,
    title: String,
}

const CONCURRENT_REQUESTS: usize = 4;

#[tauri::command]
pub async fn match_tracks(
    app: tauri::AppHandle,
    tracks: Vec<TrackInfo>,
    confidence: Option<u8>,
    state: tauri::State<'_, Arc<Mutex<AuthState>>>,
    cancel: tauri::State<'_, Arc<MatchCancellation>>,
    query_cache: tauri::State<'_, QueryCacheState>,
) -> Result<Vec<MatchResult>, String> {
    cancel.reset();
    let access_token = get_valid_token(&state.inner().clone()).await?;
    let confidence = confidence.unwrap_or(CONFIDENCE_THRESHOLD_DEFAULT);
    let total = tracks.len();
    let completed = Arc::new(AtomicUsize::new(0));

    // Emit initial progress so the UI shows the loading bar immediately
    let _ = app.emit("match-progress", MatchProgress {
        current: 0,
        total,
        artist: String::new(),
        title: String::new(),
    });
    let cancel = Arc::clone(cancel.inner());
    let cache = query_cache.inner().clone();

    let results: Vec<(usize, MatchResult)> = stream::iter(tracks.into_iter().enumerate())
        .map(|(i, track)| {
            let token = access_token.clone();
            let cache = cache.clone();
            let cancel = Arc::clone(&cancel);
            let app = app.clone();
            let completed = Arc::clone(&completed);
            async move {
                if cancel.is_cancelled() {
                    return None;
                }
                let result = match_single_track(
                    "https://api.spotify.com",
                    &token,
                    &track,
                    confidence,
                    Some(&cache),
                )
                .await;
                let done = completed.fetch_add(1, Ordering::Relaxed) + 1;
                let _ = app.emit(
                    "match-progress",
                    MatchProgress {
                        current: done,
                        total,
                        artist: track.artist.clone(),
                        title: track.title.clone(),
                    },
                );
                Some((i, result))
            }
        })
        .buffer_unordered(CONCURRENT_REQUESTS)
        .filter_map(|x| async { x })
        .collect()
        .await;

    let mut ordered = results;
    ordered.sort_by_key(|(i, _)| *i);

    Ok(ordered.into_iter().map(|(_, r)| r).collect())
}

#[tauri::command]
pub async fn cancel_matching(
    cancel: tauri::State<'_, Arc<MatchCancellation>>,
) -> Result<(), String> {
    cancel.cancel();
    Ok(())
}

#[tauri::command]
pub async fn search_manual(
    query: String,
    state: tauri::State<'_, Arc<Mutex<AuthState>>>,
) -> Result<Vec<MatchCandidate>, String> {
    let access_token = get_valid_token(&state.inner().clone()).await?;
    let spotify_tracks = search_spotify("https://api.spotify.com", &access_token, &query).await?;

    let mut candidates: Vec<MatchCandidate> = spotify_tracks
        .iter()
        .map(|st| MatchCandidate {
            spotify_uri: st.uri.clone(),
            name: st.name.clone(),
            artist: st.artist_name(),
            album: st.album.name.clone(),
            album_type: st.album.album_type.clone(),
            release_year: st
                .album
                .release_date
                .as_ref()
                .map(|d| d.chars().take(4).collect()),
            popularity: st.popularity,
            score: 0,
            external_url: st.external_urls.as_ref().and_then(|u| u.spotify.clone()),
            preview_url: st.preview_url.clone(),
        })
        .collect();

    candidates.sort_by_key(|c| std::cmp::Reverse(c.popularity));
    Ok(candidates)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_track(artist: &str, title: &str, album: Option<&str>) -> TrackInfo {
        TrackInfo {
            path: "/test/song.mp3".to_string(),
            file_name: "song.mp3".to_string(),
            artist: artist.to_string(),
            title: title.to_string(),
            album: album.map(|s| s.to_string()),
            album_artist: None,
            track_number: None,
            year: None,
        }
    }

    fn make_spotify_track(
        name: &str,
        artist: &str,
        album: &str,
        album_type: &str,
        popularity: u32,
    ) -> SpotifyTrack {
        SpotifyTrack {
            uri: format!("spotify:track:{name}"),
            name: name.to_string(),
            artists: vec![SpotifyArtist {
                name: artist.to_string(),
            }],
            album: SpotifyAlbum {
                name: album.to_string(),
                album_type: Some(album_type.to_string()),
                release_date: Some("2020-01-01".to_string()),
            },
            popularity,
            external_urls: None,
            preview_url: None,
        }
    }

    #[test]
    fn test_score_exact_match() {
        let track = make_track("Pink Floyd", "Comfortably Numb", Some("The Wall"));
        let candidate =
            make_spotify_track("Comfortably Numb", "Pink Floyd", "The Wall", "album", 80);
        let score = score_candidate(&track, &candidate);
        assert!(score >= 85, "Exact match should score high, got {score}");
    }

    #[test]
    fn test_score_wrong_artist() {
        let track = make_track("Pink Floyd", "Comfortably Numb", Some("The Wall"));
        let candidate = make_spotify_track(
            "Comfortably Numb",
            "Some Cover Band",
            "Cover Album",
            "album",
            20,
        );
        let score = score_candidate(&track, &candidate);
        assert!(
            score < 70,
            "Wrong artist should score lower, got {score}"
        );
    }

    #[test]
    fn test_score_compilation_penalty() {
        let track = make_track("Artist", "Song", Some("Original Album"));
        let album_candidate =
            make_spotify_track("Song", "Artist", "Original Album", "album", 50);
        let compilation_candidate =
            make_spotify_track("Song", "Artist", "Greatest Hits Vol 3", "compilation", 50);

        let album_score = score_candidate(&track, &album_candidate);
        let compilation_score = score_candidate(&track, &compilation_candidate);

        assert!(
            album_score > compilation_score,
            "Album ({album_score}) should score higher than compilation ({compilation_score})"
        );
    }

    #[test]
    fn test_score_remix_penalty() {
        let track = make_track("Artist", "Song", None);
        let original = make_spotify_track("Song", "Artist", "Album", "album", 50);
        let remix = make_spotify_track("Song (Club Remix)", "Artist", "Album", "album", 50);

        let original_score = score_candidate(&track, &original);
        let remix_score = score_candidate(&track, &remix);

        assert!(
            original_score > remix_score,
            "Original ({original_score}) should score higher than remix ({remix_score})"
        );
    }

    #[test]
    fn test_score_partial_match() {
        let track = make_track("Pink Floyd", "Comfortably Numb", None);
        let candidate = make_spotify_track(
            "Comfortably Numb - Remastered 2011",
            "Pink Floyd",
            "The Wall",
            "album",
            75,
        );
        let score = score_candidate(&track, &candidate);
        assert!(
            score >= 50 && score <= 95,
            "Partial match should be moderate, got {score}"
        );
    }

    #[test]
    fn test_build_search_query_basic() {
        let track = make_track("Pink Floyd", "Comfortably Numb", None);
        let query = build_search_query(&track);
        assert_eq!(query, r#"artist:"Pink Floyd" track:"Comfortably Numb""#);
    }

    #[test]
    fn test_build_search_query_with_album() {
        let track = make_track("Pink Floyd", "Comfortably Numb", Some("The Wall"));
        let query = build_search_query(&track);
        assert_eq!(
            query,
            r#"artist:"Pink Floyd" track:"Comfortably Numb" album:"The Wall""#
        );
    }

    #[test]
    fn test_build_search_query_strips_feat() {
        let track = make_track("Eminem Ft. Rihanna", "Love The Way You Lie Part 1", None);
        let query = build_search_query(&track);
        assert_eq!(query, r#"artist:"Eminem" track:"Love The Way You Lie Part 1""#);
    }

    #[test]
    fn test_build_search_query_strips_title_feat() {
        let track = make_track("Naughty Boy", "Lifted Ft. Emeli Sandé", None);
        let query = build_search_query(&track);
        assert_eq!(query, r#"artist:"Naughty Boy" track:"Lifted""#);
    }

    #[test]
    fn test_build_search_query_strips_track_number() {
        let track = make_track("Pink Floyd", "04 - Comfortably Numb", None);
        let query = build_search_query(&track);
        assert_eq!(query, r#"artist:"Pink Floyd" track:"Comfortably Numb""#);
    }

    #[test]
    fn test_sanitize_query_special_chars() {
        assert_eq!(sanitize_query("AC/DC"), "AC/DC");
        assert_eq!(sanitize_query(r#"He said "hello""#), "He said hello");
        assert_eq!(sanitize_query("Rock & Roll"), "Rock and Roll");
        assert_eq!(sanitize_query("  spaced  "), "spaced");
        assert_eq!(sanitize_query("Smilin!!"), "Smilin");
        assert_eq!(sanitize_query("Where Is The Love?"), "Where Is The Love");
        assert_eq!(sanitize_query("[Deluxe Edition]"), "Deluxe Edition");
    }

    #[test]
    fn test_normalize() {
        assert_eq!(normalize("Song (feat. Artist)"), "song artist");
        assert_eq!(normalize("Song [Deluxe]"), "song deluxe");
        assert_eq!(normalize("  HELLO   WORLD  "), "hello world");
        assert_eq!(normalize("ft. Someone"), "someone");
    }

    #[test]
    fn test_clean_title_for_search_strips_track_number() {
        assert_eq!(clean_title_for_search("04 - Comfortably Numb"), "Comfortably Numb");
        assert_eq!(clean_title_for_search("15 Song Title"), "Song Title");
        assert_eq!(clean_title_for_search("1. Intro"), "Intro");
    }

    #[test]
    fn test_clean_title_for_search_strips_feat() {
        assert_eq!(clean_title_for_search("Song (feat. Artist)"), "Song");
        assert_eq!(clean_title_for_search("Song (ft. Artist)"), "Song");
        assert_eq!(clean_title_for_search("Song [feat. Artist]"), "Song");
        assert_eq!(clean_title_for_search("Song featuring Artist"), "Song");
        assert_eq!(clean_title_for_search("Song ft. Artist"), "Song");
    }

    #[test]
    fn test_clean_title_for_search_no_number() {
        assert_eq!(clean_title_for_search("Plain Title"), "Plain Title");
    }

    #[test]
    fn test_clean_artist_for_search() {
        assert_eq!(clean_artist_for_search("Eminem Ft. Rihanna"), "Eminem");
        assert_eq!(clean_artist_for_search("Artist feat. Other"), "Artist");
        assert_eq!(clean_artist_for_search("Artist featuring Other"), "Artist");
        assert_eq!(clean_artist_for_search("Solo Artist"), "Solo Artist");
    }

    #[test]
    fn test_build_fallback_query() {
        let track = make_track("Pink Floyd", "Money", None);
        let query = build_fallback_query(&track);
        assert_eq!(query, "Pink Floyd Money");
    }

    #[test]
    fn test_build_fallback_query_special_chars() {
        let track = make_track("AC/DC", "It's a Long Way", None);
        let query = build_fallback_query(&track);
        assert_eq!(query, "AC/DC Its a Long Way");
    }

    #[test]
    fn test_score_no_album_info() {
        let track = make_track("Artist", "Song", None);
        let candidate = make_spotify_track("Song", "Artist", "Some Album", "album", 50);
        let score = score_candidate(&track, &candidate);
        // Should still score well since artist + title match
        assert!(score >= 70, "No album info should still score well, got {score}");
    }

    #[test]
    fn test_score_single_vs_album() {
        let track = make_track("Artist", "Song", Some("Album"));
        let single = make_spotify_track("Song", "Artist", "Album", "single", 50);
        let album = make_spotify_track("Song", "Artist", "Album", "album", 50);
        let single_score = score_candidate(&track, &single);
        let album_score = score_candidate(&track, &album);
        assert!(album_score > single_score, "Album ({album_score}) should beat single ({single_score})");
    }

    #[test]
    fn test_score_popularity_tiebreaker() {
        let track = make_track("Artist", "Song", Some("Album"));
        let popular = make_spotify_track("Song", "Artist", "Album", "album", 100);
        let unpopular = make_spotify_track("Song", "Artist", "Album", "album", 0);
        let popular_score = score_candidate(&track, &popular);
        let unpopular_score = score_candidate(&track, &unpopular);
        assert!(popular_score > unpopular_score, "Popular ({popular_score}) should beat unpopular ({unpopular_score})");
    }

    #[test]
    fn test_score_live_penalty_when_local_not_live() {
        let track = make_track("Artist", "Song", None);
        let normal = make_spotify_track("Song", "Artist", "Album", "album", 50);
        let live = make_spotify_track("Song (Live)", "Artist", "Album", "album", 50);
        let normal_score = score_candidate(&track, &normal);
        let live_score = score_candidate(&track, &live);
        assert!(normal_score > live_score, "Normal ({normal_score}) should beat live ({live_score})");
    }

    #[test]
    fn test_score_live_no_penalty_when_local_is_live() {
        let track = make_track("Artist", "Song (Live)", None);
        let live = make_spotify_track("Song (Live)", "Artist", "Album", "album", 50);
        let score = score_candidate(&track, &live);
        // Should not be penalized since local also has "live"
        assert!(score >= 80, "Both live should score high, got {score}");
    }

    #[test]
    fn test_score_completely_different() {
        let track = make_track("Pink Floyd", "Comfortably Numb", Some("The Wall"));
        let candidate = make_spotify_track("Baby Shark", "Pinkfong", "Baby Shark", "single", 95);
        let score = score_candidate(&track, &candidate);
        assert!(score < 65, "Completely different should score low, got {score}");
    }

    #[test]
    fn test_build_search_query_empty_album() {
        let track = make_track("Artist", "Title", Some(""));
        let query = build_search_query(&track);
        // Empty album should not add album field
        assert_eq!(query, r#"artist:"Artist" track:"Title""#);
    }

    #[test]
    fn test_sanitize_query_curly_braces() {
        assert_eq!(sanitize_query("{Special} Edition"), "Special Edition");
    }

    // === Async API tests using mockito ===

    fn search_response_json(tracks: &[(&str, &str, &str, &str, u32)]) -> String {
        let items: Vec<String> = tracks
            .iter()
            .map(|(uri, name, artist, album, pop)| {
                format!(
                    r#"{{"uri":"spotify:track:{uri}","name":"{name}","artists":[{{"name":"{artist}"}}],"album":{{"name":"{album}","album_type":"album","release_date":"2020-01-01"}},"popularity":{pop},"external_urls":{{"spotify":"https://open.spotify.com/track/{uri}"}},"preview_url":null}}"#
                )
            })
            .collect();
        format!(r#"{{"tracks":{{"items":[{}]}}}}"#, items.join(","))
    }

    #[tokio::test]
    async fn test_search_spotify_returns_tracks() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("GET", "/v1/search")
            .match_query(mockito::Matcher::Any)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(search_response_json(&[(
                "abc123",
                "Comfortably Numb",
                "Pink Floyd",
                "The Wall",
                80,
            )]))
            .create_async()
            .await;

        let result = search_spotify(&server.url(), "fake_token", "test query").await;
        mock.assert_async().await;
        let tracks = result.unwrap();
        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].name, "Comfortably Numb");
        assert_eq!(tracks[0].artist_name(), "Pink Floyd");
        assert_eq!(tracks[0].album.name, "The Wall");
        assert_eq!(tracks[0].popularity, 80);
    }

    #[tokio::test]
    async fn test_search_spotify_empty_results() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("GET", "/v1/search")
            .match_query(mockito::Matcher::Any)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"tracks":{"items":[]}}"#)
            .create_async()
            .await;

        let result = search_spotify(&server.url(), "fake_token", "nonexistent").await;
        mock.assert_async().await;
        assert!(result.unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_search_spotify_server_error() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("GET", "/v1/search")
            .match_query(mockito::Matcher::Any)
            .with_status(500)
            .with_body("Internal Server Error")
            .expect_at_least(2)
            .create_async()
            .await;

        let result = search_spotify(&server.url(), "fake_token", "test").await;
        mock.assert_async().await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("500"));
    }

    #[tokio::test]
    async fn test_search_spotify_rate_limit_then_error() {
        let mut server = mockito::Server::new_async().await;
        let _mock = server
            .mock("GET", "/v1/search")
            .match_query(mockito::Matcher::Any)
            .with_status(429)
            .with_header("retry-after", "0")
            .expect_at_least(2)
            .create_async()
            .await;

        let result = search_spotify(&server.url(), "fake_token", "test").await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("rate limited"));
    }

    #[tokio::test]
    async fn test_search_spotify_multiple_tracks() {
        let mut server = mockito::Server::new_async().await;
        let _mock = server
            .mock("GET", "/v1/search")
            .match_query(mockito::Matcher::Any)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(search_response_json(&[
                ("t1", "Song A", "Artist A", "Album A", 90),
                ("t2", "Song B", "Artist B", "Album B", 50),
                ("t3", "Song C", "Artist C", "Album C", 10),
            ]))
            .create_async()
            .await;

        let tracks = search_spotify(&server.url(), "token", "query").await.unwrap();
        assert_eq!(tracks.len(), 3);
        assert_eq!(tracks[0].name, "Song A");
        assert_eq!(tracks[2].name, "Song C");
    }

    #[tokio::test]
    async fn test_match_single_track_auto_matched() {
        let mut server = mockito::Server::new_async().await;
        let _mock = server
            .mock("GET", "/v1/search")
            .match_query(mockito::Matcher::Any)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(search_response_json(&[(
                "abc",
                "Comfortably Numb",
                "Pink Floyd",
                "The Wall",
                80,
            )]))
            .create_async()
            .await;

        let track = make_track("Pink Floyd", "Comfortably Numb", Some("The Wall"));
        let result = match_single_track(&server.url(), "fake_token", &track, 70, None).await;
        assert!(matches!(result.status, MatchStatus::AutoMatched));
        assert!(!result.candidates.is_empty());
        assert!(result.selected_uri.is_some());
        assert!(result.candidates[0].score >= 70);
    }

    #[tokio::test]
    async fn test_match_single_track_needs_review() {
        let mut server = mockito::Server::new_async().await;
        let _mock = server
            .mock("GET", "/v1/search")
            .match_query(mockito::Matcher::Any)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(search_response_json(&[(
                "abc",
                "Comfortably Numb",
                "Some Cover Band",
                "Covers",
                20,
            )]))
            .create_async()
            .await;

        let track = make_track("Pink Floyd", "Comfortably Numb", Some("The Wall"));
        let result = match_single_track(&server.url(), "fake_token", &track, 95, None).await;
        assert!(matches!(result.status, MatchStatus::NeedsReview));
        assert!(!result.candidates.is_empty());
    }

    #[tokio::test]
    async fn test_match_single_track_not_found() {
        let mut server = mockito::Server::new_async().await;
        let _mock = server
            .mock("GET", "/v1/search")
            .match_query(mockito::Matcher::Any)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"tracks":{"items":[]}}"#)
            .create_async()
            .await;

        let track = make_track("Unknown Artist", "Unknown Song", None);
        let result = match_single_track(&server.url(), "fake_token", &track, 80, None).await;
        assert!(matches!(result.status, MatchStatus::NotFound));
        assert!(result.candidates.is_empty());
    }

    #[tokio::test]
    async fn test_match_single_track_fallback_succeeds() {
        let mut server = mockito::Server::new_async().await;

        // Fallback query (plain text) returns results — created FIRST (LIFO bottom)
        let _fallback_mock = server
            .mock("GET", "/v1/search")
            .match_query(mockito::Matcher::Any)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(search_response_json(&[(
                "abc",
                "Song",
                "Artist",
                "Album",
                80,
            )]))
            .create_async()
            .await;

        // Primary query (with field syntax artist:"...") returns empty — created SECOND (LIFO top)
        let _primary_mock = server
            .mock("GET", "/v1/search")
            .match_query(mockito::Matcher::Regex("q=artist%3A".into()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"tracks":{"items":[]}}"#)
            .create_async()
            .await;

        let track = make_track("Artist", "Song", None);
        let result = match_single_track(&server.url(), "fake_token", &track, 70, None).await;
        assert!(!matches!(result.status, MatchStatus::NotFound));
        assert!(!result.candidates.is_empty());
    }

    #[tokio::test]
    async fn test_match_single_track_candidates_sorted_and_truncated() {
        let mut server = mockito::Server::new_async().await;
        let _mock = server
            .mock("GET", "/v1/search")
            .match_query(mockito::Matcher::Any)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(search_response_json(&[
                ("t1", "Song", "Artist", "Album", 90),
                ("t2", "Song", "Artist", "Album", 80),
                ("t3", "Song", "Artist", "Album", 70),
                ("t4", "Song", "Artist", "Album", 60),
                ("t5", "Song", "Artist", "Album", 50),
                ("t6", "Song", "Artist", "Album", 40),
                ("t7", "Song", "Artist", "Album", 30),
            ]))
            .create_async()
            .await;

        let track = make_track("Artist", "Song", Some("Album"));
        let result = match_single_track(&server.url(), "fake_token", &track, 50, None).await;
        // Should be truncated to 5 candidates
        assert!(result.candidates.len() <= 5);
        // Should be sorted by score descending
        for w in result.candidates.windows(2) {
            assert!(w[0].score >= w[1].score);
        }
    }

    #[tokio::test]
    async fn test_match_single_track_search_error_returns_not_found() {
        let mut server = mockito::Server::new_async().await;
        let _mock = server
            .mock("GET", "/v1/search")
            .match_query(mockito::Matcher::Any)
            .with_status(500)
            .with_body("error")
            .create_async()
            .await;

        let track = make_track("Artist", "Song", None);
        let result = match_single_track(&server.url(), "fake_token", &track, 80, None).await;
        assert!(matches!(result.status, MatchStatus::NotFound));
        assert!(result.candidates.is_empty());
    }
}
