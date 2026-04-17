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

  it("selects a candidate when clicked", async () => {
    setupFolderWithMatches([
      {
        track: mockTrack("Artist", "Song", "/a.mp3"),
        status: "NeedsReview",
        candidates: [
          mockCandidate("Song", "Artist", "uri:1", 90),
          mockCandidate("Song (Live)", "Artist", "uri:2", 70),
        ],
        selected_uri: "uri:1",
      },
    ]);

    const user = userEvent.setup();
    render(<ReviewStep />);

    // Expand track
    await user.click(screen.getByText("2 matches"));
    // Click the second candidate (text is "Artist — Song (Live)" in a <p>)
    await user.click(screen.getByText(/Song \(Live\)/));

    const mr = useAppStore.getState().folders[0].matchResults![0];
    expect(mr.selected_uri).toBe("uri:2");
  });

  it("skips a track when skip button clicked", async () => {
    setupFolderWithMatches([
      {
        track: mockTrack("Artist", "Song", "/a.mp3"),
        status: "NeedsReview",
        candidates: [mockCandidate("Song", "Artist", "uri:1", 90)],
        selected_uri: "uri:1",
      },
    ]);

    const user = userEvent.setup();
    render(<ReviewStep />);

    // Expand track
    await user.click(screen.getByText("Artist"));
    // Click skip
    await user.click(screen.getByText("Skip this track"));

    const mr = useAppStore.getState().folders[0].matchResults![0];
    expect(mr.selected_uri).toBeNull();
  });

  it("filters by NotFound status", async () => {
    setupFolderWithMatches([
      {
        track: mockTrack("Artist1", "Found Song", "/a.mp3"),
        status: "AutoMatched",
        candidates: [mockCandidate("Found Song", "Artist1", "uri:1", 95)],
        selected_uri: "uri:1",
      },
      {
        track: mockTrack("Artist2", "Lost Song", "/b.mp3"),
        status: "NotFound",
        candidates: [],
        selected_uri: null,
      },
    ]);

    const user = userEvent.setup();
    render(<ReviewStep />);

    // Click the Missing filter button
    await user.click(screen.getByText(/Missing \(1\)/));

    expect(screen.getByText("Lost Song")).toBeInTheDocument();
    expect(screen.queryByText("Found Song")).not.toBeInTheDocument();
  });

  it("filters by AutoMatched status", async () => {
    setupFolderWithMatches([
      {
        track: mockTrack("Artist1", "Good", "/a.mp3"),
        status: "AutoMatched",
        candidates: [mockCandidate("Good", "Artist1", "uri:1", 95)],
        selected_uri: "uri:1",
      },
      {
        track: mockTrack("Artist2", "Bad", "/b.mp3"),
        status: "NotFound",
        candidates: [],
        selected_uri: null,
      },
    ]);

    const user = userEvent.setup();
    render(<ReviewStep />);

    await user.click(screen.getByText(/Matched/));

    expect(screen.getByText("Good")).toBeInTheDocument();
    expect(screen.queryByText("Bad")).not.toBeInTheDocument();
  });

  it("sorts alphabetically when A-Z selected", async () => {
    setupFolderWithMatches([
      {
        track: mockTrack("Zebra", "Zzz", "/z.mp3"),
        status: "AutoMatched",
        candidates: [mockCandidate("Zzz", "Zebra", "uri:z", 90)],
        selected_uri: "uri:z",
      },
      {
        track: mockTrack("Apple", "Aaa", "/a.mp3"),
        status: "AutoMatched",
        candidates: [mockCandidate("Aaa", "Apple", "uri:a", 90)],
        selected_uri: "uri:a",
      },
    ]);

    const user = userEvent.setup();
    render(<ReviewStep />);

    await user.click(screen.getByText("A–Z"));

    // Get track title rows (p.text-sm.truncate has "Artist — Title" text)
    const trackTitlePs = document.querySelectorAll("p.text-sm.truncate");
    const texts = Array.from(trackTitlePs).map((el) => el.textContent);
    // "Apple — Aaa" should come before "Zebra — Zzz"
    expect(texts[0]).toContain("Apple");
    expect(texts[1]).toContain("Zebra");
  });

  it("performs manual search on expanded track", async () => {
    mockInvoke.mockResolvedValue([
      mockCandidate("New Result", "New Artist", "uri:new", 85),
    ]);

    setupFolderWithMatches([
      {
        track: mockTrack("Artist", "Song", "/a.mp3"),
        status: "NotFound",
        candidates: [],
        selected_uri: null,
      },
    ]);

    const user = userEvent.setup();
    render(<ReviewStep />);

    // Expand track
    await user.click(screen.getByText("Artist"));

    // Type in search box and submit
    const searchInput = screen.getByPlaceholderText("Search Spotify...");
    await user.clear(searchInput);
    await user.type(searchInput, "Artist Song");
    await user.click(screen.getByText("Search"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("search_manual", {
        query: "Artist Song",
      });
    });
  });

  it("shows creating state while playlists are being created", async () => {
    // Make create_playlist never resolve
    mockInvoke.mockImplementation(() => new Promise(() => {}));

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
    expect(screen.getByText("Creating...")).toBeInTheDocument();
  });

  it("shows error when playlist creation fails", async () => {
    mockInvoke.mockRejectedValue("API error: rate limited");

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
      expect(screen.getByText("API error: rate limited")).toBeInTheDocument();
    });
  });

  it("renders multiple folders as separate sections", () => {
    useAppStore.setState({
      step: "review",
      folders: [
        {
          path: "/music/rock",
          name: "Rock",
          source: "folder",
          scanResult: null,
          matchResults: [
            {
              track: mockTrack("A", "Song1", "/a.mp3"),
              status: "AutoMatched",
              candidates: [mockCandidate("Song1", "A", "uri:1", 95)],
              selected_uri: "uri:1",
            },
          ],
          playlistResult: null,
        },
        {
          path: "/music/jazz",
          name: "Jazz",
          source: "folder",
          scanResult: null,
          matchResults: [
            {
              track: mockTrack("B", "Song2", "/b.mp3"),
              status: "AutoMatched",
              candidates: [mockCandidate("Song2", "B", "uri:2", 90)],
              selected_uri: "uri:2",
            },
          ],
          playlistResult: null,
        },
      ],
    });

    render(<ReviewStep />);
    expect(screen.getByDisplayValue("Rock")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Jazz")).toBeInTheDocument();
    expect(screen.getByText(/2 of 2 tracks matched/)).toBeInTheDocument();
  });

  it("shows needs review count in stats", () => {
    setupFolderWithMatches([
      {
        track: mockTrack("A", "Song1", "/a.mp3"),
        status: "AutoMatched",
        candidates: [mockCandidate("Song1", "A", "uri:1", 95)],
        selected_uri: "uri:1",
      },
      {
        track: mockTrack("B", "Song2", "/b.mp3"),
        status: "NeedsReview",
        candidates: [mockCandidate("Song2", "B", "uri:2", 60)],
        selected_uri: "uri:2",
      },
    ]);

    render(<ReviewStep />);
    expect(screen.getByText(/1 need review/)).toBeInTheDocument();
  });

  it("allows editing playlist name in review", async () => {
    setupFolderWithMatches([
      {
        track: mockTrack("A", "Song", "/a.mp3"),
        status: "AutoMatched",
        candidates: [mockCandidate("Song", "A", "uri:1", 95)],
        selected_uri: "uri:1",
      },
    ]);

    const user = userEvent.setup();
    render(<ReviewStep />);

    const nameInput = screen.getByDisplayValue("Rock");
    await user.clear(nameInput);
    await user.type(nameInput, "Classic Rock");

    expect(useAppStore.getState().folders[0].name).toBe("Classic Rock");
  });

  it("uses plural Playlists text for multiple folders", () => {
    useAppStore.setState({
      step: "review",
      folders: [
        {
          path: "/music/rock",
          name: "Rock",
          source: "folder",
          scanResult: null,
          matchResults: [
            {
              track: mockTrack("A", "Song1", "/a.mp3"),
              status: "AutoMatched",
              candidates: [mockCandidate("Song1", "A", "uri:1", 95)],
              selected_uri: "uri:1",
            },
          ],
          playlistResult: null,
        },
        {
          path: "/music/jazz",
          name: "Jazz",
          source: "folder",
          scanResult: null,
          matchResults: [
            {
              track: mockTrack("B", "Song2", "/b.mp3"),
              status: "AutoMatched",
              candidates: [mockCandidate("Song2", "B", "uri:2", 90)],
              selected_uri: "uri:2",
            },
          ],
          playlistResult: null,
        },
      ],
    });

    render(<ReviewStep />);
    expect(
      screen.getByText("Create Playlists (2 tracks)")
    ).toBeInTheDocument();
  });
});
