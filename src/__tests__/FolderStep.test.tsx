import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FolderStep } from "../components/FolderStep";
import { useAppStore } from "../lib/store";

vi.mock("@tauri-apps/api/core");
vi.mock("@tauri-apps/plugin-dialog");

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
    expect(screen.getByText("No folders selected")).toBeInTheDocument();
    expect(screen.getByText("Add a folder to get started")).toBeInTheDocument();
  });

  it("renders the add folder button", () => {
    render(<FolderStep />);
    expect(screen.getByText("+ Add Folder")).toBeInTheDocument();
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
    await user.click(screen.getByTitle("Remove folder"));
    expect(screen.queryByDisplayValue("Rock")).not.toBeInTheDocument();
  });

  it("has a recursive checkbox", () => {
    render(<FolderStep />);
    expect(
      screen.getByLabelText("Scan subfolders recursively")
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

  it("allows editing folder name", async () => {
    useAppStore.getState().addFolder("/home/user/Music/Rock");
    const user = userEvent.setup();
    render(<FolderStep />);

    const input = screen.getByDisplayValue("Rock");
    await user.clear(input);
    await user.type(input, "Classic Rock");
    expect(useAppStore.getState().folders[0].name).toBe("Classic Rock");
  });
});
