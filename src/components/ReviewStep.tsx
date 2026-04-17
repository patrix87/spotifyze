import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../lib/store";
import type { MatchResult, MatchCandidate, PlaylistResult } from "../lib/types";

export function ReviewStep() {
  const {
    folders,
    updateSelectedUri,
    updateCandidates,
    updateFolderName,
    setStep,
  } = useAppStore();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedTrack, setExpandedTrack] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [playingUri, setPlayingUri] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "NotFound" | "NeedsReview" | "AutoMatched">("all");
  const [sortBy, setSortBy] = useState<"status" | "alpha">("status");
  const [reviewedTracks] = useState(() => new Set<string>());
  const [skippedTracks, setSkippedTracks] = useState(() => new Set<string>());
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  function stopPlayback() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingUri(null);
  }

  function togglePreview(previewUrl: string, uri: string) {
    if (playingUri === uri) {
      stopPlayback();
      return;
    }
    stopPlayback();
    const audio = new Audio(previewUrl);
    audio.volume = 0.5;
    audio.onended = () => setPlayingUri(null);
    audio.play();
    audioRef.current = audio;
    setPlayingUri(uri);
  }

  async function toggleLocalPreview(trackPath: string) {
    const key = `local:${trackPath}`;
    if (playingUri === key) {
      stopPlayback();
      return;
    }
    stopPlayback();
    try {
      const result = await invoke<{ data: string; mime: string }>(
        "read_audio_file",
        { path: trackPath }
      );
      const audio = new Audio(`data:${result.mime};base64,${result.data}`);
      audio.volume = 0.5;
      audio.onended = () => setPlayingUri(null);
      audio.play();
      audioRef.current = audio;
      setPlayingUri(key);
    } catch (err) {
      console.error("Failed to play local file:", err);
    }
  }

  function openInSpotify(externalUrl: string) {
    // Try opening in Spotify desktop via spotify: URI protocol, fall back to browser
    invoke("open_spotify_uri", { url: externalUrl }).catch(() => {
      window.open(externalUrl, "_blank");
    });
  }

  const foldersWithMatches = folders.filter(
    (f) => f.matchResults && f.matchResults.length > 0
  );

  async function handleCreatePlaylists() {
    setError(null);
    setCreating(true);
    try {
      for (const folder of foldersWithMatches) {
        const uris = folder.matchResults!
          .filter((mr) => mr.selected_uri)
          .map((mr) => mr.selected_uri!);

        if (uris.length === 0) continue;

        const result = await invoke<PlaylistResult>("create_playlist", {
          name: folder.name,
          uris,
        });
        useAppStore.getState().setPlaylistResult(folder.path, result);
      }
      setStep("done");
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  }

  const statusOrder: Record<string, number> = {
    NotFound: 0,
    NeedsReview: 1,
    AutoMatched: 2,
  };

  function sortAndFilter(results: MatchResult[]): MatchResult[] {
    let filtered = filter === "all"
      ? results
      : results.filter((mr) => mr.status === filter);

    return [...filtered].sort((a, b) => {
      if (sortBy === "status") {
        const sa = statusOrder[a.status] ?? 3;
        const sb = statusOrder[b.status] ?? 3;
        if (sa !== sb) return sa - sb;
      }
      const nameA = `${a.track.artist} ${a.track.title}`.toLowerCase();
      const nameB = `${b.track.artist} ${b.track.title}`.toLowerCase();
      return nameA.localeCompare(nameB);
    });
  }

  function getDisplayState(trackKey: string, status: string): { icon: string; color: string; label: string } {
    if (skippedTracks.has(trackKey)) {
      return { icon: "⊘", color: "text-zinc-500", label: "Skipped" };
    }
    if (status === "NeedsReview" && reviewedTracks.has(trackKey)) {
      return { icon: "✓", color: "text-yellow-400", label: "Reviewed" };
    }
    switch (status) {
      case "AutoMatched":
        return { icon: "✓", color: "text-green-400", label: "Auto-matched" };
      case "NeedsReview":
        return { icon: "?", color: "text-yellow-400", label: "Needs review" };
      case "NotFound":
        return { icon: "✕", color: "text-red-400", label: "Not found" };
      default:
        return { icon: "·", color: "text-zinc-400", label: status };
    }
  }

  function handleSelect(folderPath: string, trackPath: string, uri: string) {
    const trackKey = `${folderPath}:${trackPath}`;
    reviewedTracks.add(trackKey);
    skippedTracks.delete(trackKey);
    setSkippedTracks(new Set(skippedTracks));
    updateSelectedUri(folderPath, trackPath, uri);
  }

  function handleSkip(folderPath: string, trackPath: string) {
    const trackKey = `${folderPath}:${trackPath}`;
    reviewedTracks.add(trackKey);
    skippedTracks.add(trackKey);
    setSkippedTracks(new Set(skippedTracks));
    updateSelectedUri(folderPath, trackPath, null);
  }

  function renderTrackRow(
    folderPath: string,
    match_result: MatchResult,
    index: number
  ) {
    const isExpanded =
      expandedTrack === `${folderPath}:${match_result.track.path}`;
    const hasMultiple = match_result.candidates.length > 1;
    const trackKey = `${folderPath}:${match_result.track.path}`;
    const display = getDisplayState(trackKey, match_result.status);
    const isSkipped = skippedTracks.has(trackKey);

    async function handleManualSearch(e: React.FormEvent) {
      e.preventDefault();
      if (!searchQuery.trim()) return;
      setSearching(true);
      try {
        const results = await invoke<MatchCandidate[]>("search_manual", {
          query: searchQuery.trim(),
        });
        updateCandidates(folderPath, match_result.track.path, results);
      } catch (err) {
        setError(String(err));
      } finally {
        setSearching(false);
      }
    }

    return (
      <div key={trackKey}>
        <div
          className={`flex items-center gap-3 px-3 py-2 hover:bg-zinc-800/50 rounded cursor-pointer
            ${isExpanded ? "bg-zinc-800/50" : ""}`}
          onClick={() => {
            const newExpanded = isExpanded ? null : trackKey;
            setExpandedTrack(newExpanded);
            if (newExpanded) {
              setSearchQuery(
                `${match_result.track.artist} ${match_result.track.title}`
              );
            }
          }}
        >
          <span className="text-xs text-zinc-600 w-6 text-right">
            {index + 1}
          </span>
          <span
            className={`text-sm font-mono ${display.color}`}
            title={display.label}
          >
            {display.icon}
          </span>
          <div className={`flex-1 min-w-0 ${isSkipped ? "opacity-40" : ""}`}>
            <p className="text-sm truncate">
              <span className="text-zinc-300">{match_result.track.artist}</span>
              <span className="text-zinc-600"> — </span>
              <span className="text-zinc-200">{match_result.track.title}</span>
            </p>
            {match_result.selected_uri && (() => {
              const sel = match_result.candidates.find(c => c.spotify_uri === match_result.selected_uri) ?? match_result.candidates[0];
              return sel ? (
                <p className="text-xs text-zinc-500 truncate">
                  → {sel.artist} — {sel.name}
                  {sel.album_type && ` (${sel.album_type})`}
                  <span className="ml-2 text-zinc-600">
                    Score: {sel.score}
                  </span>
                </p>
              ) : null;
            })()}
          </div>
          {hasMultiple && (
            <span className="text-xs text-zinc-600">
              {match_result.candidates.length} matches
            </span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleLocalPreview(match_result.track.path);
            }}
            className={`p-1.5 rounded transition-colors shrink-0 ${
              playingUri === `local:${match_result.track.path}`
                ? "bg-blue-600 text-white"
                : "bg-zinc-700/50 hover:bg-zinc-700 text-zinc-400"
            }`}
            title={
              playingUri === `local:${match_result.track.path}`
                ? "Stop local preview"
                : "Play local file"
            }
          >
            {playingUri === `local:${match_result.track.path}` ? (
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
        </div>

        {/* Expanded candidate list */}
        {isExpanded && (
          <div className="ml-12 mr-3 mb-2 space-y-1">
            {/* Manual search */}
            <form
              onSubmit={handleManualSearch}
              className="flex gap-2 mb-2"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search Spotify..."
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-green-600"
              />
              <button
                type="submit"
                disabled={searching || !searchQuery.trim()}
                className="px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:bg-zinc-700 disabled:text-zinc-500 rounded text-sm font-medium transition-colors"
              >
                {searching ? "..." : "Search"}
              </button>
            </form>

            {match_result.candidates.map((c: MatchCandidate) => (
              <div
                key={c.spotify_uri}
                className={`w-full text-left px-3 py-2 rounded text-sm flex items-center gap-3 transition-colors
                  ${match_result.selected_uri === c.spotify_uri
                    ? "bg-green-900/30 border border-green-800"
                    : "bg-zinc-800/50 hover:bg-zinc-800 border border-transparent"
                  }`}
              >
                <span className="text-green-400 font-mono text-xs w-8">
                  {c.score}
                </span>
                <button
                  className="flex-1 min-w-0 text-left"
                  onClick={() =>
                    handleSelect(
                      folderPath,
                      match_result.track.path,
                      c.spotify_uri
                    )
                  }
                >
                  <p className="truncate">
                    {c.artist} — {c.name}
                  </p>
                  <p className="text-xs text-zinc-500 truncate">
                    {c.album}
                    {c.album_type && ` (${c.album_type})`}
                    {c.release_year && ` · ${c.release_year}`}
                    {` · Pop: ${c.popularity}`}
                  </p>
                </button>
                <div className="flex items-center gap-1.5 shrink-0">
                  {c.preview_url && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        togglePreview(c.preview_url!, c.spotify_uri);
                      }}
                      className={`p-1.5 rounded transition-colors ${
                        playingUri === c.spotify_uri
                          ? "bg-green-600 text-white"
                          : "bg-zinc-700 hover:bg-zinc-600 text-zinc-300"
                      }`}
                      title={playingUri === c.spotify_uri ? "Stop preview" : "Play 30s preview"}
                    >
                      {playingUri === c.spotify_uri ? (
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                          <rect x="6" y="4" width="4" height="16" />
                          <rect x="14" y="4" width="4" height="16" />
                        </svg>
                      ) : (
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      )}
                    </button>
                  )}
                  {c.external_url && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openInSpotify(c.external_url!);
                      }}
                      className="p-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors"
                      title="Open in Spotify"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                      </svg>
                    </button>
                  )}
                </div>
                {match_result.selected_uri === c.spotify_uri && (
                  <span className="text-green-400 text-xs shrink-0">Selected</span>
                )}
              </div>
            ))}
            <button
              onClick={() =>
                handleSkip(
                  folderPath,
                  match_result.track.path
                )
              }
              className={`w-full text-left px-3 py-2 rounded text-sm flex items-center gap-2 transition-colors ${
                isSkipped
                  ? "bg-zinc-800 border border-zinc-600 text-zinc-400"
                  : "text-zinc-500 hover:text-zinc-300 bg-zinc-800/30 hover:bg-zinc-800"
              }`}
            >
              <span className="font-mono text-xs">⊘</span>
              {isSkipped ? "Skipped" : "Skip this track"}
            </button>
          </div>
        )}
      </div>
    );
  }

  const totalSelected = foldersWithMatches.reduce(
    (sum, f) => sum + f.matchResults!.filter((mr) => mr.selected_uri).length,
    0
  );
  const totalTracks = foldersWithMatches.reduce(
    (sum, f) => sum + f.matchResults!.length,
    0
  );
  const needsReview = foldersWithMatches.reduce(
    (sum, f) =>
      sum +
      f.matchResults!.filter((mr) => mr.status === "NeedsReview").length,
    0
  );
  const notFoundCount = foldersWithMatches.reduce(
    (sum, f) =>
      sum +
      f.matchResults!.filter((mr) => mr.status === "NotFound").length,
    0
  );
  const autoMatchedCount = totalTracks - needsReview - notFoundCount;

  const filterButtons: { key: typeof filter; label: string; count: number; color: string }[] = [
    { key: "all", label: "All", count: totalTracks, color: "text-zinc-300" },
    { key: "NotFound", label: "✕ Missing", count: notFoundCount, color: "text-red-400" },
    { key: "NeedsReview", label: "? Unsure", count: needsReview, color: "text-yellow-400" },
    { key: "AutoMatched", label: "✓ Matched", count: autoMatchedCount, color: "text-green-400" },
  ];

  return (
    <div className="flex flex-col gap-6 pt-4">
      <div>
        <h2 className="text-xl font-bold">Review Matches</h2>
        <p className="text-sm text-zinc-400 mt-1">
          {totalSelected} of {totalTracks} tracks matched
          {needsReview > 0 && ` · ${needsReview} need review`}
        </p>
      </div>

      {/* Filter & Sort bar */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex gap-1">
          {filterButtons.map((fb) => (
            <button
              key={fb.key}
              onClick={() => setFilter(fb.key)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                filter === fb.key
                  ? "bg-zinc-700 " + fb.color
                  : "bg-zinc-800/50 text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {fb.label} ({fb.count})
            </button>
          ))}
        </div>
        <div className="flex gap-1 text-xs">
          <button
            onClick={() => setSortBy("status")}
            className={`px-2 py-1 rounded transition-colors ${
              sortBy === "status" ? "bg-zinc-700 text-zinc-200" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            By status
          </button>
          <button
            onClick={() => setSortBy("alpha")}
            className={`px-2 py-1 rounded transition-colors ${
              sortBy === "alpha" ? "bg-zinc-700 text-zinc-200" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            A–Z
          </button>
        </div>
      </div>

      {/* Folder sections */}
      {foldersWithMatches.map((folder) => {
        const sorted = sortAndFilter(folder.matchResults!);
        if (sorted.length === 0) return null;
        return (
          <div key={folder.path} className="space-y-1">
            <div className="flex items-center gap-2 px-3">
              <span className="text-xs text-zinc-500">Playlist:</span>
              <input
                type="text"
                value={folder.name}
                onChange={(e) =>
                  updateFolderName(folder.path, e.target.value)
                }
                className="flex-1 bg-transparent border-b border-zinc-700 focus:border-green-600 text-sm font-semibold text-zinc-300 py-0.5 outline-none transition-colors"
              />
            </div>
            {sorted.map((mr, i) =>
              renderTrackRow(folder.path, mr, i)
            )}
          </div>
        );
      })}

      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded-lg p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-2">
        <button
          onClick={() => setStep("folders")}
          className="text-sm text-zinc-400 hover:text-white transition-colors"
        >
          ← Back
        </button>
        <button
          onClick={handleCreatePlaylists}
          disabled={totalSelected === 0 || creating}
          className="px-6 py-2 bg-green-600 hover:bg-green-500 disabled:bg-zinc-700 disabled:text-zinc-500 rounded-lg font-medium text-sm transition-colors"
        >
          {creating
            ? "Creating..."
            : `Create ${foldersWithMatches.length > 1 ? "Playlists" : "Playlist"} (${totalSelected} tracks)`}
        </button>
      </div>
    </div>
  );
}
