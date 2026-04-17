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
    // get_client_id returns a saved id, check_auth returns null (not logged in)
    mockInvoke
      .mockResolvedValueOnce("saved-id") // get_client_id
      .mockResolvedValueOnce(null) // check_auth
      .mockRejectedValueOnce("Auth failed"); // login

    const user = userEvent.setup();
    render(<ConnectStep />);

    await waitFor(() => {
      expect(screen.getByText("Connect with Spotify")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Connect with Spotify"));

    await waitFor(() => {
      expect(screen.getByText("Auth failed")).toBeInTheDocument();
    });
  });

  it("logs in successfully and shows profile", async () => {
    const profile = {
      id: "user1",
      display_name: "Logged In User",
      images: [{ url: "https://example.com/pic.jpg" }],
    };
    mockInvoke
      .mockResolvedValueOnce("saved-id") // get_client_id
      .mockResolvedValueOnce(null) // check_auth
      .mockResolvedValueOnce(profile); // login

    const user = userEvent.setup();
    render(<ConnectStep />);

    await waitFor(() => {
      expect(screen.getByText("Connect with Spotify")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Connect with Spotify"));

    await waitFor(() => {
      expect(screen.getByText("Logged In User")).toBeInTheDocument();
    });
    expect(screen.getByAltText("Profile")).toHaveAttribute(
      "src",
      "https://example.com/pic.jpg"
    );
  });

  it("logs out and returns to login view", async () => {
    const profile = {
      id: "user1",
      display_name: "Test User",
      images: [],
    };
    mockInvoke
      .mockResolvedValueOnce("saved-id") // get_client_id
      .mockResolvedValueOnce(profile) // check_auth
      .mockResolvedValueOnce(undefined); // logout

    const user = userEvent.setup();
    render(<ConnectStep />);

    await waitFor(() => {
      expect(screen.getByText("Test User")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Disconnect"));

    await waitFor(() => {
      expect(screen.getByText("Connect with Spotify")).toBeInTheDocument();
    });
    expect(mockInvoke).toHaveBeenCalledWith("logout");
  });

  it("navigates to folders step on Next click", async () => {
    const profile = {
      id: "user1",
      display_name: "Test User",
      images: [],
    };
    mockInvoke
      .mockResolvedValueOnce("saved-id") // get_client_id
      .mockResolvedValueOnce(profile); // check_auth

    const user = userEvent.setup();
    render(<ConnectStep />);

    await waitFor(() => {
      expect(screen.getByText("Next — Add Music")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Next — Add Music"));

    expect(useAppStore.getState().step).toBe("folders");
  });

  it("shows Change Client ID button and resets to setup", async () => {
    mockInvoke
      .mockResolvedValueOnce("saved-id") // get_client_id
      .mockResolvedValueOnce(null); // check_auth

    const user = userEvent.setup();
    render(<ConnectStep />);

    await waitFor(() => {
      expect(screen.getByText("Change Client ID")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Change Client ID"));

    await waitFor(() => {
      expect(
        screen.getByText("Setup — Spotify Client ID")
      ).toBeInTheDocument();
    });
  });

  it("shows error when saving client ID fails", async () => {
    mockInvoke
      .mockResolvedValueOnce(null) // get_client_id
      .mockRejectedValueOnce("Save failed"); // set_client_id

    const user = userEvent.setup();
    render(<ConnectStep />);

    await waitFor(() => {
      expect(
        screen.getByPlaceholderText("Paste your Client ID here")
      ).toBeInTheDocument();
    });

    await user.type(
      screen.getByPlaceholderText("Paste your Client ID here"),
      "bad-id"
    );
    await user.click(screen.getByText("Save Client ID"));

    await waitFor(() => {
      expect(screen.getByText("Save failed")).toBeInTheDocument();
    });
  });

  it("shows user ID when display_name is missing", async () => {
    const profile = {
      id: "user123",
      display_name: null,
      images: [],
    };
    mockInvoke
      .mockResolvedValueOnce("saved-id") // get_client_id
      .mockResolvedValueOnce(profile); // check_auth

    render(<ConnectStep />);

    await waitFor(() => {
      expect(screen.getByText("user123")).toBeInTheDocument();
    });
  });
});
