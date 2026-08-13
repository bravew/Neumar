import path from 'node:path';

import type { NetworkPolicy } from '@/shared/network-policy/schema';
import { networkPolicySchema } from '@/shared/network-policy/schema';
import type { ProviderId } from '@/shared/video/types';

import type { BrollHit, BrollSearchRequest } from '../types';

export const BROLL_SEARCH_TIMEOUT_MS = 15_000;
export const BROLL_DOWNLOAD_TIMEOUT_MS = 120_000;
export const BROLL_SEARCH_MAX_BYTES = 4 * 1024 * 1024;
export const BROLL_DOWNLOAD_MAX_BYTES = 500 * 1024 * 1024;

export function providerPolicy(
  rules: Array<{
    name: string;
    host: string;
    paths?: string[];
    methods?: Array<'GET' | 'POST'>;
  }>,
): NetworkPolicy {
  return networkPolicySchema.parse({
    version: 1,
    default: 'deny',
    egress: rules.map((rule) => ({
      name: rule.name,
      host: rule.host,
      ports: [443],
      methods: rule.methods ?? ['GET'],
      paths: rule.paths ?? ['/'],
    })),
  });
}

export function clampBrollLimit(limit: number | undefined): number {
  return Math.min(Math.max(Math.floor(limit ?? 8), 1), 8);
}

export function trimQuery(query: string, max = 100): string {
  return query.trim().replace(/\s+/g, ' ').slice(0, max);
}

export function inferOrientation(
  request: Pick<BrollSearchRequest, 'orientation' | 'aspectRatio'>,
): 'landscape' | 'portrait' | 'square' | undefined {
  if (request.orientation) return request.orientation;
  if (request.aspectRatio === '9:16' || request.aspectRatio === '4:5') {
    return 'portrait';
  }
  if (request.aspectRatio === '1:1') return 'square';
  if (request.aspectRatio === '16:9') return 'landscape';
  return undefined;
}

export function matchesDuration(
  durationSec: number,
  range: BrollSearchRequest['durationRangeSec'],
): boolean {
  if (!range) return true;
  const [min, max] = range;
  return durationSec >= min && durationSec <= max;
}

export function matchesOrientation(
  width: number | undefined,
  height: number | undefined,
  orientation: ReturnType<typeof inferOrientation>,
): boolean {
  if (!orientation || !width || !height) return true;
  if (orientation === 'square') return Math.abs(width - height) <= 2;
  if (orientation === 'portrait') return height > width;
  return width > height;
}

export function preferredExtension(
  hit: Pick<BrollHit, 'fileExtension' | 'downloadUrl' | 'downloadMimeType'>,
): string {
  if (hit.fileExtension) return normalizeExtension(hit.fileExtension);
  const fromMime = extensionFromContentType(hit.downloadMimeType);
  if (fromMime) return fromMime;
  try {
    const ext = path.extname(new URL(hit.downloadUrl).pathname).toLowerCase();
    if (['.mp4', '.mov', '.webm'].includes(ext)) return ext;
  } catch {
    // Fall through to the safe default.
  }
  return '.mp4';
}

export function extensionFromContentType(
  contentType: string | undefined,
): string | undefined {
  const normalized = contentType?.split(';')[0]?.trim().toLowerCase();
  if (normalized === 'video/mp4') return '.mp4';
  if (normalized === 'video/quicktime') return '.mov';
  if (normalized === 'video/webm') return '.webm';
  return undefined;
}

export function isVideoContentType(contentType: string | undefined): boolean {
  const normalized = contentType?.split(';')[0]?.trim().toLowerCase() ?? '';
  return (
    normalized.startsWith('video/') ||
    normalized === 'application/octet-stream' ||
    normalized === 'binary/octet-stream'
  );
}

export function sanitizeFilenamePart(value: string): string {
  const safe = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return safe || 'broll';
}

export function isBrollProvider(value: string): value is ProviderId {
  return value === 'pexels' || value === 'pixabay' || value === 'storyblocks';
}

function normalizeExtension(extension: string): string {
  const normalized = extension.startsWith('.') ? extension : `.${extension}`;
  return ['.mp4', '.mov', '.webm'].includes(normalized.toLowerCase())
    ? normalized.toLowerCase()
    : '.mp4';
}
