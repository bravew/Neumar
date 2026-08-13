import { LRUCache } from 'lru-cache';
import { z } from 'zod';

import { externalApiPolicy } from '@/shared/network-policy/schema';
import { NetworkPolicyDenied, safeFetch } from '@/shared/utils/url-validator';

const PREVIEW_TIMEOUT_MS = 5_000;
const HTML_MAX_BYTES = 320_000;
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ITEMS = 500;

const REALISTIC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36';

const IMAGE_EXTENSION_RE = /\.(?:png|jpe?g|webp|gif|avif)$/i;
const IMAGE_CONTENT_TYPE_RE = /^image\/(?:png|jpe?g|webp|gif|avif)\b/i;

const OEmbedResponseSchema = z.object({
  title: z.string().optional(),
  author_name: z.string().optional(),
  provider_name: z.string().optional(),
  thumbnail_url: z.string().optional(),
  thumbnail_width: z.number().optional(),
  thumbnail_height: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});

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

type OEmbedResponse = z.infer<typeof OEmbedResponseSchema>;
type UnsupportedReason = Extract<
  LinkPreview,
  { kind: 'unsupported' }
>['reason'];

interface VimeoRef {
  id: string;
  hash?: string;
}

const previewCache = new LRUCache<string, LinkPreview>({
  max: CACHE_MAX_ITEMS,
  ttl: CACHE_TTL_MS,
});

export async function getLinkPreview(rawUrl: string): Promise<LinkPreview> {
  const parsed = parseHttpUrl(rawUrl);
  if (!parsed) return unsupported(rawUrl, 'invalid-url');

  const normalizedUrl = normalizePreviewUrl(parsed);
  const cached = previewCache.get(normalizedUrl);
  if (cached) return cached;

  const preview = await resolveLinkPreview(parsed);
  previewCache.set(normalizedUrl, preview);
  return preview;
}

export async function resolveLinkPreview(url: URL): Promise<LinkPreview> {
  const youtubeId = extractYouTubeVideoId(url);
  if (youtubeId) return fetchYouTubePreview(url.toString(), youtubeId);

  const vimeoRef = extractVimeoVideoRef(url);
  if (vimeoRef) return fetchVimeoPreview(url.toString(), vimeoRef);

  if (isDirectImageUrl(url)) {
    return {
      kind: 'image',
      url: url.toString(),
      title: titleFromUrl(url),
      imageUrl: url.toString(),
    };
  }

  return fetchGenericWebPreview(url);
}

export function extractYouTubeVideoId(url: URL): string | null {
  const host = normalizedHost(url);
  if (host === 'youtu.be') {
    return cleanVideoId(url.pathname.split('/').filter(Boolean)[0]);
  }
  if (!host.endsWith('youtube.com') && !host.endsWith('youtube-nocookie.com')) {
    return null;
  }

  if (url.pathname === '/watch') {
    return cleanVideoId(url.searchParams.get('v'));
  }

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') {
    return cleanVideoId(parts[1]);
  }
  return null;
}

export function extractVimeoVideoRef(url: URL): VimeoRef | null {
  const host = normalizedHost(url);
  const parts = url.pathname.split('/').filter(Boolean);

  if (host === 'player.vimeo.com' && parts[0] === 'video') {
    const id = cleanNumericId(parts[1]);
    return id ? { id, hash: url.searchParams.get('h') ?? undefined } : null;
  }

  if (!host.endsWith('vimeo.com')) return null;

  const videoIndex = parts.indexOf('video');
  const idCandidate = videoIndex >= 0 ? parts[videoIndex + 1] : parts[0];
  const id = cleanNumericId(idCandidate);
  if (!id) return null;

  const hashCandidate =
    videoIndex >= 0
      ? parts[videoIndex + 2]
      : parts.length > 1
        ? parts[1]
        : null;
  return {
    id,
    hash: cleanVimeoHash(hashCandidate),
  };
}

export function parseHtmlPreview(html: string, pageUrl: string): LinkPreview {
  const meta = extractMeta(html);
  const page = new URL(pageUrl);
  const title =
    meta.get('og:title') ??
    meta.get('twitter:title') ??
    extractTitle(html) ??
    titleFromUrl(page);
  const description =
    meta.get('og:description') ?? meta.get('twitter:description');
  const siteName = meta.get('og:site_name') ?? page.hostname;
  const rawImage = meta.get('og:image') ?? meta.get('twitter:image');
  const imageUrl = rawImage ? safeResolvePublicUrl(rawImage, page) : undefined;

  return {
    kind: 'web',
    url: page.toString(),
    title,
    description,
    siteName,
    imageUrl,
  };
}

