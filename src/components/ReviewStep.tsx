import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../lib/store";
import type { MatchResult, MatchCandidate, PlaylistResult } from "../lib/types";

export function ReviewStep() {
  const {
    folders,
    updateSelectedUri,
    isPublic,
    setIsPublic,
    setStep,
  } = useAppStore();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedTrack, setExpandedTrack] = useState<string | null>(null);

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
          public: isPublic,
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

  function getStatusIcon(status: string) {
    switch (status) {
      case "AutoMatched":
        return "✓";
      case "NeedsReview":
        return "?";
      case "NotFound":
        return "✕";
      default:
        return "·";
    }
  }

  function getStatusColor(status: string) {
    switch (status) {
      case "AutoMatched":
        return "text-green-400";
      case "NeedsReview":
        return "text-yellow-400";
      case "NotFound":
        return "text-red-400";
      default:
        return "text-zinc-400";
    }
  }

  function renderTrackRow(
    folderPath: string,
    match_result: MatchResult,
    index: number
  ) {
    const isExpanded =
      expandedTrack === `${folderPath}:${match_result.track.path}`;
    const hasMultiple = match_result.candidates.length > 1;

    return (
      <div key={`${folderPath}:${match_result.track.path}`}>
        <div
          className={`flex items-center gap-3 px-3 py-2 hover:bg-zinc-800/50 rounded cursor-pointer
            ${isExpanded ? "bg-zinc-800/50" : ""}`}
          onClick={() =>
            hasMultiple &&
            setExpandedTrack(
              isExpanded
                ? null
                : `${folderPath}:${match_result.track.path}`
            )
          }
        >
          <span className="text-xs text-zinc-600 w-6 text-right">
            {index + 1}
          </span>
          <span
            className={`text-sm font-mono ${getStatusColor(match_result.status)}`}
            title={match_result.status}
          >
            {getStatusIcon(match_result.status)}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm truncate">
              <span className="text-zinc-300">{match_result.track.artist}</span>
              <span className="text-zinc-600"> — </span>
              <span className="text-zinc-200">{match_result.track.title}</span>
            </p>
            {match_result.selected_uri && match_result.candidates[0] && (
              <p className="text-xs text-zinc-500 truncate">
                → {match_result.candidates[0].artist} —{" "}
                {match_result.candidates[0].name}
                {match_result.candidates[0].album_type &&
                  ` (${match_result.candidates[0].album_type})`}
                <span className="ml-2 text-zinc-600">
                  Score: {match_result.candidates[0].score}
                </span>
              </p>
            )}
          </div>
          {hasMultiple && (
            <span className="text-xs text-zinc-600">
              {match_result.candidates.length} matches
            </span>
          )}
        </div>

        {/* Expanded candidate list */}
        {isExpanded && (
          <div className="ml-12 mr-3 mb-2 space-y-1">
            {match_result.candidates.map((c: MatchCandidate) => (
              <button
                key={c.spotify_uri}
                onClick={() =>
                  updateSelectedUri(
                    folderPath,
                    match_result.track.path,
                    c.spotify_uri
                  )
                }
                className={`w-full text-left px-3 py-2 rounded text-sm flex items-center gap-3 transition-colors
                  ${match_result.selected_uri === c.spotify_uri
                    ? "bg-green-900/30 border border-green-800"
                    : "bg-zinc-800/50 hover:bg-zinc-800 border border-transparent"
                  }`}
              >
                <span className="text-green-400 font-mono text-xs w-8">
                  {c.score}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="truncate">
                    {c.artist} — {c.name}
                  </p>
                  <p className="text-xs text-zinc-500 truncate">
                    {c.album}
                    {c.album_type && ` (${c.album_type})`}
                    {c.release_year && ` · ${c.release_year}`}
                    {` · Pop: ${c.popularity}`}
                  </p>
                </div>
                {match_result.selected_uri === c.spotify_uri && (
                  <span className="text-green-400 text-xs">Selected</span>
                )}
              </button>
            ))}
            <button
              onClick={() =>
                updateSelectedUri(
                  folderPath,
                  match_result.track.path,
                  null
                )
              }
              className="w-full text-left px-3 py-2 rounded text-sm text-zinc-500 hover:text-zinc-300 bg-zinc-800/30 hover:bg-zinc-800 transition-colors"
            >
              Skip this track
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

  return (
    <div className="flex flex-col gap-6 pt-4">
      <div>
        <h2 className="text-xl font-bold">Review Matches</h2>
        <p className="text-sm text-zinc-400 mt-1">
          {totalSelected} of {totalTracks} tracks matched
          {needsReview > 0 && ` · ${needsReview} need review`}
        </p>
      </div>

      {/* Legend */}
      <div className="flex gap-4 text-xs">
        <span className="text-green-400">✓ Auto-matched</span>
        <span className="text-yellow-400">? Needs review</span>
        <span className="text-red-400">✕ Not found</span>
      </div>

      {/* Folder sections */}
      {foldersWithMatches.map((folder) => (
        <div key={folder.path} className="space-y-1">
          <h3 className="text-sm font-semibold text-zinc-300 px-3">
            {folder.name}
          </h3>
          {folder.matchResults!.map((mr, i) =>
            renderTrackRow(folder.path, mr, i)
          )}
        </div>
      ))}

      {/* Options */}
      <div className="flex items-center gap-4 bg-zinc-900 rounded-lg px-4 py-3">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
            className="rounded border-zinc-600"
          />
          Make playlist public
        </label>
      </div>

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
