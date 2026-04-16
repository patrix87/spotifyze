import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../lib/store";
import type { ScanResult, MatchResult } from "../lib/types";

export function FolderStep() {
  const {
    folders,
    addFolder,
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

  async function handleAddFolder() {
    const selected = await open({ directory: true, multiple: true });
    if (selected) {
      const paths = Array.isArray(selected) ? selected : [selected];
      for (const p of paths) {
        if (typeof p === "string") addFolder(p);
      }
    }
  }

  async function handleScanAndMatch() {
    setError(null);
    setScanning(true);
    try {
      const paths = folders.map((f) => f.path);
      const results = await invoke<ScanResult[]>("scan_folders", {
        paths,
        recursive,
      });

      const resultMap = new Map<string, ScanResult>();
      folders.forEach((f, i) => {
        resultMap.set(f.path, results[i]);
      });
      setScanResults(resultMap);

      // Now match all tracks per folder
      setScanning(false);
      setMatching(true);

      for (const folder of folders) {
        const sr = resultMap.get(folder.path);
        if (!sr || sr.tracks.length === 0) continue;

        const matches = await invoke<MatchResult[]>("match_tracks", {
          tracks: sr.tracks,
          confidence,
        });
        setMatchResults(folder.path, matches);
      }

      setStep("review");
    } catch (e) {
      setError(String(e));
    } finally {
      setScanning(false);
      setMatching(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 pt-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Select Folders</h2>
          <p className="text-sm text-zinc-400 mt-1">
            Pick folders containing your music files
          </p>
        </div>
        <button
          onClick={handleAddFolder}
          disabled={scanning || matching}
          className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 rounded text-sm font-medium transition-colors"
        >
          + Add Folder
        </button>
      </div>

      {/* Folder list */}
      {folders.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 border border-dashed border-zinc-700 rounded-lg">
          <p className="text-zinc-500 text-sm">No folders selected</p>
          <button
            onClick={handleAddFolder}
            className="mt-2 text-green-400 text-sm hover:text-green-300"
          >
            Add a folder to get started
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {folders.map((folder) => (
            <div
              key={folder.path}
              className="flex items-center gap-3 bg-zinc-900 rounded-lg px-4 py-3"
            >
              <div className="flex-1 min-w-0">
                <input
                  type="text"
                  value={folder.name}
                  onChange={(e) =>
                    updateFolderName(folder.path, e.target.value)
                  }
                  className="bg-transparent font-medium text-sm w-full focus:outline-none focus:underline"
                  title="Playlist name (editable)"
                />
                <p className="text-xs text-zinc-500 truncate">{folder.path}</p>
                {scanResults.has(folder.path) && (
                  <p className="text-xs text-zinc-400 mt-1">
                    {scanResults.get(folder.path)!.tracks.length} tracks found
                    {scanResults.get(folder.path)!.skipped.length > 0 &&
                      `, ${scanResults.get(folder.path)!.skipped.length} skipped`}
                  </p>
                )}
              </div>
              <button
                onClick={() => removeFolder(folder.path)}
                disabled={scanning || matching}
                className="text-zinc-500 hover:text-red-400 transition-colors p-1"
                title="Remove folder"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Options */}
      <div className="flex items-center gap-4 bg-zinc-900 rounded-lg px-4 py-3">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={recursive}
            onChange={(e) => setRecursive(e.target.checked)}
            className="rounded border-zinc-600"
          />
          Scan subfolders recursively
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
          onClick={() => setStep("connect")}
          className="text-sm text-zinc-400 hover:text-white transition-colors"
        >
          ← Back
        </button>
        <button
          onClick={handleScanAndMatch}
          disabled={folders.length === 0 || scanning || matching}
          className="px-6 py-2 bg-green-600 hover:bg-green-500 disabled:bg-zinc-700 disabled:text-zinc-500 rounded-lg font-medium text-sm transition-colors"
        >
          {scanning
            ? "Scanning..."
            : matching
              ? "Matching tracks..."
              : "Scan & Match"}
        </button>
      </div>
    </div>
  );
}
