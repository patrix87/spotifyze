import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../lib/store";
import type { UserProfile } from "../lib/types";

export function ConnectStep() {
  const { profile, setProfile, setStep } = useAppStore();
  const [clientId, setClientId] = useState("");
  const [hasClientId, setHasClientId] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const id = await invoke<string | null>("get_client_id");
        if (id) {
          setClientId(id);
          setHasClientId(true);
          // Try to restore session
          const existing = await invoke<UserProfile | null>("check_auth");
          if (existing) {
            setProfile(existing);
          }
        }
      } catch {
        // No saved config
      } finally {
        setLoading(false);
      }
    })();
  }, [setProfile]);

  async function handleSaveClientId() {
    setError(null);
    try {
      await invoke("set_client_id", { clientId: clientId.trim() });
      setHasClientId(true);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleLogin() {
    setError(null);
    setLoading(true);
    try {
      const userProfile = await invoke<UserProfile>("login");
      setProfile(userProfile);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    await invoke("logout");
    setProfile(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-zinc-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-8 pt-12">
      <div className="text-center">
        <h1 className="text-3xl font-bold mb-2">Spotifyze</h1>
        <p className="text-zinc-400">
          Turn your local music into Spotify playlists
        </p>
      </div>

      {!hasClientId ? (
        <div className="w-full max-w-md space-y-4">
          <div className="bg-zinc-900 rounded-lg p-6 space-y-4">
            <h2 className="text-lg font-semibold">Setup — Spotify Client ID</h2>
            <p className="text-sm text-zinc-400">
              To use this app, you need a Spotify Developer Client ID.
            </p>
            <ol className="text-sm text-zinc-400 list-decimal list-inside space-y-1">
              <li>
                Go to{" "}
                <a
                  href="https://developer.spotify.com/dashboard"
                  target="_blank"
                  rel="noopener"
                  className="text-green-400 underline"
                >
                  developer.spotify.com/dashboard
                </a>
              </li>
              <li>Create an app (any name)</li>
              <li>
                Add <code className="text-green-300">http://127.0.0.1:8888/callback</code>{" "}
                as a Redirect URI
              </li>
              <li>Copy the Client ID and paste it below</li>
            </ol>
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Paste your Client ID here"
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm focus:outline-none focus:border-green-500"
            />
            <button
              onClick={handleSaveClientId}
              disabled={!clientId.trim()}
              className="w-full py-2 bg-green-600 hover:bg-green-500 disabled:bg-zinc-700 disabled:text-zinc-500 rounded font-medium text-sm transition-colors"
            >
              Save Client ID
            </button>
          </div>
        </div>
      ) : profile ? (
        <div className="w-full max-w-md space-y-4">
          <div className="bg-zinc-900 rounded-lg p-6 flex items-center gap-4">
            {profile.images?.[0] && (
              <img
                src={profile.images[0].url}
                alt="Profile"
                className="w-12 h-12 rounded-full"
              />
            )}
            <div className="flex-1">
              <p className="font-medium">
                {profile.display_name || profile.id}
              </p>
              <p className="text-sm text-zinc-400">Connected to Spotify</p>
            </div>
            <button
              onClick={handleLogout}
              className="px-3 py-1 text-sm text-zinc-400 hover:text-white border border-zinc-700 rounded transition-colors"
            >
              Disconnect
            </button>
          </div>
          <button
            onClick={() => setStep("folders")}
            className="w-full py-3 bg-green-600 hover:bg-green-500 rounded-lg font-medium transition-colors"
          >
            Next — Add Music
          </button>
        </div>
      ) : (
        <div className="w-full max-w-md space-y-4">
          <button
            onClick={handleLogin}
            className="w-full py-3 bg-green-600 hover:bg-green-500 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
            </svg>
            Connect with Spotify
          </button>
          <button
            onClick={() => {
              setHasClientId(false);
              setClientId("");
            }}
            className="w-full py-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Change Client ID
          </button>
        </div>
      )}

      {error && (
        <div className="w-full max-w-md bg-red-900/30 border border-red-800 rounded-lg p-3 text-sm text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}
