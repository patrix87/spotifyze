import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FolderStep } from "../components/FolderStep";
import { useAppStore } from "../lib/store";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core");
vi.mock("@tauri-apps/plugin-dialog");
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    onDragDropEvent: vi.fn(() => Promise.resolve(() => {})),
  })),
}));

const mockInvoke = vi.mocked(invoke);

describe("FolderStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      step: "folders",
      folders: [],
      recursive: false,
      confidence: 80,
    });
  });

  it("shows empty state when no folders selected", () => {
    render(<FolderStep />);
    expect(screen.getByText("Drop folders or playlists here, or")).toBeInTheDocument();
    expect(screen.getByText("Add a folder")).toBeInTheDocument();
    expect(screen.getByText("Add a playlist")).toBeInTheDocument();
  });

  it("renders the add folder button", () => {
    render(<FolderStep />);
    expect(screen.getByText("+ Add Folder")).toBeInTheDocument();
  });

  it("renders the add playlist button", () => {
    render(<FolderStep />);
    expect(screen.getByText("+ Add Playlist")).toBeInTheDocument();
  });

  it("opens folder picker on add folder click", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const mockOpen = vi.mocked(open);
    mockOpen.mockResolvedValue(null);

    const user = userEvent.setup();
    render(<FolderStep />);
    await user.click(screen.getByText("+ Add Folder"));

    expect(mockOpen).toHaveBeenCalledWith({
      directory: true,
      multiple: true,
    });
  });

  it("displays folders from store", () => {
    useAppStore.getState().addFolder("/home/user/Music/Rock");
    useAppStore.getState().addFolder("/home/user/Music/Jazz");
    render(<FolderStep />);

    expect(screen.getByDisplayValue("Rock")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Jazz")).toBeInTheDocument();
    expect(screen.getByText("/home/user/Music/Rock")).toBeInTheDocument();
    expect(screen.getByText("/home/user/Music/Jazz")).toBeInTheDocument();
  });

  it("removes a folder on X click", async () => {
    useAppStore.getState().addFolder("/home/user/Music/Rock");
    const user = userEvent.setup();
    render(<FolderStep />);

    expect(screen.getByDisplayValue("Rock")).toBeInTheDocument();
    await user.click(screen.getByTitle("Remove"));
    expect(screen.queryByDisplayValue("Rock")).not.toBeInTheDocument();
  });

  it("has a recursive checkbox", () => {
    render(<FolderStep />);
    expect(
      screen.getByLabelText("Include subfolders")
    ).toBeInTheDocument();
  });

  it("disables scan button when no folders", () => {
    render(<FolderStep />);
    expect(screen.getByText("Scan & Match")).toBeDisabled();
  });

  it("enables scan button with folders", () => {
    useAppStore.getState().addFolder("/home/user/Music/Rock");
    render(<FolderStep />);
    expect(screen.getByText("Scan & Match")).toBeEnabled();
  });

  it("has a back button", () => {
    render(<FolderStep />);
    expect(screen.getByText("← Back")).toBeInTheDocument();
  });

  it("navigates back to connect on back click", async () => {
    const user = userEvent.setup();
    render(<FolderStep />);
    await user.click(screen.getByText("← Back"));
    expect(useAppStore.getState().step).toBe("connect");
  });

  it("opens playlist file picker on add playlist click", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const mockOpen = vi.mocked(open);
    mockOpen.mockResolvedValue(null);

    const user = userEvent.setup();
    render(<FolderStep />);
    await user.click(screen.getByText("+ Add Playlist"));

    expect(mockOpen).toHaveBeenCalledWith({
      directory: false,
      multiple: true,
      filters: [{ name: "Playlists", extensions: ["m3u", "m3u8"] }],
    });
  });

  it("allows editing folder name", async () => {
    useAppStore.getState().addFolder("/home/user/Music/Rock");
    const user = userEvent.setup();
    render(<FolderStep />);

    const input = screen.getByDisplayValue("Rock");
    await user.clear(input);
    await user.type(input, "Classic Rock");
    expect(useAppStore.getState().folders[0].name).toBe("Classic Rock");
  });

  it("displays playlist entries with playlist emoji", () => {
    useAppStore.getState().addPlaylist("/home/user/chill.m3u");
    render(<FolderStep />);
    expect(screen.getByDisplayValue("chill")).toBeInTheDocument();
    expect(screen.getByText("🎵")).toBeInTheDocument();
  });

  it("displays folder entries with folder emoji", () => {
    useAppStore.getState().addFolder("/home/user/Music/Rock");
    render(<FolderStep />);
    expect(screen.getByText("📁")).toBeInTheDocument();
  });

  it("toggles recursive checkbox", async () => {
    const user = userEvent.setup();
    render(<FolderStep />);
    const checkbox = screen.getByLabelText("Include subfolders");
    expect(checkbox).not.toBeChecked();
    await user.click(checkbox);
    expect(useAppStore.getState().recursive).toBe(true);
  });

  it("scans folders and matches tracks on Scan & Match", async () => {
    const scanResult = {
      tracks: [
        {
          path: "/a.mp3",
          file_name: "a.mp3",
          artist: "A",
          title: "Song",
          album: null,
          album_artist: null,
          track_number: null,
          year: null,
        },
      ],
      skipped: [],
    };
    const matchResults = [
      {
        track: scanResult.tracks[0],
        status: "AutoMatched",
        candidates: [],
        selected_uri: "uri:1",
      },
    ];

    mockInvoke
      .mockResolvedValueOnce([scanResult]) // scan_folders
      .mockResolvedValueOnce(null) // load_match_results (cache miss)
      .mockResolvedValueOnce(matchResults) // match_tracks
      .mockResolvedValueOnce(undefined); // save_match_results

    useAppStore.getState().addFolder("/home/user/Music/Rock");
    const user = userEvent.setup();
    render(<FolderStep />);

    await user.click(screen.getByText("Scan & Match"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("scan_folders", {
        paths: ["/home/user/Music/Rock"],
        recursive: false,
      });
    });

    await waitFor(() => {
      expect(useAppStore.getState().step).toBe("review");
    });
  });

  it("uses cached match results when available", async () => {
    const scanResult = {
      tracks: [
        {
          path: "/a.mp3",
          file_name: "a.mp3",
          artist: "A",
          title: "Song",
          album: null,
          album_artist: null,
          track_number: null,
          year: null,
        },
      ],
      skipped: [],
    };
    const cachedResults = [
      {
        track: scanResult.tracks[0],
        status: "AutoMatched",
        candidates: [],
        selected_uri: "uri:1",
      },
    ];

    mockInvoke
      .mockResolvedValueOnce([scanResult]) // scan_folders
      .mockResolvedValueOnce(cachedResults); // load_match_results (cache hit)

    useAppStore.getState().addFolder("/home/user/Music/Rock");
    const user = userEvent.setup();
    render(<FolderStep />);

    await user.click(screen.getByText("Scan & Match"));

    await waitFor(() => {
      expect(useAppStore.getState().step).toBe("review");
    });

    // match_tracks should NOT have been called
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "match_tracks",
      expect.anything()
    );
  });

  it("shows error when scan fails", async () => {
    mockInvoke.mockRejectedValueOnce("Scan failed: permission denied");

    useAppStore.getState().addFolder("/home/user/Music/Rock");
    const user = userEvent.setup();
    render(<FolderStep />);

    await user.click(screen.getByText("Scan & Match"));

    await waitFor(() => {
      expect(
        screen.getByText("Scan failed: permission denied")
      ).toBeInTheDocument();
    });
  });

  it("scans playlists separately from folders", async () => {
    const folderScan = {
      tracks: [
        {
          path: "/a.mp3",
          file_name: "a.mp3",
          artist: "A",
          title: "Song",
          album: null,
          album_artist: null,
          track_number: null,
          year: null,
        },
      ],
      skipped: [],
    };
    const playlistScan = {
      tracks: [
        {
          path: "/b.mp3",
          file_name: "b.mp3",
          artist: "B",
          title: "Track",
          album: null,
          album_artist: null,
          track_number: null,
          year: null,
        },
      ],
      skipped: [],
    };

    mockInvoke
      .mockResolvedValueOnce([folderScan]) // scan_folders
      .mockResolvedValueOnce([playlistScan]) // scan_playlists
      .mockResolvedValueOnce(null) // load_match_results folder
      .mockResolvedValueOnce([]) // match_tracks folder
      .mockResolvedValueOnce(undefined) // save_match_results folder
      .mockResolvedValueOnce(null) // load_match_results playlist
      .mockResolvedValueOnce([]) // match_tracks playlist
      .mockResolvedValueOnce(undefined); // save_match_results playlist

    useAppStore.getState().addFolder("/home/user/Music/Rock");
    useAppStore.getState().addPlaylist("/home/user/chill.m3u");
    const user = userEvent.setup();
    render(<FolderStep />);

    await user.click(screen.getByText("Scan & Match"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("scan_folders", {
        paths: ["/home/user/Music/Rock"],
        recursive: false,
      });
      expect(mockInvoke).toHaveBeenCalledWith("scan_playlists", {
        paths: ["/home/user/chill.m3u"],
      });
    });
  });

  it("adds folder via dialog returning single string", async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const mockOpen = vi.mocked(open);
    mockOpen.mockResolvedValue("/home/user/Music/Pop" as any);

    const user = userEvent.setup();
    render(<FolderStep />);
    await user.click(screen.getByText("+ Add Folder"));

    await waitFor(() => {
      expect(useAppStore.getState().folders).toHaveLength(1);
      expect(useAppStore.getState().folders[0].path).toBe("/home/user/Music/Pop");
    });
  });
});
