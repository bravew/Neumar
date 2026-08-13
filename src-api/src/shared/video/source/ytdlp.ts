import path from 'node:path';

import { validateBaseUrlForFetch } from '@/shared/utils/url-validator';
import { getVideoProjectDir } from '@/shared/video/store';

export interface YtDlpImportInput {
  projectId: string;
  sourceId: string;
  url: string;
  maxDurationSec?: number;
  format?: 'mp4' | 'best';
}

export async function validateYtDlpUrl(url: string): Promise<void> {
  const result = await validateBaseUrlForFetch(url, 'GET');
  if (!result.valid) {
    throw new Error(result.reason ?? 'URL is not allowed');
  }
}

export function buildYtDlpArgs(input: YtDlpImportInput): string[] {
  const sourceDir = path.join(
    getVideoProjectDir(input.projectId),
    'sources',
    input.sourceId,
  );
  const outputTemplate = path.join(sourceDir, '%(id)s.%(ext)s');
  const args = [
    '--ignore-config',
    '--no-playlist',
    '--restrict-filenames',
    '--write-info-json',
    '--clean-info-json',
    '--merge-output-format',
    'mp4',
    '--paths',
    sourceDir,
    '--output',
    outputTemplate,
  ];

  if (input.maxDurationSec) {
    args.push('--match-filter', `duration <= ${input.maxDurationSec}`);
  }
  if (input.format === 'mp4') {
    args.push('-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/mp4/best');
  } else {
    args.push('-f', 'bestvideo*+bestaudio/best');
  }
  args.push(input.url);
  return args;
}

export interface YtDlpErrorClassification {
  /**
   * Safe, secret-free, agent-facing summary. yt-dlp's raw stderr can contain
   * cookies, auth tokens, or signed URLs, so callers must surface THIS message
   * and never the raw stderr.
   */
  message: string;
  /** Whether retrying the same URL could plausibly succeed. */
  retryable: boolean;
  /** Coarse category, for logging/metrics. */
  category:
    | 'forbidden'
    | 'unavailable'
    | 'geo'
    | 'age'
    | 'network'
    | 'unsupported'
    | 'outdated'
    | 'unknown';
}

/**
 * Classify a failed yt-dlp run into a safe, actionable message.
 *
 * The agent only ever saw "yt-dlp failed with exit code 1", which it cannot
 * distinguish from a transient error — so it retried indefinitely (39 sub-agents
 * in one observed session). This maps the (secret-bearing) stderr to a static,
 * secret-free message plus a `retryable` flag the caller can relay, WITHOUT
 * echoing the raw stderr.
 */
export function classifyYtDlpError(
  stderr: string,
  exitCode: number | null,
): YtDlpErrorClassification {
  const s = stderr.toLowerCase();
  const has = (...needles: string[]) => needles.some((n) => s.includes(n));

  // HTTP 403 / bot gating — YouTube refused to serve the media. Not retryable.
  if (
    has(
      'http error 403',
      'forbidden',
      'sign in to confirm',
      'not a bot',
      'confirm your age',
    )
  ) {
    return {
      category: 'forbidden',
      retryable: false,
      message:
        'YouTube refused the download (HTTP 403 / bot or sign-in check). The video is gated and cannot be fetched without authenticated cookies. Do NOT retry — ask the user to download it manually or supply a local file.',
    };
  }

  // Private / members-only / removed.
  if (
    has(
      'private video',
      'members-only',
      'login required',
      'video unavailable',
      'video is unavailable',
      'has been removed',
      'account associated with this video has been terminated',
    )
  ) {
    return {
      category: 'unavailable',
      retryable: false,
      message:
        'The video is private, members-only, or no longer available. Retrying will not help — ask the user for a different source or a local file.',
    };
  }

  // Geo restriction.
  if (has('not available in your country', 'geo restrict', 'geo-restrict')) {
    return {
      category: 'geo',
      retryable: false,
      message:
        'The video is geo-restricted in this region. Retrying will not help — ask the user for a different source.',
    };
  }

  // Age restriction.
  if (has('age-restricted', 'age restricted', 'inappropriate for some users')) {
    return {
      category: 'age',
      retryable: false,
      message:
        'The video is age-restricted and needs authenticated cookies. Retrying will not help.',
    };
  }

  // Transient network errors — a single retry is reasonable.
  if (
    has(
      'timed out',
      'timeout',
      'unable to connect',
      'connection reset',
      'temporary failure',
      'network is unreachable',
      'getaddrinfo',
      'read operation timed out',
    )
  ) {
    return {
      category: 'network',
      retryable: true,
      message:
        'A network error occurred while contacting YouTube. You may retry once; if it fails again, stop and tell the user.',
    };
  }

  // Unsupported / malformed URL.
  if (has('unsupported url', 'is not a valid url', 'no video formats found')) {
    return {
      category: 'unsupported',
      retryable: false,
      message:
        'The URL is not a supported video source. Retrying will not help — verify the URL with the user.',
    };
  }

  // Outdated yt-dlp / upstream API change.
  if (has('out of date', 'update to', 'please report this issue')) {
    return {
      category: 'outdated',
      retryable: false,
      message:
        'yt-dlp may be out of date or YouTube changed its API. Retrying will not help until yt-dlp is updated on the host.',
    };
  }

  return {
    category: 'unknown',
    retryable: false,
    message: `yt-dlp failed (exit code ${exitCode ?? 'unknown'}). Retrying the same URL is unlikely to help; check the server logs for details.`,
  };
}
