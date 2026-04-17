import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReviewStep } from "../components/ReviewStep";
import { useAppStore } from "../lib/store";
import { invoke } from "@tauri-apps/api/core";
import type { FolderEntry, MatchResult } from "../lib/types";

vi.mock("@tauri-apps/api/core");
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

const mockInvoke = vi.mocked(invoke);

const mockTrack = (
  artist: string,
  title: string,
  path: string
) => ({
  path,
  file_name: `${title}.mp3`,
  artist,
  title,
  album: null,
  album_artist: null,
  track_number: null,
  year: null,
});

const mockCandidate = (
  name: string,
  artist: string,
  uri: string,
  score: number
) => ({
  spotify_uri: uri,
  name,
  artist,
  album: "Test Album",
  album_type: "album",
  release_year: "2024",
  popularity: 80,
  score,
  external_url: null,
  preview_url: null,
});

function setupFolderWithMatches(matchResults: MatchResult[]) {
  const folder: FolderEntry = {
    path: "/music/rock",
    name: "Rock",
    source: "folder",
    scanResult: { tracks: [], skipped: [] },
    matchResults,
    playlistResult: null,
  };
  useAppStore.setState({
    step: "review",
    folders: [folder],
  });
}

describe("ReviewStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({
      step: "review",
      folders: [],
    });
  });

  it("shows header and stats", () => {
    setupFolderWithMatches([
      {
        track: mockTrack("Artist", "Song", "/a.mp3"),
        status: "AutoMatched",
        candidates: [mockCandidate("Song", "Artist", "uri:1", 95)],
        selected_uri: "uri:1",
      },
    ]);
    render(<ReviewStep />);
    expect(screen.getByText("Review Matches")).toBeInTheDocument();
    expect(screen.getByText(/1 of 1 tracks matched/)).toBeInTheDocument();
  });

  it("shows filter buttons", () => {
    setupFolderWithMatches([]);
    render(<ReviewStep />);
    expect(screen.getByText("All (0)")).toBeInTheDocument();
    expect(screen.getByText(/Missing/)).toBeInTheDocument();
    expect(screen.getByText(/Unsure/)).toBeInTheDocument();
    expect(screen.getByText(/Matched/)).toBeInTheDocument();
  });

  it("renders tracks with correct status icons", () => {
    setupFolderWithMatches([
      {
        track: mockTrack("Artist1", "Song1", "/a.mp3"),
        status: "AutoMatched",
        candidates: [mockCandidate("Song1", "Artist1", "uri:1", 95)],
        selected_uri: "uri:1",
      },
      {
        track: mockTrack("Artist2", "Song2", "/b.mp3"),
        status: "NotFound",
        candidates: [],
        selected_uri: null,
      },
    ]);
    render(<ReviewStep />);
    expect(screen.getByText("Artist1")).toBeInTheDocument();
    expect(screen.getByText("Song1")).toBeInTheDocument();
    expect(screen.getByText("Artist2")).toBeInTheDocument();
    expect(screen.getByText("Song2")).toBeInTheDocument();
  });

  it("shows create button with track count", () => {
    setupFolderWithMatches([
      {
        track: mockTrack("Artist", "Song", "/a.mp3"),
        status: "AutoMatched",
        candidates: [mockCandidate("Song", "Artist", "uri:1", 95)],
        selected_uri: "uri:1",
      },
    ]);
    render(<ReviewStep />);
    expect(
      screen.getByText("Create Playlist (1 tracks)")
    ).toBeInTheDocument();
  });

  it("disables create button when no tracks selected", () => {
    setupFolderWithMatches([
      {
        track: mockTrack("Artist", "Song", "/a.mp3"),
        status: "NotFound",
        candidates: [],
        selected_uri: null,
      },
    ]);
    render(<ReviewStep />);
    expect(screen.getByText("Create Playlist (0 tracks)")).toBeDisabled();
  });

  it("has a back button that navigates to folders", async () => {
    setupFolderWithMatches([]);
    const user = userEvent.setup();
    render(<ReviewStep />);
    await user.click(screen.getByText("← Back"));
    expect(useAppStore.getState().step).toBe("folders");
  });

  it("calls create_playlist on submit", async () => {
    mockInvoke.mockResolvedValue({
      playlist_id: "pl1",
      playlist_url: "https://open.spotify.com/playlist/pl1",
      tracks_added: 1,
    });

    setupFolderWithMatches([
      {
        track: mockTrack("Artist", "Song", "/a.mp3"),
        status: "AutoMatched",
        candidates: [mockCandidate("Song", "Artist", "uri:1", 95)],
        selected_uri: "uri:1",
      },
    ]);

    const user = userEvent.setup();
    render(<ReviewStep />);
    await user.click(screen.getByText("Create Playlist (1 tracks)"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("create_playlist", {
        name: "Rock",
        uris: ["uri:1"],
      });
    });
  });

  it("expands candidates on track click", async () => {
    setupFolderWithMatches([
      {
        track: mockTrack("Artist", "Song", "/a.mp3"),
        status: "NeedsReview",
        candidates: [
          mockCandidate("Song", "Artist", "uri:1", 90),
          mockCandidate("Song (Remix)", "Artist", "uri:2", 70),
        ],
        selected_uri: "uri:1",
      },
    ]);

    const user = userEvent.setup();
    render(<ReviewStep />);

    // Click to expand
    await user.click(screen.getByText("2 matches"));
    expect(screen.getByText(/Song \(Remix\)/)).toBeInTheDocument();
    expect(screen.getByText("Skip this track")).toBeInTheDocument();
  });
});
