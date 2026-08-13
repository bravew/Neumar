import type { ImmichBridgeAsset } from './types';

export interface CloudStorageItem {
  id: string;
  size: number;
  etag?: string;
  mediaMetadata?: {
    fileInfo?: {
      originalPath?: string;
      checksum?: string;
    };
  };
}

export function findBridgeSampleAsset(
  items: CloudStorageItem[],
): ImmichBridgeAsset | undefined {
  for (const item of items) {
    const fileInfo = item.mediaMetadata?.fileInfo;
    if (!fileInfo?.originalPath || item.size <= 0) continue;
    return {
      id: item.id,
      originalPath: fileInfo.originalPath,
      fileSizeBytes: item.size,
      checksum: fileInfo.checksum ?? item.etag,
    };
  }
  return undefined;
}

export function deriveSuggestedPrefixes(originalPath: string): string[] {
  const normalized = originalPath.replaceAll('\\', '/');
  const prefixes = new Set<string>();
  for (const base of [
    '/usr/src/app/external/',
    '/usr/src/app/upload/library/',
  ]) {
    if (normalized.startsWith(base)) {
      prefixes.add(prefixThroughNextSegment(normalized, base));
    }
  }
  prefixes.add(normalized.slice(0, normalized.lastIndexOf('/') + 1));
  return Array.from(prefixes).filter(Boolean);
}

function prefixThroughNextSegment(value: string, base: string): string {
  const rest = value.slice(base.length);
  const nextSlash = rest.indexOf('/');
  return nextSlash === -1 ? base : `${base}${rest.slice(0, nextSlash + 1)}`;
}
