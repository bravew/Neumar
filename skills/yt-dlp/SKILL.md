---
name: yt-dlp
description: Save web videos through the task’s interactive download destination picker. Standalone CLI usage also supports format selection, audio extraction and playlists.
---

# yt-dlp Skill

## Task chat downloads

1. If the user asks you to find a video, use web search to identify its source URL.
2. Call `download_media` with `urls` and, when requested, `maxHeight` (for example `2160` for 4K). The tool opens the destination picker in chat. The user can choose the task folder or another permitted folder.
3. End the turn after the receipt. The host starts the download once the user submits their choice. A plan, a workspace default, or a path in the prompt cannot answer the picker. If the tool is unavailable or returns an error, report that and stop.

## Standalone CLI usage

The shell examples below are for standalone use outside task chat.

### Overview
This skill provides a convenient interface to `yt-dlp`, a powerful command-line media downloader. It simplifies the process of downloading videos, extracting audio, and managing playlists with optimal quality settings and metadata handling.

### Usage
- **Role**: Media Archivist.
- **Trigger**: "Download this video", "Get MP3 from YouTube", "Archive this channel".
- **Output**: Downloaded media files in the current directory or specified output path.

### Dependencies
- `yt-dlp`: The core downloader (must be installed in PATH).
- `ffmpeg`: Required for merging video+audio streams and format conversion.

### Commands

#### `scripts/download.sh`
The primary entry point. It wraps `yt-dlp` with sensible defaults for high-quality archiving.

**Syntax:**
```bash
./scripts/download.sh <URL> [OPTIONS]
```

**Defaults:**
- Best video + best audio merged (`bv+ba/b`)
- Embeds metadata, thumbnail, and subtitles (`--embed-metadata`, `--embed-thumbnail`, `--embed-subs`)
- Output format: `Title [ID].mp4` (`%(title)s [%(id)s].%(ext)s`)

**Examples:**

1.  **Download a single video (best quality):**
    ```bash
    scripts/download.sh "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    ```

2.  **Download a playlist:**
    ```bash
    scripts/download.sh "https://www.youtube.com/playlist?list=PL..."
    ```

3.  **Extract Audio (MP3):**
    ```bash
    scripts/download.sh "URL" -x --audio-format mp3
    ```

4.  **Download specific resolution (e.g., 1080p):**
    ```bash
    scripts/download.sh "URL" -f "bv*[height<=1080]+ba/b[height<=1080]"
    ```

5.  **Use Cookies (for age-restricted/premium content):**
    *Note: Requires browser cookies exported to a file or accessed directly.*
    ```bash
    scripts/download.sh "URL" --cookies-from-browser chrome
    ```

## Installation & Security
This skill relies on `yt-dlp` and `ffmpeg` being installed on the host system.
- **Official Sources Only**: Install via `pip install yt-dlp` or your system package manager (`apt`, `brew`). Avoid running curl scripts from untrusted sources.
- **Cookies**: Use `--cookies-from-browser` with caution. For autonomous agents, prefer exporting a `cookies.txt` file manually to limit access to your active browser session.

## Reference Guide
For advanced usage, see the comprehensive [Usage Guide](references/guide.md).
