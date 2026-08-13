import fs from 'node:fs/promises';
import path from 'node:path';

import type { CloudStorageAdapter } from '@/shared/integrations/cloud-storage';
import { runFFmpeg } from '@/shared/services/ffmpeg';
import type { LinkedAssetKind } from '@/shared/video/types';

import { canWriteThumbnail, thumbnailPathForAsset } from './cache';

const MAX_PROVIDER_THUMBNAIL_BYTES = 5 * 1024 * 1024;
const DEFAULT_THUMBNAIL_BUDGET_BYTES = 500 * 1024 * 1024;

export async function cacheLinkedAssetThumbnail(input: {
  adapter: CloudStorageAdapter;
  externalId: string;
  projectId: string;
  sourceId: string;
  assetId: string;
  kind: LinkedAssetKind;
  workspaceRoot: string;
  maxBytes?: number;
}): Promise<string | undefined> {
  const maxBytes = input.maxBytes ?? DEFAULT_THUMBNAIL_BUDGET_BYTES;
  const target = thumbnailPathForAsset(
    input.workspaceRoot,
    input.projectId,
    input.sourceId,
    input.assetId,
  );

  if (input.adapter.getThumbnail) {
    const cached = await cacheProviderThumbnail(input, target, maxBytes);
    if (cached) return cached;
  }

  if (input.adapter.provider === 'local_fs') {
    const cached = await cacheLocalThumbnail(input, target, maxBytes);
    if (cached) return cached;
  }

  return undefined;
}

async function cacheProviderThumbnail(
  input: {
    adapter: CloudStorageAdapter;
    externalId: string;
    projectId: string;
    sourceId: string;
    workspaceRoot: string;
  },
  target: string,
  maxBytes: number,
): Promise<string | undefined> {
  try {
    const response = await input.adapter.getThumbnail?.(input.externalId);
    if (!response?.ok) return undefined;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_PROVIDER_THUMBNAIL_BYTES) return undefined;
    if (
      !(await canWriteThumbnail(
        input.workspaceRoot,
        input.projectId,
        input.sourceId,
        maxBytes,
        buffer.length,
      ))
    ) {
      return undefined;
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, buffer);
    return path.relative(input.workspaceRoot, target);
  } catch {
    return undefined;
  }
}

async function cacheLocalThumbnail(
  input: {
    externalId: string;
    projectId: string;
    sourceId: string;
    assetId: string;
    kind: LinkedAssetKind;
    workspaceRoot: string;
  },
  target: string,
  maxBytes: number,
): Promise<string | undefined> {
  if (input.kind !== 'image' && input.kind !== 'video') return undefined;
  if (
    !(await canWriteThumbnail(
      input.workspaceRoot,
      input.projectId,
      input.sourceId,
      maxBytes,
      256 * 1024,
    ))
  ) {
    return undefined;
  }

  await fs.mkdir(path.dirname(target), { recursive: true });
  const args =
    input.kind === 'video'
      ? [
          '-ss',
          '1',
          '-i',
          input.externalId,
          '-frames:v',
          '1',
          '-vf',
          'scale=480:-2',
          target,
        ]
      : [
          '-i',
          input.externalId,
          '-frames:v',
          '1',
          '-vf',
          'scale=480:-2',
          target,
        ];

  try {
    await runFFmpeg(args);
    return path.relative(input.workspaceRoot, target);
  } catch {
    await fs.rm(target, { force: true });
    return undefined;
  }
}
