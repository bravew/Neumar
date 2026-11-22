/** Task video downloads use a host-owned destination question. */
export const DOWNLOAD_INSTRUCTIONS =
  'For a web video download, find a source URL with web search if necessary, then call ' +
  '`download_media` with urls and optional maxHeight (2160 for 4K). The host asks ' +
  'the user to choose a folder before it writes any media. This applies even if ' +
  'the plan or workspace instructions name the session output folder. Do not run ' +
  'yt-dlp, a shell download script, or ask for a path in chat. End the turn after ' +
  'the receipt. If the tool fails, report the error and stop.';
