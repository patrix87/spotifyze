export interface TrackInfo {
  path: string;
  file_name: string;
  artist: string;
  title: string;
  album: string | null;
  album_artist: string | null;
  track_number: number | null;
  year: number | null;
}

export interface SkippedFile {
  path: string;
  reason: string;
}

export interface ScanResult {
  tracks: TrackInfo[];
  skipped: SkippedFile[];
}

export interface MatchCandidate {
  spotify_uri: string;
  name: string;
  artist: string;
  album: string;
  album_type: string | null;
  release_year: string | null;
  popularity: number;
  score: number;
  external_url: string | null;
  preview_url: string | null;
}

export type MatchStatus = "AutoMatched" | "NeedsReview" | "NotFound";

export interface MatchResult {
  track: TrackInfo;
  status: MatchStatus;
  candidates: MatchCandidate[];
  selected_uri: string | null;
}

export interface PlaylistResult {
  playlist_id: string;
  playlist_url: string;
  tracks_added: number;
}

export interface UserProfile {
  display_name: string | null;
  id: string;
  images: { url: string; height: number | null; width: number | null }[];
}

export interface FolderEntry {
  path: string;
  name: string;
  source: "folder" | "playlist";
  scanResult: ScanResult | null;
  matchResults: MatchResult[] | null;
  playlistResult: PlaylistResult | null;
}

export type WizardStep = "connect" | "folders" | "review" | "done";
