// Phase 4 M2 — client-side URL detection for the composer. The `@/` alias is
// scoped per workspace so the backend helper isn't importable here; the composer
// needs its own copy to decide whether a message contains a link worth
// ingesting. Deliberately stricter than the server's `extractUrls`: only
// `https://` is matched, because `fetchSource` rejects every other protocol with
// `fetch-failed` — extracting `http://` here would surface a misleading
// "couldn't fetch that link" instead of silently leaving the URL in the prompt.

const URL_RE = /https:\/\/[^\s<>"'`)\]}]+/gi;

// Video-platform hosts whose pages must NOT be web-scraped as text. A link to
// one of these is the media itself — the video agent downloads it with yt-dlp
// (video_fetch_source). Scraping the HTML would dump page chrome/comments into
// the prompt instead of fetching the video.
const VIDEO_HOST_RE =
  /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com|vimeo\.com|dailymotion\.com|tiktok\.com|twitch\.tv)$/i;

/** Whether `url` points at a video platform that should be downloaded, not scraped. */
export function isVideoPlatformUrl(url: string): boolean {
  try {
    return VIDEO_HOST_RE.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Extract up to `max` distinct https URLs from free text, in order. */
export function extractUrls(text: string, max = 3): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of text.matchAll(URL_RE)) {
    const url = match[0].replace(/[.,;:!?]+$/, '');
    if (!seen.has(url)) {
      seen.add(url);
      out.push(url);
      if (out.length >= max) break;
    }
  }
  return out;
}
