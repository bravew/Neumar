import { extractUrls, isVideoPlatformUrl } from '@/shared/video/extract-urls';
import { ingestSource } from '@/shared/video/source-ingest';

// Phase 4 M2/M3 — orchestrates composer URL ingestion: detect links in the
// user's message, fetch each server-side, and fold the extracted markdown into
// the agent prompt. Kept out of AgentDock so the component stays under the
// 350-line cap and the prompt-building logic is unit-testable.

/** Localized, user-facing status/error messages (agent-facing text is fixed). */
export interface SourceIngestMessages {
  /** Shown while links are being fetched. `{count}` = number of links. */
  fetching: string;
  /** Shown when a source body was truncated. `{title}` = source title. */
  truncated: string;
  /** Per-code failure messages; `unknown` is the fallback. */
  errors: Record<string, string>;
}

/** Max links ingested from a single composer message. */
const MAX_INGEST_URLS = 2;

/** Agent-facing source delimiter — deliberately not localized. */
function sourceBlock(title: string, url: string, markdown: string): string {
  const label = title ? `${title} (${url})` : url;
  return `[FETCHED SOURCE — ${label}]\n${markdown}\n[END FETCHED SOURCE]`;
}

/**
 * Detect URLs in `content`, ingest them, and return `basePrompt` with each
 * fetched source appended. Status + error feedback is sent via `emit`. When the
 * feature flag is off the server returns `source-ingestion-disabled`, which is
 * treated as a silent no-op (the raw URL stays in the prompt the user typed).
 */
export async function ingestComposerSources(
  content: string,
  basePrompt: string,
  messages: SourceIngestMessages,
  emit: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  // A video-platform link is the media itself — leave it in the prompt verbatim
  // so the agent downloads it with yt-dlp instead of us scraping its web page.
  const urls = extractUrls(content, MAX_INGEST_URLS).filter(
    (url) => !isVideoPlatformUrl(url),
  );
  if (urls.length === 0) return basePrompt;

  let prompt = basePrompt;
  let announced = false;
  for (const url of urls) {
    const result = await ingestSource(url, signal);
    // Caller unmounted / cancelled mid-fetch — `ingestSource` reports an aborted
    // fetch as `fetch-failed`, so check the signal directly and bail quietly
    // rather than emitting a spurious error against a dead component.
    if (signal?.aborted) return prompt;
    // Announce "Fetching…" only once we know ingestion is actually active. When
    // the `video.sourceIngestion` flag is off every call returns
    // `source-ingestion-disabled`, so a pre-loop emit would be a phantom status
    // with no follow-up.
    if (
      !announced &&
      (result.ok || result.code !== 'source-ingestion-disabled')
    ) {
      emit(messages.fetching.replace('{count}', String(urls.length)));
      announced = true;
    }
    if (result.ok) {
      const block = sourceBlock(
        result.source.title,
        result.source.url,
        result.source.markdown,
      );
      prompt = prompt ? `${prompt}\n\n${block}` : block;
      if (result.source.truncated) {
        emit(messages.truncated.replace('{title}', result.source.title));
      }
    } else if (result.code !== 'source-ingestion-disabled') {
      emit(messages.errors[result.code] ?? messages.errors.unknown);
    }
  }
  return prompt;
}
