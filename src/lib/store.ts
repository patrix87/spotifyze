import { create } from "zustand";
import type {
  FolderEntry,
  MatchResult,
  PlaylistResult,
  UserProfile,
  WizardStep,
} from "./types";

interface AppState {
  // Wizard
  step: WizardStep;
  setStep: (step: WizardStep) => void;

  // Auth
  profile: UserProfile | null;
  setProfile: (profile: UserProfile | null) => void;

  // Folders
  folders: FolderEntry[];
  addFolder: (path: string) => void;
  addPlaylist: (path: string) => void;
  removeFolder: (path: string) => void;
  updateFolderName: (path: string, name: string) => void;
  setScanResult: (
    path: string,
    result: { tracks: FolderEntry["scanResult"] }
  ) => void;
  setMatchResults: (path: string, results: MatchResult[]) => void;
  setPlaylistResult: (path: string, result: PlaylistResult) => void;
  resetFolders: () => void;

  // Options
  recursive: boolean;
  setRecursive: (value: boolean) => void;
  confidence: number;
  setConfidence: (value: number) => void;

  // Match overrides
  updateSelectedUri: (
    folderPath: string,
    trackPath: string,
    uri: string | null
  ) => void;
  updateCandidates: (
    folderPath: string,
    trackPath: string,
    candidates: MatchResult["candidates"]
  ) => void;
}

function folderNameFromPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

export const useAppStore = create<AppState>((set) => ({
  step: "connect",
  setStep: (step) => set({ step }),

  profile: null,
  setProfile: (profile) => set({ profile }),

  folders: [],
  addFolder: (path) =>
    set((state) => {
      if (state.folders.some((f) => f.path === path)) return state;
      return {
        folders: [
          ...state.folders,
          {
            path,
            name: folderNameFromPath(path),
            source: "folder",
            scanResult: null,
            matchResults: null,
            playlistResult: null,
          },
        ],
      };
    }),
  addPlaylist: (path) =>
    set((state) => {
      if (state.folders.some((f) => f.path === path)) return state;
      // Strip .m3u/.m3u8 extension for playlist name
      const rawName = folderNameFromPath(path);
      const name = rawName.replace(/\.m3u8?$/i, "");
      return {
        folders: [
          ...state.folders,
          {
            path,
            name,
            source: "playlist",
            scanResult: null,
            matchResults: null,
            playlistResult: null,
          },
        ],
      };
    }),
  removeFolder: (path) =>
    set((state) => ({
      folders: state.folders.filter((f) => f.path !== path),
    })),
  updateFolderName: (path, name) =>
    set((state) => ({
      folders: state.folders.map((f) =>
        f.path === path ? { ...f, name } : f
      ),
    })),
  setScanResult: (path, result) =>
    set((state) => ({
      folders: state.folders.map((f) =>
        f.path === path ? { ...f, scanResult: result.tracks } : f
      ),
    })),
  setMatchResults: (path, results) =>
    set((state) => ({
      folders: state.folders.map((f) =>
        f.path === path ? { ...f, matchResults: results } : f
      ),
    })),
  setPlaylistResult: (path, result) =>
    set((state) => ({
      folders: state.folders.map((f) =>
        f.path === path ? { ...f, playlistResult: result } : f
      ),
    })),
  resetFolders: () =>
    set({
      folders: [],
    }),

  recursive: false,
  setRecursive: (value) => set({ recursive: value }),
  confidence: 80,
  setConfidence: (value) => set({ confidence: value }),

  updateSelectedUri: (folderPath, trackPath, uri) =>
    set((state) => ({
      folders: state.folders.map((f) => {
        if (f.path !== folderPath || !f.matchResults) return f;
        return {
          ...f,
          matchResults: f.matchResults.map((mr) => {
            if (mr.track.path !== trackPath) return mr;
            return {
              ...mr,
              selected_uri: uri,
            };
          }),
        };
      }),
    })),

  updateCandidates: (folderPath, trackPath, candidates) =>
    set((state) => ({
      folders: state.folders.map((f) => {
        if (f.path !== folderPath || !f.matchResults) return f;
        return {
          ...f,
          matchResults: f.matchResults.map((mr) => {
            if (mr.track.path !== trackPath) return mr;
            return {
              ...mr,
              candidates,
              selected_uri: null,
              status: candidates.length > 0 ? ("NeedsReview" as const) : ("NotFound" as const),
            };
          }),
        };
      }),
    })),
}));
