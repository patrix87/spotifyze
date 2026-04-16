import { useAppStore } from "../lib/store";

export function DoneStep() {
  const { folders, resetFolders, setStep } = useAppStore();

  const foldersWithPlaylists = folders.filter((f) => f.playlistResult);

  function handleStartOver() {
    resetFolders();
    setStep("folders");
  }

  return (
    <div className="flex flex-col items-center gap-8 pt-12">
      <div className="text-center">
        <div className="text-5xl mb-4">🎉</div>
        <h2 className="text-2xl font-bold">
          {foldersWithPlaylists.length === 1
            ? "Playlist Created!"
            : `${foldersWithPlaylists.length} Playlists Created!`}
        </h2>
      </div>

      <div className="w-full max-w-md space-y-3">
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
        className="text-sm text-zinc-400 hover:text-white transition-colors"
      >
        Create another playlist
      </button>
    </div>
  );
}
