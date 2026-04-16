import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import App from "../App";
import { useAppStore } from "../lib/store";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core");

const mockInvoke = vi.mocked(invoke);

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ step: "connect" });
    mockInvoke.mockResolvedValue(null);
  });

  it("renders the step indicator with 4 steps", () => {
    render(<App />);
    expect(screen.getByText("Connect")).toBeInTheDocument();
    expect(screen.getByText("Select Folders")).toBeInTheDocument();
    expect(screen.getByText("Review Matches")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("renders ConnectStep on initial load", async () => {
    render(<App />);
    await waitFor(() => {
      expect(
        screen.getByText("Folder to Spotify Playlist")
      ).toBeInTheDocument();
    });
  });

  it("highlights the current step", () => {
    render(<App />);
    const connectLabel = screen.getByText("Connect");
    expect(connectLabel).toHaveClass("text-white");
    expect(screen.getByText("Select Folders")).toHaveClass("text-zinc-500");
  });
});
