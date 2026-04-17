import { useState, useEffect } from "react";
import { useAppStore } from "../lib/store";

function AnimatedCheckmark() {
  return (
    <div className="flex items-center justify-center">
      <svg
        className="w-24 h-24"
        viewBox="0 0 52 52"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle
          className="animate-check-circle"
          cx="26"
          cy="26"
          r="23"
          fill="none"
          stroke="#22c55e"
          strokeWidth="3"
          strokeDasharray="144"
          strokeDashoffset="144"
        />
        <path
          className="animate-check-mark"
          fill="none"
          stroke="#22c55e"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="30"
          strokeDashoffset="30"
          d="M15 27l7 7 15-15"
        />
      </svg>
    </div>
  );
}

export function DoneStep() {
  const { folders, resetFolders, setStep } = useAppStore();
  const [showResults, setShowResults] = useState(false);

  const foldersWithPlaylists = folders.filter((f) => f.playlistResult);

  useEffect(() => {
    const timer = setTimeout(() => setShowResults(true), 1000);
    return () => clearTimeout(timer);
  }, []);

  function handleStartOver() {
    resetFolders();
    setStep("folders");
  }

  return (
    <div className="flex flex-col items-center gap-8 pt-12">
      <div className="text-center">
        <AnimatedCheckmark />
        <h2
          className={`text-2xl font-bold mt-4 transition-opacity duration-500 ${showResults ? "opacity-100" : "opacity-0"}`}
        >
          {foldersWithPlaylists.length === 1
            ? "Playlist Created!"
            : `${foldersWithPlaylists.length} Playlists Created!`}
        </h2>
      </div>

      <div
        className={`w-full max-w-md space-y-3 transition-all duration-500 ${showResults ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
      >
        {foldersWithPlaylists.map((folder) => (
          <div
            key={folder.path}
            className="bg-zinc-900 rounded-lg p-4 flex items-center justify-between"
          >
            <div>
              <p className="font-medium">{folder.name}</p>
              <p className="text-sm text-zinc-400">
                {folder.playlistResult!.tracks_added} tracks added
              </p>
            </div>
            <a
              href={folder.playlistResult!.playlist_url}
              target="_blank"
              rel="noopener"
              className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded text-sm font-medium transition-colors"
            >
              Open in Spotify
            </a>
          </div>
        ))}
      </div>

      <button
        onClick={handleStartOver}
        className={`text-sm text-zinc-400 hover:text-white transition-all duration-500 ${showResults ? "opacity-100" : "opacity-0"}`}
      >
        Create another playlist
      </button>
    </div>
  );
}
