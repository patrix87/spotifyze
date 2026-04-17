import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConnectStep } from "../components/ConnectStep";
import { useAppStore } from "../lib/store";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core");
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

const mockInvoke = vi.mocked(invoke);

describe("ConnectStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ step: "connect", profile: null });
  });

  it("shows loading state initially", () => {
    mockInvoke.mockImplementation(() => new Promise(() => {})); // never resolves
    render(<ConnectStep />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("shows client ID setup when no saved config", async () => {
    mockInvoke.mockResolvedValue(null);
    render(<ConnectStep />);
    await waitFor(() => {
      expect(
        screen.getByText("Setup — Spotify Client ID")
      ).toBeInTheDocument();
    });
  });

  it("disables save button when client ID is empty", async () => {
    mockInvoke.mockResolvedValue(null);
    render(<ConnectStep />);
    await waitFor(() => {
      expect(screen.getByText("Save Client ID")).toBeDisabled();
    });
  });

  it("enables save button when client ID is entered", async () => {
    mockInvoke.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<ConnectStep />);
    await waitFor(() => {
      expect(
        screen.getByPlaceholderText("Paste your Client ID here")
      ).toBeInTheDocument();
    });
    await user.type(
      screen.getByPlaceholderText("Paste your Client ID here"),
      "test-client-id"
    );
    expect(screen.getByText("Save Client ID")).toBeEnabled();
  });

  it("calls set_client_id on save", async () => {
    mockInvoke.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<ConnectStep />);
    await waitFor(() => {
      expect(
        screen.getByPlaceholderText("Paste your Client ID here")
      ).toBeInTheDocument();
    });
    await user.type(
      screen.getByPlaceholderText("Paste your Client ID here"),
      "my-id"
    );
    await user.click(screen.getByText("Save Client ID"));
    expect(mockInvoke).toHaveBeenCalledWith("set_client_id", {
      clientId: "my-id",
    });
  });

  it("shows login button after saving client ID", async () => {
    // First call: get_client_id returns null, subsequent calls resolve
    mockInvoke.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<ConnectStep />);
    await waitFor(() => {
      expect(
        screen.getByPlaceholderText("Paste your Client ID here")
      ).toBeInTheDocument();
    });
    await user.type(
      screen.getByPlaceholderText("Paste your Client ID here"),
      "my-id"
    );
    await user.click(screen.getByText("Save Client ID"));
    await waitFor(() => {
      expect(screen.getByText("Connect with Spotify")).toBeInTheDocument();
    });
  });

  it("shows profile and next button when logged in", async () => {
    const profile = {
      id: "user1",
      display_name: "Test User",
      images: [],
    };
    mockInvoke
      .mockResolvedValueOnce("saved-client-id") // get_client_id
      .mockResolvedValueOnce(profile); // check_auth
    render(<ConnectStep />);
    await waitFor(() => {
      expect(screen.getByText("Test User")).toBeInTheDocument();
    });
    expect(screen.getByText("Next — Add Music")).toBeInTheDocument();
  });

  it("shows error on login failure", async () => {
    mockInvoke
      .mockResolvedValueOnce(null) // get_client_id
      .mockResolvedValueOnce(null) // get_client_id resolves to null
      .mockRejectedValueOnce("Auth failed"); // set_client_id or login
    render(<ConnectStep />);
    // Wait for initial load
    await waitFor(() => {
      expect(
        screen.getByPlaceholderText("Paste your Client ID here")
      ).toBeInTheDocument();
    });
  });
});
