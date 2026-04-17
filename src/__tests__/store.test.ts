import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAppStore } from "../lib/store";
import type { MatchResult, PlaylistResult, ScanResult } from "../lib/types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

describe("useAppStore", () => {
  beforeEach(() => {
    useAppStore.setState({
      step: "connect",
      profile: null,
      folders: [],
      recursive: false,
      confidence: 80,
    });
  });

  describe("step", () => {
    it("starts on connect step", () => {
      expect(useAppStore.getState().step).toBe("connect");
    });

    it("updates step", () => {
      useAppStore.getState().setStep("folders");
      expect(useAppStore.getState().step).toBe("folders");
    });
  });

  describe("profile", () => {
    it("starts with null profile", () => {
      expect(useAppStore.getState().profile).toBeNull();
    });

    it("sets profile", () => {
      const profile = { id: "u1", display_name: "User", images: [] };
      useAppStore.getState().setProfile(profile);
      expect(useAppStore.getState().profile).toEqual(profile);
    });

    it("clears profile", () => {
      useAppStore.getState().setProfile({ id: "u1", display_name: "User", images: [] });
      useAppStore.getState().setProfile(null);
      expect(useAppStore.getState().profile).toBeNull();
    });
  });

  describe("folders", () => {
    it("adds a folder", () => {
      useAppStore.getState().addFolder("/home/user/Music");
      const folders = useAppStore.getState().folders;
      expect(folders).toHaveLength(1);
      expect(folders[0].path).toBe("/home/user/Music");
      expect(folders[0].name).toBe("Music");
      expect(folders[0].source).toBe("folder");
    });

    it("extracts folder name from path", () => {
      useAppStore.getState().addFolder("/home/user/My Music/Rock");
      expect(useAppStore.getState().folders[0].name).toBe("Rock");
    });

    it("handles Windows paths", () => {
      useAppStore.getState().addFolder("C:\\Users\\Me\\Music\\Jazz");
      expect(useAppStore.getState().folders[0].name).toBe("Jazz");
    });

    it("prevents duplicate folders", () => {
      useAppStore.getState().addFolder("/music");
      useAppStore.getState().addFolder("/music");
      expect(useAppStore.getState().folders).toHaveLength(1);
    });

    it("removes a folder", () => {
      useAppStore.getState().addFolder("/music/a");
      useAppStore.getState().addFolder("/music/b");
      useAppStore.getState().removeFolder("/music/a");
      const folders = useAppStore.getState().folders;
      expect(folders).toHaveLength(1);
      expect(folders[0].path).toBe("/music/b");
    });

    it("updates folder name", () => {
      useAppStore.getState().addFolder("/music/rock");
      useAppStore.getState().updateFolderName("/music/rock", "Classic Rock");
      expect(useAppStore.getState().folders[0].name).toBe("Classic Rock");
    });

    it("adds a playlist", () => {
      useAppStore.getState().addPlaylist("/home/user/Road Trip.m3u");
      const folders = useAppStore.getState().folders;
      expect(folders).toHaveLength(1);
      expect(folders[0].path).toBe("/home/user/Road Trip.m3u");
      expect(folders[0].name).toBe("Road Trip");
      expect(folders[0].source).toBe("playlist");
    });

    it("strips .m3u8 extension from playlist name", () => {
      useAppStore.getState().addPlaylist("/home/user/Chill Vibes.m3u8");
      expect(useAppStore.getState().folders[0].name).toBe("Chill Vibes");
    });

    it("prevents duplicate playlists", () => {
      useAppStore.getState().addPlaylist("/home/user/mix.m3u");
      useAppStore.getState().addPlaylist("/home/user/mix.m3u");
      expect(useAppStore.getState().folders).toHaveLength(1);
    });

    it("sets scan result", () => {
      useAppStore.getState().addFolder("/music/rock");
      const scanResult: ScanResult = {
        tracks: [
          {
            path: "/a.mp3",
            file_name: "a.mp3",
            artist: "A",
            title: "Song A",
            album: null,
            album_artist: null,
            track_number: null,
            year: null,
          },
        ],
        skipped: [],
      };
      useAppStore.getState().setScanResult("/music/rock", { tracks: scanResult });
      expect(useAppStore.getState().folders[0].scanResult).toEqual(scanResult);
    });

    it("sets match results", () => {
      useAppStore.getState().addFolder("/music/rock");
      const results: MatchResult[] = [
        {
          track: {
            path: "/a.mp3",
            file_name: "a.mp3",
            artist: "A",
            title: "Song",
            album: null,
            album_artist: null,
            track_number: null,
            year: null,
          },
          status: "AutoMatched",
          candidates: [],
          selected_uri: "uri:1",
        },
      ];
      useAppStore.getState().setMatchResults("/music/rock", results);
      expect(useAppStore.getState().folders[0].matchResults).toEqual(results);
    });

    it("sets playlist result", () => {
      useAppStore.getState().addFolder("/music/rock");
      const result: PlaylistResult = {
        playlist_id: "pl1",
        playlist_url: "https://spotify.com/pl1",
        tracks_added: 5,
      };
      useAppStore.getState().setPlaylistResult("/music/rock", result);
      expect(useAppStore.getState().folders[0].playlistResult).toEqual(result);
    });

    it("resets folders", () => {
      useAppStore.getState().addFolder("/music/rock");
      useAppStore.getState().addFolder("/music/jazz");
      useAppStore.getState().resetFolders();
      expect(useAppStore.getState().folders).toEqual([]);
    });
  });

  describe("options", () => {
    it("toggles recursive", () => {
      useAppStore.getState().setRecursive(true);
      expect(useAppStore.getState().recursive).toBe(true);
    });

    it("sets confidence", () => {
      useAppStore.getState().setConfidence(90);
      expect(useAppStore.getState().confidence).toBe(90);
    });
  });

  describe("updateSelectedUri", () => {
    it("updates selected URI for a track", () => {
      useAppStore.getState().addFolder("/music/rock");
      useAppStore.getState().setMatchResults("/music/rock", [
        {
          track: {
            path: "/a.mp3",
            file_name: "a.mp3",
            artist: "A",
            title: "Song",
            album: null,
            album_artist: null,
            track_number: null,
            year: null,
          },
          status: "NeedsReview",
          candidates: [],
          selected_uri: "uri:1",
        },
      ]);
      useAppStore.getState().updateSelectedUri("/music/rock", "/a.mp3", "uri:2");
      const mr = useAppStore.getState().folders[0].matchResults![0];
      expect(mr.selected_uri).toBe("uri:2");
      expect(mr.status).toBe("NeedsReview");
    });

    it("clears selected URI when null", () => {
      useAppStore.getState().addFolder("/music/rock");
      useAppStore.getState().setMatchResults("/music/rock", [
        {
          track: {
            path: "/a.mp3",
            file_name: "a.mp3",
            artist: "A",
            title: "Song",
            album: null,
            album_artist: null,
            track_number: null,
            year: null,
          },
          status: "AutoMatched",
          candidates: [],
          selected_uri: "uri:1",
        },
      ]);
      useAppStore.getState().updateSelectedUri("/music/rock", "/a.mp3", null);
      const mr = useAppStore.getState().folders[0].matchResults![0];
      expect(mr.selected_uri).toBeNull();
      expect(mr.status).toBe("AutoMatched");
    });
  });
});
