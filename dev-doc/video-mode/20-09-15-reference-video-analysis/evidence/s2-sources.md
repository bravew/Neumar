# S2 — Link sources

Pinned yt-dlp `2026.08.19`. **Simulate only** (`--simulate`); no media
was written. URLs are truncated. stderr is classified, never stored raw
beyond a 240-character secret-free head.

| Source | Extractor | Exit | Duration | Seconds | Notes |
| --- | --- | --- | --- | --- | --- |
| youtube | youtube | 0 | 19 | 2.51 | ok |
| tiktok | TikTok | 0 | 24 | 1.97 | ok |
| instagram | — | 1 | — | 1.31 | WARNING: [Instagram] CqKj8sOJL9g: Instagram API is not granting access ERROR: [Instagram] CqKj8sOJL9g: Instagram sent an empty media response. Check if this post is accessible in your browser without being logged-in. If it is not, then use  |
| bilibili | — | 1 | — | 1.49 | ERROR: [BiliBili] 1GJ411x7h7: This video may be deleted or geo-restricted. You might want to try a VPN or a proxy server (with --proxy) |
| x | — | 1 | — | 0.94 | ERROR: [twitter] 20: No video could be found in this tweet |
| vimeo | — | 1 | — | 0.73 | ERROR: [vimeo] 148751763: Unable to download webpage: HTTP Error 404: Not Found (caused by <HTTPError 404: Not Found>) |
| direct-mp4 | generic | 0 | NA | 0.67 | ok |
| geo-auth | youtube | 0 | 635 | 2.39 | ok |

## Policy for Phase 1 (from document 06 R3)

- Extractor support is technical capability, not permission.
- Do not circumvent DRM, paywalls, or login cookies.
- YouTube terms restrict downloading except under stated permissions;
  a study checkbox is not a legal safe-harbor. Phase 1 ships local-file
  and workspace-path intake unconditionally; authorized link paths stay
  behind `network:youtube` + `studyAcknowledged` and classified errors.
- Unsupported origins get a local-file alternative in the UI.
- Reject playlists and live streams for this increment.

Command: `yt-dlp --ignore-config --simulate --no-playlist --print %(extractor)s`.
