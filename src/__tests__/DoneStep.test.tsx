import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DoneStep } from "../components/DoneStep";
import { useAppStore } from "../lib/store";

vi.mock("@tauri-apps/api/core");
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

describe("DoneStep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setupWithPlaylists(count: number) {
    const folders = Array.from({ length: count }, (_, i) => ({
      path: `/music/folder${i}`,
      name: `Folder ${i}`,
      source: "folder" as const,
      scanResult: null,
      matchResults: null,
      playlistResult: {
        playlist_id: `pl${i}`,
        playlist_url: `https://open.spotify.com/playlist/pl${i}`,
        tracks_added: 5 + i,
      },
    }));
    useAppStore.setState({ step: "done", folders });
  }

  it("renders the animated checkmark SVG", () => {
    setupWithPlaylists(1);
    render(<DoneStep />);
    expect(document.querySelector("svg")).toBeInTheDocument();
  });

  it("shows singular text for one playlist", () => {
    setupWithPlaylists(1);
    render(<DoneStep />);
    act(() => { vi.advanceTimersByTime(1100); });
    expect(screen.getByText("Playlist Created!")).toBeInTheDocument();
  });

  it("shows plural text for multiple playlists", () => {
    setupWithPlaylists(3);
    render(<DoneStep />);
    act(() => { vi.advanceTimersByTime(1100); });
    expect(screen.getByText("3 Playlists Created!")).toBeInTheDocument();
  });

  it("shows folder name and track count", () => {
    setupWithPlaylists(1);
    render(<DoneStep />);
    act(() => { vi.advanceTimersByTime(1100); });
    expect(screen.getByText("Folder 0")).toBeInTheDocument();
    expect(screen.getByText("5 tracks added")).toBeInTheDocument();
  });

  it("has Open in Spotify links for each playlist", () => {
    setupWithPlaylists(2);
    render(<DoneStep />);
    act(() => { vi.advanceTimersByTime(1100); });
    const links = screen.getAllByText("Open in Spotify");
    expect(links).toHaveLength(2);
    expect(links[0].closest("a")).toHaveAttribute(
      "href",
      "https://open.spotify.com/playlist/pl0"
    );
    expect(links[1].closest("a")).toHaveAttribute(
      "href",
      "https://open.spotify.com/playlist/pl1"
    );
  });

  it("has a start over button that resets state", async () => {
    vi.useRealTimers();
    setupWithPlaylists(1);
    const user = userEvent.setup();
    render(<DoneStep />);
    await user.click(screen.getByText("Create another playlist"));
    expect(useAppStore.getState().step).toBe("folders");
    expect(useAppStore.getState().folders).toEqual([]);
  });

  it("only shows folders with playlistResult", () => {
    useAppStore.setState({
      step: "done",
      folders: [
        {
          path: "/music/a",
          name: "A",
          source: "folder",
          scanResult: null,
          matchResults: null,
          playlistResult: {
            playlist_id: "pl1",
            playlist_url: "https://open.spotify.com/playlist/pl1",
            tracks_added: 3,
          },
        },
        {
          path: "/music/b",
          name: "B",
          source: "folder",
          scanResult: null,
          matchResults: null,
          playlistResult: null,
        },
      ],
    });
    render(<DoneStep />);
    act(() => { vi.advanceTimersByTime(1100); });
    expect(screen.getByText("Playlist Created!")).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.queryByText("B")).not.toBeInTheDocument();
  });

  it("results are initially hidden and fade in after delay", () => {
    setupWithPlaylists(1);
    render(<DoneStep />);
    // Before timer, heading should have opacity-0
    const heading = screen.getByText("Playlist Created!");
    expect(heading.className).toContain("opacity-0");
    act(() => { vi.advanceTimersByTime(1100); });
    expect(heading.className).toContain("opacity-100");
  });
});