async function fetchYouTubePreview(
  originalUrl: string,
  videoId: string,
): Promise<LinkPreview> {
  const endpoint = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(originalUrl)}`;
  const oembed = await fetchOEmbed(endpoint);
  const width = oembed?.width;
  const height = oembed?.height;
  return {
    kind: 'video',
    provider: 'youtube',
    url: originalUrl,
    title: oembed?.title ?? 'YouTube video',
    authorName: oembed?.author_name,
    thumbnailUrl: safePublicUrl(oembed?.thumbnail_url),
    embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
    width,
    height,
  };
}

async function fetchVimeoPreview(
  originalUrl: string,
  ref: VimeoRef,
): Promise<LinkPreview> {
  const endpoint = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(originalUrl)}&responsive=true`;
  const oembed = await fetchOEmbed(endpoint);
  const hash = ref.hash ? `?h=${encodeURIComponent(ref.hash)}` : '';
  return {
    kind: 'video',
    provider: 'vimeo',
    url: originalUrl,
    title: oembed?.title ?? 'Vimeo video',
    authorName: oembed?.author_name,
    thumbnailUrl: safePublicUrl(oembed?.thumbnail_url),
    embedUrl: `https://player.vimeo.com/video/${ref.id}${hash}`,
    width: oembed?.width,
    height: oembed?.height,
  };
}

async function fetchGenericWebPreview(url: URL): Promise<LinkPreview> {
  let response: Awaited<ReturnType<typeof safeFetch>>;
  try {
    response = await safeFetch(url.toString(), externalApiPolicy(), {
      method: 'GET',
      timeoutMs: PREVIEW_TIMEOUT_MS,
      maxBytes: HTML_MAX_BYTES,
      headers: {
        'User-Agent': REALISTIC_UA,
        Accept: 'text/html,application/xhtml+xml,image/avif,image/webp,image/*',
      },
    });
  } catch (error) {
    return unsupported(
      url.toString(),
      error instanceof NetworkPolicyDenied ? 'blocked' : 'fetch-failed',
    );
  }

  if (response.status < 200 || response.status >= 300) {
    return unsupported(url.toString(), 'fetch-failed');
  }

  const contentType = response.headers['content-type'] ?? '';
  if (IMAGE_CONTENT_TYPE_RE.test(contentType)) {
    return {
      kind: 'image',
      url: response.finalUrl,
      title: titleFromUrl(new URL(response.finalUrl)),
      imageUrl: response.finalUrl,
    };
  }

  if (!/^text\/html\b/i.test(contentType)) {
    return unsupported(url.toString(), 'unsupported');
  }

  return parseHtmlPreview(response.body.toString('utf8'), response.finalUrl);
}

async function fetchOEmbed(endpoint: string): Promise<OEmbedResponse | null> {
  try {
    const response = await safeFetch(endpoint, externalApiPolicy(), {
      method: 'GET',
      timeoutMs: PREVIEW_TIMEOUT_MS,
      maxBytes: 96_000,
      headers: {
        'User-Agent': REALISTIC_UA,
        Accept: 'application/json',
      },
    });
    if (response.status < 200 || response.status >= 300) return null;
    const parsed = OEmbedResponseSchema.safeParse(
      JSON.parse(response.body.toString('utf8')),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function parseHttpUrl(rawUrl: string): URL | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url;
  } catch {
    return null;
  }
}

function normalizePreviewUrl(url: URL): string {
  const clone = new URL(url.toString());
  clone.hash = '';
  return clone.toString();
}

function normalizedHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, '');
}

function cleanVideoId(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/^[A-Za-z0-9_-]{6,}$/);
  return match ? value : null;
}

function cleanNumericId(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/^\d{3,}$/);
  return match ? value : null;
}

function cleanVimeoHash(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return /^[A-Za-z0-9_-]{6,}$/.test(value) ? value : undefined;
}

function isDirectImageUrl(url: URL): boolean {
  return url.protocol === 'https:' && IMAGE_EXTENSION_RE.test(url.pathname);
}

function titleFromUrl(url: URL): string {
  const last = decodeURIComponent(
    url.pathname.split('/').filter(Boolean).at(-1) ?? url.hostname,
  );
  return last.replace(/[-_]+/g, ' ').trim() || url.hostname;
}

function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? decodeHtml(match[1]).trim() : undefined;
}

function extractMeta(html: string): Map<string, string> {
  const meta = new Map<string, string>();
  for (const match of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const rawAttrs = match[1];
    if (!rawAttrs) continue;
    const attrs = parseAttributes(rawAttrs);
    const key = (attrs.property ?? attrs.name)?.toLowerCase();
    const content = attrs.content;
    if (key && content && !meta.has(key)) meta.set(key, decodeHtml(content));
  }
  return meta;
}

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe = /([A-Za-z_:.-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  for (const match of raw.matchAll(attrRe)) {
    const name = match[1];
    if (!name) continue;
    attrs[name.toLowerCase()] = match[3] ?? match[4] ?? match[5] ?? '';
  }
  return attrs;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeResolvePublicUrl(value: string, base: URL): string | undefined {
  try {
    return safePublicUrl(new URL(value, base).toString());
  } catch {
    return undefined;
  }
}

function safePublicUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function unsupported(url: string, reason: UnsupportedReason): LinkPreview {
  return { kind: 'unsupported', url, reason };
}
