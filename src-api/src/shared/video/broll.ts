import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { safeFetch } from '@/shared/network-policy/fetch';
import type { NetworkPolicy } from '@/shared/network-policy/schema';
import { validateInputFile } from '@/shared/services/ffmpeg';
import { createLogger } from '@/shared/utils/logger';
import { getVideoFeatureFlag } from '@/shared/video/flags';
import {
  mediaItemFromPath,
  getVideoAssetsDir,
  getVideoProjectRoot,
  updateProjectDocument,
} from '@/shared/video/store';
import { rebuildTimelineFromStoryboard } from '@/shared/video/timeline';

import {
  pexelsBrollProvider,
  pexelsDownloadPolicy,
  pixabayBrollProvider,
  pixabayDownloadPolicy,
  resolveBrollCredentials,
  storyblocksBrollProvider,
  storyblocksDownloadPolicy,
} from './plugins/atoms/broll/providers';
import {
  BROLL_DOWNLOAD_MAX_BYTES,
  BROLL_DOWNLOAD_TIMEOUT_MS,
  isVideoContentType,
  preferredExtension,
  sanitizeFilenamePart,
} from './plugins/atoms/broll/providers/common';
import type {
  BrollDownloadResult,
  BrollHit,
  BrollProviderAdapter,
  BrollProviderId,
  BrollSearchRequest,
} from './plugins/atoms/broll/types';
import type { MediaItem } from './types';

export type {
  BrollDownloadResult,
  BrollHit,
  BrollProviderId,
  BrollSearchRequest,
} from './plugins/atoms/broll/types';

const logger = createLogger('VideoBroll');

const BROLL_PROVIDERS: Record<BrollProviderId, BrollProviderAdapter> = {
  pexels: pexelsBrollProvider,
  pixabay: pixabayBrollProvider,
  storyblocks: storyblocksBrollProvider,
};

export async function searchBroll(
  request: BrollSearchRequest,
): Promise<BrollHit[]> {
  if (!getVideoFeatureFlag('video.plugins')) return [];
  const providers = request.provider
    ? [request.provider]
    : (['pexels', 'pixabay', 'storyblocks'] as const);
  const limit = Math.min(Math.max(request.limit ?? 8, 1), 8);
  const hits: BrollHit[] = [];
  const errors: Array<{ provider: BrollProviderId; error: string }> = [];

  for (const providerId of providers) {
    const credentials = resolveBrollCredentials(providerId);
    if (!credentials) continue;
    try {
      const providerHits = await BROLL_PROVIDERS[providerId].search(
        { ...request, limit: limit - hits.length, provider: providerId },
        credentials,
      );
      hits.push(...providerHits);
      if (hits.length >= limit) break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ provider: providerId, error: message });
      if (request.provider) throw error;
    }
  }

  if (hits.length === 0 && errors.length > 0) {
    logger.warn('video.broll.search_failed', { errors });
  }
  return hits.slice(0, limit);
}

export async function downloadBrollHit(
  projectId: string,
  hit: BrollHit,
): Promise<BrollDownloadResult> {
  if (!getVideoFeatureFlag('video.plugins')) {
    throw new Error('Video plugin atoms are disabled by video.plugins=false.');
  }
  const projectRoot = getVideoProjectRoot(projectId);
  const assetsDir = getVideoAssetsDir(projectId);
  await fs.mkdir(assetsDir, { recursive: true });

  const response = await safeFetch(
    hit.downloadUrl,
    downloadPolicy(hit.provider),
    {
      method: 'GET',
      headers: { Accept: 'video/*,application/octet-stream' },
      timeoutMs: BROLL_DOWNLOAD_TIMEOUT_MS,
      maxBytes: BROLL_DOWNLOAD_MAX_BYTES,
      maxRedirects: 2,
    },
  );
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `${providerLabel(hit.provider)} B-roll download failed: HTTP ${response.status}`,
    );
  }
  const contentType = response.headers['content-type'] ?? hit.downloadMimeType;
  if (!isVideoContentType(contentType)) {
    throw new Error(
      `${providerLabel(hit.provider)} B-roll download returned unsupported content-type "${contentType ?? 'unknown'}"`,
    );
  }

  const filename = [
    'broll',
    sanitizeFilenamePart(hit.provider),
    sanitizeFilenamePart(hit.id),
    randomUUID().replace(/-/g, '').slice(0, 8),
  ].join('-');
  const dest = path.join(assetsDir, `${filename}${preferredExtension(hit)}`);
  await fs.writeFile(dest, response.body);
  const validated = validateInputFile(dest, projectRoot);
  const asset = await brollAssetFromFile(
    validated,
    projectRoot,
    hit,
    contentType,
  );
  const saved = await updateProjectDocument(projectId, (current) =>
    rebuildTimelineFromStoryboard({
      ...current,
      assets: [...current.assets, asset],
      updatedAt: new Date().toISOString(),
    }),
  );
  return { project: saved, asset };
}

async function brollAssetFromFile(
  filePath: string,
  projectRoot: string,
  hit: BrollHit,
  _contentType: string | undefined,
): Promise<MediaItem> {
  const asset = await mediaItemFromPath(filePath, 'broll', projectRoot);
  return {
    ...asset,
    kind: 'video',
    metadata: {
      ...asset.metadata,
      ...(hit.width ? { width: asset.metadata.width ?? hit.width } : {}),
      ...(hit.height ? { height: asset.metadata.height ?? hit.height } : {}),
      durationMs:
        asset.metadata.durationMs > 0
          ? asset.metadata.durationMs
          : Math.round(hit.durationSec * 1000),
    },
    provenance: {
      provider: hit.provider,
      prompt: hit.query,
      hitId: hit.id,
      license: hit.license,
      attribution: hit.attribution,
      attributionRequired: hit.attributionRequired,
      commercialUse: hit.commercialUse,
      sourceUrl: hit.sourceUrl ?? hit.downloadUrl,
      sourceDisplayName: hit.sourceDisplayName ?? hit.attribution,
      sourceFetchedAt: new Date().toISOString(),
      thumbnailUrl: hit.thumbnailUrl ?? hit.previewUrl,
    },
  };
}

function downloadPolicy(provider: BrollProviderId): NetworkPolicy {
  if (provider === 'pexels') return pexelsDownloadPolicy();
  if (provider === 'pixabay') return pixabayDownloadPolicy();
  return storyblocksDownloadPolicy();
}

function providerLabel(provider: BrollProviderId): string {
  if (provider === 'pexels') return 'Pexels';
  if (provider === 'pixabay') return 'Pixabay';
  return 'Storyblocks';
}
