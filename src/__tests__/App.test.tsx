import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import App from "../App";
import { useAppStore } from "../lib/store";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core");
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock("@tauri-apps/plugin-dialog");

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
    expect(screen.getByText("Add Music")).toBeInTheDocument();
    expect(screen.getByText("Review Matches")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("renders ConnectStep on initial load", async () => {
    render(<App />);
    await waitFor(() => {
      expect(
        screen.getByText("Spotifyze")
      ).toBeInTheDocument();
    });
  });

  it("highlights the current step", () => {
    render(<App />);
    const connectLabel = screen.getByText("Connect");
    expect(connectLabel).toHaveClass("text-white");
    expect(screen.getByText("Add Music")).toHaveClass("text-zinc-500");
  });
});
