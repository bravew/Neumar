import { safeFetch } from '@/shared/network-policy/fetch';

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

interface PexelsVideoFile {
  id?: number;
  quality?: string;
  file_type?: string;
  width?: number;
  height?: number;
  fps?: number;
  link?: string;
}

interface PexelsVideo {
  id?: number;
  width?: number;
  height?: number;
  url?: string;
  image?: string;
  duration?: number;
  user?: { id?: number; name?: string; url?: string };
  video_files?: PexelsVideoFile[];
  video_pictures?: Array<{ picture?: string }>;
}

interface PexelsSearchResponse {
  videos?: PexelsVideo[];
}

const PEXELS_API_POLICY = providerPolicy([
  { name: 'pexels-api', host: 'api.pexels.com', paths: ['/v1/videos/'] },
]);

export const pexelsBrollProvider: BrollProviderAdapter = {
  id: 'pexels',
  async search(request, credentials) {
    const query = trimQuery(request.query, 200);
    if (!query) return [];
    const limit = clampBrollLimit(request.limit);
    const url = new URL(
      'videos/search',
      `${credentials.baseUrl.replace(/\/+$/, '')}/`,
    );
    url.searchParams.set('query', query);
    url.searchParams.set('per_page', String(limit));
    const orientation = inferOrientation(request);
    if (orientation) url.searchParams.set('orientation', orientation);

    const response = await safeFetch(url.toString(), PEXELS_API_POLICY, {
      method: 'GET',
      headers: {
        Authorization: credentials.apiKey,
        Accept: 'application/json',
      },
      timeoutMs: BROLL_SEARCH_TIMEOUT_MS,
      maxBytes: BROLL_SEARCH_MAX_BYTES,
      maxRedirects: 0,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Pexels video search failed: HTTP ${response.status}`);
    }

    const parsed = JSON.parse(
      response.body.toString('utf8'),
    ) as PexelsSearchResponse;
    return (parsed.videos ?? [])
      .flatMap((video) => pexelsVideoToHit(video, request, query))
      .slice(0, limit);
  },
};

export function pexelsDownloadPolicy() {
  return providerPolicy([
    { name: 'pexels-vimeo-video', host: 'player.vimeo.com', paths: ['/'] },
    { name: 'pexels-vimeo-video-wildcard', host: '*.vimeo.com', paths: ['/'] },
    { name: 'pexels-static-video', host: 'static-videos.pexels.com' },
    { name: 'pexels-video-cdn', host: 'videos.pexels.com' },
    { name: 'pexels-image-cdn', host: 'images.pexels.com' },
  ]);
}

function pexelsVideoToHit(
  video: PexelsVideo,
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
  const files = (video.video_files ?? []).filter(
    (file) =>
      file.link &&
      file.width &&
      file.height &&
      matchesOrientation(file.width, file.height, orientation),
  );
  const selected = selectPexelsVideoFile(files);
  if (!selected?.link) return [];
  const attribution = video.user?.name
    ? `Video by ${video.user.name} on Pexels`
    : 'Video from Pexels';
  const previewUrl =
    video.image ??
    video.video_pictures?.find((picture) => picture.picture)?.picture ??
    selected.link;
  return [
    {
      id: String(video.id),
      provider: 'pexels',
      previewUrl,
      thumbnailUrl: previewUrl,
      downloadUrl: selected.link,
      downloadMimeType: selected.file_type,
      fileExtension: selected.file_type === 'video/webm' ? '.webm' : '.mp4',
      widths: files
        .map((file) => file.width)
        .filter((width): width is number => typeof width === 'number'),
      width: selected.width,
      height: selected.height,
      durationSec: video.duration,
      license: 'Pexels License',
      attribution,
      attributionUrl: video.user?.url ?? video.url,
      attributionRequired: false,
      commercialUse: true,
      sourceUrl: video.url,
      sourceDisplayName: attribution,
      providerLinkLabel: 'Videos provided by Pexels',
      query,
    },
  ];
}

function selectPexelsVideoFile(
  files: PexelsVideoFile[],
): PexelsVideoFile | undefined {
  return [...files].sort((a, b) => scorePexelsFile(b) - scorePexelsFile(a))[0];
}

function scorePexelsFile(file: PexelsVideoFile): number {
  const width = file.width ?? 0;
  const height = file.height ?? 0;
  const pixels = width * height;
  const quality = file.quality === 'hd' ? 1_000_000 : 0;
  const mp4 = file.file_type === 'video/mp4' ? 100_000 : 0;
  const widthPenalty = width > 2200 ? width - 2200 : 0;
  return pixels + quality + mp4 - widthPenalty;
}
