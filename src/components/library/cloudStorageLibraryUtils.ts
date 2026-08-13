import { API_BASE_URL } from '@/config';

import type { StockLicenseCode } from './LicenseFilter';
import type { MediaGridItem } from './MediaGridView';

export interface CloudStorageConnection {
  id: string;
  provider: string;
  displayName?: string | null;
  status: string;
  capabilities?: {
    preferredView?: 'tree-list' | 'media-grid';
    readOnly?: boolean;
    mediaMetadata?: {
      writableFields?: Array<'description' | 'isFavorite' | 'rating' | 'tags'>;
    };
  };
}

export interface CloudFile {
  id: string;
  name: string;
  path?: string;
  mimeType?: string;
  size?: number;
  createdAt?: string | Date;
  modifiedAt?: string | Date;
  isFolder?: boolean;
  itemCount?: number;
  thumbnailUrl?: string;
  previewUrl?: string;
  webUrl?: string;
  provider?: string;
  mediaMetadata?: {
    takenAt?: string;
    importedAt?: string;
    geo?: {
      latitude: number;
      longitude: number;
      city?: string;
      state?: string;
      country?: string;
    };
    people?: Array<{ id: string; name?: string }>;
    tags?: Array<{ id: string; value: string }>;
    description?: string;
    rating?: number;
    isFavorite?: boolean;
    camera?: {
      make?: string;
      model?: string;
      lensModel?: string;
      focalLengthMm?: number;
      apertureFNumber?: number;
      iso?: number;
      exposureSeconds?: number;
    };
    fileInfo?: {
      checksum?: string;
      originalPath?: string;
      width?: number;
      height?: number;
      durationSeconds?: number;
    };
  };
  licenseInfo?: MediaGridItem['licenseInfo'];
}

export type MediaKind = 'all' | NonNullable<MediaGridItem['kind']>;

export const MEDIA_KINDS: MediaKind[] = [
  'all',
  'image',
  'video',
  'audio',
  'document',
  'folder',
];

export const STOCK_PROVIDERS = new Set(['openverse', 'unsplash', 'pexels']);
export const MEDIA_GRID_PROVIDERS = new Set([
  'immich',
  'photoprism',
  ...STOCK_PROVIDERS,
]);

export function toMediaGridItem(
  item: CloudFile,
  options: { videoStreamUrl?: string; connectionId?: string } = {},
): MediaGridItem {
  const fileInfo = item.mediaMetadata?.fileInfo;
  return {
    id: item.id,
    name: item.name,
    kind: getKind(item),
    thumbnailUrl: rewriteThumbnailSentinel(
      usableImageUrl(item.thumbnailUrl),
      options.connectionId,
    ),
    previewUrl: rewriteThumbnailSentinel(
      usableImageUrl(item.previewUrl ?? item.webUrl),
      options.connectionId,
    ),
    videoStreamUrl: options.videoStreamUrl,
    videoMimeType: item.mimeType?.startsWith('video/')
      ? item.mimeType
      : undefined,
    takenAt: item.mediaMetadata?.takenAt ?? item.createdAt,
    modifiedAt: item.modifiedAt,
    // Only use the dedicated `itemCount` field (set by adapters that have
    // it — Immich albums). Do NOT fall back to `size`: Box reports the
    // recursive folder *byte size* there, which we previously mis-rendered
    // as "302,091,753 items" on a folder card.
    ...(item.isFolder
      ? typeof item.itemCount === 'number' && item.itemCount > 0
        ? { itemCount: item.itemCount }
        : {}
      : typeof item.size === 'number' && item.size > 0
        ? { sizeBytes: item.size }
        : {}),
    provider: item.provider,
    dimensions:
      fileInfo?.width && fileInfo.height
        ? {
            width: fileInfo.width,
            height: fileInfo.height,
            durationSec: fileInfo.durationSeconds,
          }
        : undefined,
    licenseInfo: item.licenseInfo,
  };
}

export function getKind(item: CloudFile): NonNullable<MediaGridItem['kind']> {
  if (item.isFolder) return 'folder';
  const mimeType = item.mimeType ?? '';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'document';
}

export function licenseMatches(
  item: MediaGridItem,
  licenses: StockLicenseCode[],
) {
  if (licenses.length === 0) return true;
  const license = item.licenseInfo?.license?.toLowerCase();
  return Boolean(license && licenses.some((value) => license.includes(value)));
}

function rewriteThumbnailSentinel(
  url: string | undefined,
  connectionId: string | undefined,
): string | undefined {
  if (!url) return url;
  const match = /^[\w-]+-thumbnail:(.+)$/.exec(url);
  if (!match) return url;
  if (!connectionId) return undefined;
  const assetId = match[1];
  return `${API_BASE_URL}/cloud-storage/connections/${encodeURIComponent(
    connectionId,
  )}/items/${encodeURIComponent(assetId)}/thumbnail`;
}

function usableImageUrl(url: string | undefined) {
  if (!url) return url;
  if (url.startsWith('http')) return url;
  if (/^[\w-]+-thumbnail:/.test(url)) return url;
  return url.includes(':') ? undefined : url;
}
