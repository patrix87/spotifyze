import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAppStore } from "../lib/store";
import type { ScanResult, MatchResult } from "../lib/types";

export function FolderStep() {
  const {
    folders,
    addFolder,
    addPlaylist,
    removeFolder,
    updateFolderName,
    recursive,
    setRecursive,
    setStep,
    setMatchResults,
    confidence,
  } = useAppStore();
  const [scanning, setScanning] = useState(false);
  const [matching, setMatching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanResults, setScanResults] = useState<Map<string, ScanResult>>(
    new Map()
  );
  const [matchProgress, setMatchProgress] = useState<{
    current: number;
    total: number;
    artist: string;
    title: string;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const activeGenRef = useRef(0);

  useEffect(() => {
    const gen = activeGenRef.current;
    const unlisten = listen<{
      current: number;
      total: number;
      artist: string;
      title: string;
    }>("match-progress", (event) => {
      if (activeGenRef.current === gen) {
        setMatchProgress(event.payload);
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [matching]);

  // Drag-and-drop from OS
  useEffect(() => {
    if (scanning || matching) return;
    const unlisten = getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type === "over") {
        setDragging(true);
      } else if (event.payload.type === "drop") {
        setDragging(false);
        for (const path of event.payload.paths) {
          const lower = path.toLowerCase();
          if (lower.endsWith(".m3u") || lower.endsWith(".m3u8")) {
            addPlaylist(path);
          } else {
            // Check if the last segment has a file extension
            const lastSegment = path.split(/[/\\]/).pop() ?? "";
            if (!lastSegment.includes(".")) {
              addFolder(path);
            }
            // Silently ignore non-playlist files
          }
        }
      } else {
        setDragging(false);
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [scanning, matching, addFolder, addPlaylist]);

  async function handleAddFolder() {
    const selected = await open({ directory: true, multiple: true });
    if (selected) {
      const paths = Array.isArray(selected) ? selected : [selected];
      for (const p of paths) {
        if (typeof p === "string") addFolder(p);
      }
    }
  }

  async function handleAddPlaylist() {
    const selected = await open({
      directory: false,
      multiple: true,
      filters: [{ name: "Playlists", extensions: ["m3u", "m3u8"] }],
    });
    if (selected) {
      const paths = Array.isArray(selected) ? selected : [selected];
      for (const p of paths) {
        if (typeof p === "string") addPlaylist(p);
      }
    }
  }

  async function handleCancel() {
    activeGenRef.current += 1;
    setScanning(false);
    setMatching(false);
    setMatchProgress(null);
    try {
      await invoke("cancel_matching");
    } catch {
      // Best-effort cancellation
    }
  }

  async function handleScanAndMatch() {
    activeGenRef.current += 1;
    const gen = activeGenRef.current;
    setError(null);
    setScanResults(new Map());
    setMatchProgress(null);
    setScanning(true);
    try {
      const folderEntries = folders.filter((f) => f.source === "folder");
      const playlistEntries = folders.filter((f) => f.source === "playlist");

      // Scan folders and playlists in parallel
      const [folderResults, playlistResults] = await Promise.all([
        folderEntries.length > 0
          ? invoke<ScanResult[]>("scan_folders", {
              paths: folderEntries.map((f) => f.path),
              recursive,
            })
          : Promise.resolve([] as ScanResult[]),
        playlistEntries.length > 0
          ? invoke<ScanResult[]>("scan_playlists", {
              paths: playlistEntries.map((f) => f.path),
            })
          : Promise.resolve([] as ScanResult[]),
      ]);

      if (activeGenRef.current !== gen) return;

      const resultMap = new Map<string, ScanResult>();
      folderEntries.forEach((f, i) => {
        resultMap.set(f.path, folderResults[i]);
      });
      playlistEntries.forEach((f, i) => {
        resultMap.set(f.path, playlistResults[i]);
      });
      setScanResults(resultMap);

      // Check if any source produced tracks
      const totalTracks = Array.from(resultMap.values()).reduce(
        (sum, sr) => sum + sr.tracks.length,
        0
      );
      const allSkipped = Array.from(resultMap.values()).flatMap((sr) => sr.skipped);

      if (totalTracks === 0) {
        const message =
          allSkipped.length > 0
            ? `No tracks found. ${allSkipped.length} file(s) skipped:\n${allSkipped
                .map((s) => `${s.path.split(/[/\\]/).pop()}: ${s.reason}`)
                .join("\n")}`
            : "No tracks found in the selected sources.";
        setError(message);
        setScanning(false);
        return;
      }

      // Now match all tracks per folder
      setScanning(false);
      setMatching(true);
      setMatchProgress(null);

      for (const folder of folders) {
        if (activeGenRef.current !== gen) return;

        const sr = resultMap.get(folder.path);
        if (!sr || sr.tracks.length === 0) continue;

        const matches = await invoke<MatchResult[]>("match_tracks", {
          tracks: sr.tracks,
          confidence,
        });

        if (activeGenRef.current !== gen) return;

        setMatchResults(folder.path, matches);
      }

      if (activeGenRef.current === gen) setStep("review");
    } catch (e) {
      if (activeGenRef.current === gen) setError(String(e));
    } finally {
      if (activeGenRef.current === gen) {
        setScanning(false);
        setMatching(false);
      }
    }
  }

  return (
    <div className="flex flex-col gap-6 pt-4 relative">
      {/* Drag overlay */}
      {dragging && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-green-500 bg-green-500/10 pointer-events-none">
          <p className="text-green-400 text-lg font-medium">Drop folders or playlists here</p>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Add Music</h2>
          <p className="text-sm text-zinc-400 mt-1">
            Add folders or playlist files containing your music
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleAddPlaylist}
            disabled={scanning || matching}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 rounded text-sm font-medium transition-colors"
          >
            + Add Playlist
          </button>
          <button
            onClick={handleAddFolder}
            disabled={scanning || matching}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 rounded text-sm font-medium transition-colors"
          >
            + Add Folder
          </button>
        </div>
      </div>

      {/* Folder list */}
      {folders.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 border border-dashed border-zinc-700 rounded-lg">
          <p className="text-zinc-500 text-sm">Drop folders or playlists here, or</p>
          <div className="flex gap-3 mt-2">
            <button
              onClick={handleAddPlaylist}
              className="text-green-400 text-sm hover:text-green-300"
            >
              Add a playlist
            </button>
            <span className="text-zinc-600">|</span>
            <button
              onClick={handleAddFolder}
              className="text-green-400 text-sm hover:text-green-300"
            >
              Add a folder
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {folders.map((folder) => (
            <div
              key={folder.path}
              className="flex items-center gap-3 bg-zinc-900 rounded-lg px-4 py-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500" title={folder.source === "playlist" ? "Playlist file" : "Folder"}>
                    {folder.source === "playlist" ? "🎵" : "📁"}
                  </span>
                  <input
                    type="text"
                    value={folder.name}
                    onChange={(e) =>
                      updateFolderName(folder.path, e.target.value)
                    }
                    className="bg-transparent font-medium text-sm w-full focus:outline-none focus:underline"
                    title="Playlist name (editable)"
                  />
                </div>
                <p className="text-xs text-zinc-500 truncate">{folder.path}</p>
                {scanResults.has(folder.path) && (
                  <p className="text-xs text-zinc-400 mt-1">
                    {scanResults.get(folder.path)!.tracks.length} tracks found
                    {scanResults.get(folder.path)!.skipped.length > 0 && (
                      <span
                        className="text-yellow-500 cursor-help ml-1"
                        title={scanResults
                          .get(folder.path)!
                          .skipped.map(
                            (s) => `${s.path.split(/[/\\]/).pop()}: ${s.reason}`
                          )
                          .join("\n")}
                      >
                        ({scanResults.get(folder.path)!.skipped.length} skipped — hover for details)
                      </span>
                    )}
                  </p>
                )}
              </div>
              <button
                onClick={() => removeFolder(folder.path)}
                disabled={scanning || matching}
                className="text-zinc-500 hover:text-red-400 transition-colors p-1"
                title="Remove"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Options */}
      <div className="flex items-center justify-between bg-zinc-900 rounded-lg px-4 py-3">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={recursive}
            onChange={(e) => setRecursive(e.target.checked)}
            className="rounded border-zinc-600"
          />
          Include subfolders
        </label>
        <button
          onClick={async () => {
            try {
              await invoke("clear_match_cache");
              setScanResults(new Map());
              setError(null);
            } catch (e) {
              setError(String(e));
            }
          }}
          disabled={scanning || matching}
          className="text-xs text-zinc-500 hover:text-yellow-400 disabled:opacity-50 transition-colors"
          title="Clear cached match results so tracks are re-matched from Spotify"
        >
          Clear match cache
        </button>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded-lg p-3 text-sm text-red-300 whitespace-pre-line">
          {error}
        </div>
      )}

      {/* Scanning indicator */}
      {scanning && (
        <div className="bg-zinc-900 rounded-lg px-4 py-3 text-sm text-zinc-300">
          Scanning files…
        </div>
      )}

      {/* Matching progress */}
      {matching && matchProgress && (
        <div className="bg-zinc-900 rounded-lg px-4 py-3 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-300 truncate">
              {matchProgress.current > 0
                ? `Matching: ${matchProgress.artist} — ${matchProgress.title}`
                : "Starting…"}
            </span>
            <span className="text-zinc-500 ml-2 shrink-0">
              {matchProgress.current}/{matchProgress.total}
            </span>
          </div>
          <div className="w-full bg-zinc-800 rounded-full h-2 overflow-hidden">
            <div
              className="bg-green-500 h-2 rounded-full transition-all duration-300 ease-out"
              style={{
                width: `${(matchProgress.current / matchProgress.total) * 100}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-2">
        <button
          onClick={() => setStep("connect")}
          disabled={scanning || matching}
          className="text-sm text-zinc-400 hover:text-white disabled:opacity-50 transition-colors"
        >
          ← Back
        </button>
        {scanning || matching ? (
          <button
            onClick={handleCancel}
            className="px-6 py-2 bg-red-600 hover:bg-red-500 rounded-lg font-medium text-sm transition-colors"
          >
            Cancel
          </button>
        ) : (
          <button
            onClick={handleScanAndMatch}
            disabled={folders.length === 0}
            className="px-6 py-2 bg-green-600 hover:bg-green-500 disabled:bg-zinc-700 disabled:text-zinc-500 rounded-lg font-medium text-sm transition-colors"
          >
            Scan & Match
          </button>
        )}
      </div>
    </div>
  );
}
