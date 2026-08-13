import { API_BASE_URL } from '@/config';

const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;
const TRAILING_PUNCTUATION_RE = /[),.;!?]+$/;
const MAX_PREVIEW_URLS = 6;

export type LinkPreview =
  | {
      kind: 'video';
      provider: 'youtube' | 'vimeo';
      url: string;
      title: string;
      embedUrl: string;
      thumbnailUrl?: string;
      authorName?: string;
      width?: number;
      height?: number;
    }
  | {
      kind: 'image';
      url: string;
      title: string;
      imageUrl: string;
    }
  | {
      kind: 'web';
      url: string;
      title: string;
      description?: string;
      siteName?: string;
      imageUrl?: string;
    }
  | {
      kind: 'unsupported';
      url: string;
      reason: 'invalid-url' | 'blocked' | 'fetch-failed' | 'unsupported';
    };

export function extractPreviewUrls(content: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  for (const match of content.matchAll(URL_RE)) {
    const url = normalizeExtractedUrl(match[0]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
    if (urls.length >= MAX_PREVIEW_URLS) break;
  }

  return urls;
}

export async function fetchLinkPreview(
  url: string,
  signal?: AbortSignal,
): Promise<LinkPreview> {
  const response = await fetch(`${API_BASE_URL}/link-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
    signal,
  });

  if (!response.ok) {
    return { kind: 'unsupported', url, reason: 'fetch-failed' };
  }

  const payload = (await response.json()) as unknown;
  if (!isLinkPreview(payload)) {
    return { kind: 'unsupported', url, reason: 'unsupported' };
  }
  return payload;
}

const LINK_PREVIEW_KINDS = new Set<LinkPreview['kind']>([
  'video',
  'image',
  'web',
  'unsupported',
]);

function isLinkPreview(value: unknown): value is LinkPreview {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    LINK_PREVIEW_KINDS.has((value as { kind: LinkPreview['kind'] }).kind)
  );
}

function normalizeExtractedUrl(raw: string): string | null {
  let value = raw.trim().replace(TRAILING_PUNCTUATION_RE, '');
  while (value.endsWith(']') || value.endsWith('}')) {
    value = value.slice(0, -1);
  }

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}
