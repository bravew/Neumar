import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { safeFetch } from '@/shared/network-policy/fetch';
import { getVideoWorkspaceRoot } from '@/shared/video/store';

import type {
  BrollHit,
  BrollProviderAdapter,
  BrollSearchRequest,
} from '../types';
import {
  BROLL_SEARCH_MAX_BYTES,
  BROLL_SEARCH_TIMEOUT_MS,
  clampBrollLimit,
  inferOrientation,
  matchesDuration,
  matchesOrientation,
  providerPolicy,
  trimQuery,
} from './common';

interface PixabayVideoRendition {
  url?: string;
  width?: number;
  height?: number;
  size?: number;
  thumbnail?: string;
}

interface PixabayVideo {
  id?: number;
  pageURL?: string;
  tags?: string;
  duration?: number;
  user_id?: number;
  user?: string;
  videos?: Record<string, PixabayVideoRendition | undefined>;
}

interface PixabaySearchResponse {
  hits?: PixabayVideo[];
}

const PIXABAY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PIXABAY_API_POLICY = providerPolicy([
  { name: 'pixabay-video-api', host: 'pixabay.com', paths: ['/api/videos/'] },
]);

export const pixabayBrollProvider: BrollProviderAdapter = {
  id: 'pixabay',
  async search(request, credentials) {
    const query = trimQuery(request.query, 100);
    if (!query) return [];
    const limit = clampBrollLimit(request.limit);
    const cached = await readPixabayCache(request, query, limit);
    const parsed =
      cached ??
      (await fetchPixabaySearch(request, credentials.apiKey, query, limit));
    if (!cached) await writePixabayCache(request, query, limit, parsed);
    return (parsed.hits ?? [])
      .flatMap((video) => pixabayVideoToHit(video, request, query))
      .slice(0, limit);
  },
};

export function pixabayDownloadPolicy() {
  return providerPolicy([
    { name: 'pixabay-video-cdn', host: 'cdn.pixabay.com', paths: ['/video/'] },
    {
      name: 'pixabay-video-page',
      host: 'pixabay.com',
      paths: ['/videos/', '/get/'],
    },
  ]);
}

async function fetchPixabaySearch(
  request: BrollSearchRequest,
  apiKey: string,
  query: string,
  limit: number,
): Promise<PixabaySearchResponse> {
  const url = new URL('https://pixabay.com/api/videos/');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('q', query);
  url.searchParams.set('per_page', String(Math.max(3, limit)));
  url.searchParams.set('safesearch', 'true');
  const response = await safeFetch(url.toString(), PIXABAY_API_POLICY, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    timeoutMs: BROLL_SEARCH_TIMEOUT_MS,
    maxBytes: BROLL_SEARCH_MAX_BYTES,
    maxRedirects: 0,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Pixabay video search failed: HTTP ${response.status}`);
  }
  return JSON.parse(response.body.toString('utf8')) as PixabaySearchResponse;
}

function pixabayVideoToHit(
  video: PixabayVideo,
  request: BrollSearchRequest,
  query: string,
): BrollHit[] {
  if (
    !video.id ||
    !video.duration ||
    !matchesDuration(video.duration, request.durationRangeSec)
  ) {
    return [];
  }
  const orientation = inferOrientation(request);
  const renditions = Object.entries(video.videos ?? {})
    .map(([name, rendition]) => ({ name, ...(rendition ?? {}) }))
    .filter(
      (rendition) =>
        rendition.url &&
        rendition.width &&
        rendition.height &&
        matchesOrientation(rendition.width, rendition.height, orientation),
    );
  const selected = selectPixabayRendition(renditions);
  if (!selected?.url) return [];
  const previewUrl = selected.thumbnail ?? selected.url;
  const attribution = video.user
    ? `Video by ${video.user} on Pixabay`
    : 'Video from Pixabay';
  return [
    {
      id: String(video.id),
      provider: 'pixabay',
      previewUrl,
      thumbnailUrl: previewUrl,
      downloadUrl: selected.url,
      downloadMimeType: 'video/mp4',
      fileExtension: '.mp4',
      widths: renditions
        .map((rendition) => rendition.width)
        .filter((width): width is number => typeof width === 'number'),
      width: selected.width,
      height: selected.height,
      durationSec: video.duration,
      license: 'Pixabay Content License',
      attribution,
      attributionUrl:
        video.user && video.user_id
          ? `https://pixabay.com/users/${encodeURIComponent(video.user)}-${video.user_id}/`
          : video.pageURL,
      attributionRequired: false,
      commercialUse: true,
      sourceUrl: video.pageURL,
      sourceDisplayName: video.tags ? `Pixabay: ${video.tags}` : attribution,
      providerLinkLabel: 'Videos provided by Pixabay',
      query,
    },
  ];
}

function selectPixabayRendition<
  T extends PixabayVideoRendition & { name: string },
>(renditions: T[]): T | undefined {
  return [...renditions].sort(
    (a, b) => scorePixabayRendition(b) - scorePixabayRendition(a),
  )[0];
}

function scorePixabayRendition(
  rendition: PixabayVideoRendition & { name: string },
): number {
  const nameScore =
    rendition.name === 'medium'
      ? 2_000_000
      : rendition.name === 'large'
        ? 1_500_000
        : rendition.name === 'small'
          ? 500_000
          : 0;
  return (rendition.width ?? 0) * (rendition.height ?? 0) + nameScore;
}

async function readPixabayCache(
  request: BrollSearchRequest,
  query: string,
  limit: number,
): Promise<PixabaySearchResponse | null> {
  const filePath = pixabayCachePath(request, query, limit);
  try {
    const stat = await fs.stat(filePath);
    if (Date.now() - stat.mtimeMs > PIXABAY_CACHE_TTL_MS) return null;
    return JSON.parse(
      await fs.readFile(filePath, 'utf8'),
    ) as PixabaySearchResponse;
  } catch {
    return null;
  }
}

async function writePixabayCache(
  request: BrollSearchRequest,
  query: string,
  limit: number,
  payload: PixabaySearchResponse,
): Promise<void> {
  const filePath = pixabayCachePath(request, query, limit);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload)}\n`);
}

function pixabayCachePath(
  request: BrollSearchRequest,
  query: string,
  limit: number,
): string {
  const key = createHash('sha256')
    .update(
      JSON.stringify({
        query,
        limit,
        durationRangeSec: request.durationRangeSec,
        aspectRatio: request.aspectRatio,
        orientation: request.orientation,
      }),
    )
    .digest('hex')
    .slice(0, 32);
  return path.join(
    getVideoWorkspaceRoot(),
    '.cache',
    'video',
    'pixabay-broll',
    `${key}.json`,
  );
}
