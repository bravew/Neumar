import { createHmac } from 'node:crypto';

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
  providerPolicy,
  trimQuery,
} from './common';

interface StoryblocksItem {
  id?: string | number;
  stock_item_id?: string | number;
  title?: string;
  duration?: number;
  details_url?: string;
  preview_url?: string;
  thumbnail_url?: string;
  download_url?: string;
  download_formats?: string[];
}

interface StoryblocksSearchResponse {
  info?: StoryblocksItem[];
  results?: StoryblocksItem[];
}

const STORYBLOCKS_POLICY = providerPolicy([
  { name: 'storyblocks-api', host: 'api.storyblocks.com', paths: ['/api/'] },
  { name: 'videoblocks-api', host: 'api.videoblocks.com', paths: ['/api/'] },
]);

export const storyblocksBrollProvider: BrollProviderAdapter = {
  id: 'storyblocks',
  async search(request, credentials) {
    if (!credentials.publicKey || !credentials.privateKey) return [];
    const query = trimQuery(request.query, 100);
    if (!query) return [];
    const limit = clampBrollLimit(request.limit);
    const resource = '/api/v2/videos/search';
    const expires = Math.floor(Date.now() / 1000);
    const hmac = createHmac('sha256', `${credentials.privateKey}${expires}`)
      .update(resource)
      .digest('hex');
    const url = new URL(
      resource,
      `${credentials.baseUrl.replace(/\/+$/, '')}/`,
    );
    url.searchParams.set('APIKEY', credentials.publicKey);
    url.searchParams.set('EXPIRES', String(expires));
    url.searchParams.set('HMAC', hmac);
    url.searchParams.set('project_id', credentials.projectId ?? 'neuma');
    url.searchParams.set('user_id', credentials.userId ?? 'neuma');
    url.searchParams.set('keywords', query);
    url.searchParams.set('content_type', 'footage,motionbackgrounds');
    url.searchParams.set('safe_search', 'true');
    url.searchParams.set('results_per_page', String(limit));
    const [minDuration, maxDuration] = request.durationRangeSec ?? [];
    if (minDuration) url.searchParams.set('min_duration', String(minDuration));
    if (maxDuration) url.searchParams.set('max_duration', String(maxDuration));
    const orientation = inferOrientation(request);
    // Storyblocks only supports horizontal/vertical; it has no square filter.
    // Omit the param for square requests and rely on client-side
    // matchesOrientation() so we don't silently fetch portrait results.
    if (orientation === 'landscape' || orientation === 'portrait') {
      url.searchParams.set(
        'orientation',
        orientation === 'landscape' ? 'horizontal' : 'vertical',
      );
    }

    const response = await safeFetch(url.toString(), STORYBLOCKS_POLICY, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      timeoutMs: BROLL_SEARCH_TIMEOUT_MS,
      maxBytes: BROLL_SEARCH_MAX_BYTES,
      maxRedirects: 0,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `Storyblocks video search failed: HTTP ${response.status}`,
      );
    }
    const parsed = JSON.parse(
      response.body.toString('utf8'),
    ) as StoryblocksSearchResponse;
    return [...(parsed.info ?? []), ...(parsed.results ?? [])]
      .flatMap((item) => storyblocksItemToHit(item, request, query))
      .slice(0, limit);
  },
};

export function storyblocksDownloadPolicy() {
  return providerPolicy([
    {
      name: 'storyblocks-api-download',
      host: 'api.storyblocks.com',
      paths: ['/api/'],
    },
    {
      name: 'videoblocks-api-download',
      host: 'api.videoblocks.com',
      paths: ['/api/'],
    },
    { name: 'storyblocks-cdn', host: '*.storyblocks.com', paths: ['/'] },
    { name: 'videoblocks-cdn', host: '*.videoblocks.com', paths: ['/'] },
  ]);
}

function storyblocksItemToHit(
  item: StoryblocksItem,
  request: BrollSearchRequest,
  query: string,
): BrollHit[] {
  const id = item.id ?? item.stock_item_id;
  if (!id || !item.preview_url) return [];
  const durationSec = typeof item.duration === 'number' ? item.duration : 0;
  if (!matchesDuration(durationSec, request.durationRangeSec)) return [];
  return [
    {
      id: String(id),
      provider: 'storyblocks',
      previewUrl: item.thumbnail_url ?? item.preview_url,
      thumbnailUrl: item.thumbnail_url,
      downloadUrl: item.download_url ?? item.preview_url,
      downloadMimeType: 'video/mp4',
      fileExtension: '.mp4',
      widths: [],
      durationSec,
      license: 'Storyblocks API License',
      attribution: item.title
        ? `${item.title} on Storyblocks`
        : 'Storyblocks stock video',
      attributionRequired: false,
      commercialUse: true,
      sourceUrl: item.details_url,
      sourceDisplayName: item.title,
      providerLinkLabel: 'Video provided by Storyblocks',
      query,
    },
  ];
}
