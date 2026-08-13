import { NetworkPolicyDenied, safeFetch } from '@/shared/network-policy/fetch';
import { externalApiPolicy } from '@/shared/network-policy/schema';
import { createLogger } from '@/shared/utils/logger';

// Neuma port of html-video's link → video ingestion (`fetch-source.ts`).
// SSRF defense is handled by Neuma's existing DNS-bound URL validator
// (`safeFetch` + externalApiPolicy) rather than html-video's IP-literal-only
// guard, per dev-doc/html-video/06-05/04-source-to-video-ingestion.md.

const logger = createLogger('VideoSourceIngest');

/** Max characters kept from an article body. Matches html-video's floor. */
export const ARTICLE_MAX_CHARS = 8_000;
/** Max characters kept from a repo README. */
export const README_MAX_CHARS = 10_000;
/** Hard timeout for a single source fetch. */
export const SOURCE_FETCH_TIMEOUT_MS = 12_000;
/** Hard cap on bytes read from a source body. */
export const SOURCE_FETCH_MAX_BYTES = 5 * 1024 * 1024;

// WeChat 公众号 pages are server-rendered for browser-like UAs only — keep the
// realistic Chrome-on-macOS UA so mp.weixin.qq.com still returns real HTML.
const REALISTIC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.4 Safari/605.1.15';

export interface FetchedSource {
  url: string;
  title: string;
  markdown: string;
  kind: 'article' | 'repo';
  truncated: boolean;
}

export class SourceIngestError extends Error {
  constructor(
    public readonly code:
      | 'ssrf-denied'
      | 'fetch-failed'
      | 'unsupported-content-type'
      | 'oversized-body'
      | 'extraction-empty',
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SourceIngestError';
  }
}

/** Extract up to `max` distinct http(s) URLs from free text, in order. */
export function extractUrls(text: string, max = 3): string[] {
  if (!text) return [];
  const re = /https?:\/\/[^\s<>"'`)\]}]+/gi;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    const u = m[0].replace(/[.,;:!?]+$/, '');
    if (!seen.has(u)) {
      seen.add(u);
      out.push(u);
      if (out.length >= max) break;
    }
  }
  return out;
}

const GITHUB_REPO_RE = /^https:\/\/github\.com\/[^\/]+\/[^\/]+\/?$/i;

/**
 * Server-side fetch of an article URL or GitHub repo, flattened to Markdown.
 *
 * Phase 4 M1 scaffold: routes through Neuma's `safeFetch` (which rejects
 * private IPs, redirect chains crossing public→private, and non-HTTPS),
 * applies the html-video byte caps + UA, and surfaces typed errors. The
 * full HTML→Markdown extractor and the GitHub API repo path land in M2/M3.
 */
export async function fetchSource(
  rawUrl: string,
  signal?: AbortSignal,
): Promise<FetchedSource> {
  if (!/^https:\/\//i.test(rawUrl)) {
    throw new SourceIngestError(
      'fetch-failed',
      `Only https:// URLs are supported (got "${rawUrl}")`,
    );
  }
  const isRepo = GITHUB_REPO_RE.test(rawUrl);
  const policy = externalApiPolicy();
  // Use the caller's signal verbatim when supplied so caller-side deadlines
  // win; otherwise fall back to our default timeout. Passing both signal and
  // timeoutMs would let safeFetch's internal timer race the caller's.
  const fetchSignal = signal ?? AbortSignal.timeout(SOURCE_FETCH_TIMEOUT_MS);

  let response: Awaited<ReturnType<typeof safeFetch>>;
  try {
    response = await safeFetch(rawUrl, policy, {
      method: 'GET',
      headers: {
        'User-Agent': REALISTIC_UA,
        Accept: isRepo
          ? 'application/vnd.github+json'
          : 'text/html,application/xhtml+xml',
      },
      signal: fetchSignal,
    });
  } catch (err) {
    if (err instanceof NetworkPolicyDenied) {
      throw new SourceIngestError(
        'ssrf-denied',
        `URL "${rawUrl}" rejected by network policy: ${err.message}`,
        err,
      );
    }
    logger.warn(`source fetch failed for ${rawUrl}: ${(err as Error).message}`);
    throw new SourceIngestError(
      'fetch-failed',
      `Failed to fetch ${rawUrl}: ${(err as Error).message}`,
      err,
    );
  }

  if (response.status < 200 || response.status >= 300) {
    throw new SourceIngestError(
      'fetch-failed',
      `${rawUrl} returned HTTP ${response.status}`,
    );
  }

  // safeFetch lowercases all response headers.
  const contentType = response.headers['content-type'] ?? '';
  if (!isRepo && !/^text\/(html|plain|markdown)/i.test(contentType)) {
    throw new SourceIngestError(
      'unsupported-content-type',
      `Unsupported content-type "${contentType}" for ${rawUrl}`,
    );
  }

  if (response.body.byteLength > SOURCE_FETCH_MAX_BYTES) {
    throw new SourceIngestError(
      'oversized-body',
      `Body for ${rawUrl} exceeds ${SOURCE_FETCH_MAX_BYTES} bytes`,
    );
  }
  const bodyRaw = response.body.toString('utf8');
  const cap = isRepo ? README_MAX_CHARS : ARTICLE_MAX_CHARS;
  // M2 will replace this with a real HTML→Markdown extractor; for the
  // scaffold we hand the raw body to the caller, capped + flagged truncated.
  // Tag-stripping here is deliberately conservative — it is not a sanitizer.
  const body = isRepo
    ? bodyRaw
    : bodyRaw
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, '')
        .trim();
  const truncated = body.length > cap;
  const markdown = truncated ? body.slice(0, cap) : body;

  if (!markdown) {
    throw new SourceIngestError(
      'extraction-empty',
      `No readable content extracted from ${rawUrl}`,
    );
  }

  const title = isRepo
    ? rawUrl.replace(/^https?:\/\/github\.com\//i, '')
    : (extractTitle(bodyRaw) ?? rawUrl);

  return {
    url: rawUrl,
    title,
    markdown,
    kind: isRepo ? 'repo' : 'article',
    truncated,
  };
}

function extractTitle(html: string): string | undefined {
  const m = /<title>([^<]+)<\/title>/i.exec(html);
  return m?.[1]?.trim();
}
