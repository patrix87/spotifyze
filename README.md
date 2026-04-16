# Folder to Spotify Playlist

A desktop app that creates Spotify playlists from your local music folders. It reads metadata from audio files, fuzzy-matches them against Spotify's catalog (preferring original album releases over compilations and remixes), and creates a playlist with the matched tracks.

## Features

- **Multi-folder support** — scan multiple folders at once, each becomes its own playlist
- **Smart matching** — fuzzy scoring prefers original album releases over remixes, compilations, and live versions
- **Review before creating** — see all matches, pick alternatives for ambiguous tracks, skip what you don't want
- **Cross-platform** — runs on Windows, macOS, and Linux
- **No server needed** — connects directly to Spotify via OAuth (PKCE)

## Download

Grab the latest release for your platform from [GitHub Releases](../../releases).

| Platform | File |
|----------|------|
| Windows  | `.exe` or `.msi` |
| macOS (Apple Silicon) | `.dmg` (aarch64) |
| macOS (Intel) | `.dmg` (x86_64) |
| Linux    | `.AppImage` or `.deb` |

## Setup

Before first use, you need a Spotify Client ID (free):

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
2. Log in and create a new app (any name, any description)
3. In the app settings, add `http://localhost:8888/callback` as a **Redirect URI**
4. Copy the **Client ID** from the app dashboard
5. Open the app and paste the Client ID when prompted

> The app runs entirely on your machine — your Client ID is stored locally and never sent anywhere except Spotify's auth servers.

## How It Works

1. **Connect** — enter your Client ID and log in to Spotify
2. **Select Folders** — pick one or more folders containing music files (MP3, FLAC, M4A, OGG, WAV)
3. **Review Matches** — the app searches Spotify for each track and shows the best matches. Tracks are scored by:
   - Artist similarity (40%)
   - Title similarity (30%)
   - Album similarity (15%)
   - Album type — `album` preferred over `single`/`compilation` (10%)
   - Popularity tiebreaker (5%)
4. **Create** — confirm and the playlist is created on your Spotify account

## Supported Formats

MP3, FLAC, M4A (AAC/ALAC), OGG Vorbis, WAV — metadata is read using the [lofty](https://github.com/Serial-ATA/lofty-rs) crate.

## Build from Source

Prerequisites: [Node.js 20+](https://nodejs.org/), [Rust](https://rustup.rs/), and the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```bash
# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Zustand
- **Backend**: Rust, Tauri v2
- **Audio metadata**: lofty
- **Fuzzy matching**: strsim (Jaro-Winkler)

## License

MIT
