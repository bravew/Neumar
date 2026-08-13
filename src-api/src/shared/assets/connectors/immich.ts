import type { CloudStorageAdapter } from '@/shared/integrations/cloud-storage';
import type {
  ChangeCursorInput,
  ChangePage,
  CloudFile,
  ListChildrenInput,
  ListResult,
  SearchInput,
} from '@/shared/integrations/cloud-storage';

import type {
  AssetKind,
  AssetQuery,
  AssetSource,
  RemoteAssetInput,
} from '../types';

// Cloud-backed sources that can be catalog-synced via a CloudStorageAdapter.
export type CloudCatalogSource =
  | 'immich'
  | 'box'
  | 'google_drive'
  | 'dropbox'
  | 'onedrive';

export interface CatalogConnector {
  readonly source: CloudCatalogSource;
  readonly connectionId: string;
  fullList(input: ListChildrenInput): Promise<ListResult<CloudFile>>;
  delta(input: ChangeCursorInput): Promise<ChangePage>;
  search(input: AssetQuery): Promise<ListResult<CloudFile>>;
}

export function createCloudCatalogConnector(
  source: CloudCatalogSource,
  connectionId: string,
  adapter: CloudStorageAdapter,
): CatalogConnector {
  return {
    source,
    connectionId,
    fullList(input) {
      return adapter.search({
        query: '',
        cursor: input.cursor,
        limit: input.limit,
      });
    },
    delta(input) {
      return adapter.getChanges(input);
    },
    search(input) {
      return adapter.search(searchInputFromAssetQuery(input));
    },
  };
}

export function createImmichCatalogConnector(
  connectionId: string,
  adapter: CloudStorageAdapter,
): CatalogConnector {
  return createCloudCatalogConnector('immich', connectionId, adapter);
}

export function cloudFileToRemoteAsset(
  source: AssetSource,
  connectionId: string,
  file: CloudFile,
): RemoteAssetInput | null {
  if (file.isFolder) return null;

  const geo = file.mediaMetadata?.geo;
  const fileInfo = file.mediaMetadata?.fileInfo;
  return {
    source,
    connectionId,
    sourceId: file.id,
    kind: inferKind(file.mimeType),
    mime: file.mimeType || 'application/octet-stream',
    bytes: Number.isFinite(file.size) ? Math.max(0, file.size) : 0,
    width: fileInfo?.width ?? null,
    height: fileInfo?.height ?? null,
    durationMs:
      fileInfo?.durationSeconds === undefined
        ? null
        : Math.round(fileInfo.durationSeconds * 1000),
    contentHash: fileInfo?.checksum ?? file.etag ?? null,
    title: file.name,
    description: file.mediaMetadata?.description ?? null,
    capturedAt: parseDateMs(file.mediaMetadata?.takenAt ?? file.createdAt),
    modifiedAt: parseDateMs(file.modifiedAt),
    provenance: {
      provider: file.provider,
      webUrl: file.webUrl,
      path: file.path,
      thumbnailUrl: file.thumbnailUrl,
      etag: file.etag,
      revision: file.revision,
      owner: file.owner,
      shared: file.shared,
      licenseInfo: file.licenseInfo,
    },
    exif: {
      importedAt: file.mediaMetadata?.importedAt,
      timezoneOffsetMinutes: file.mediaMetadata?.timezoneOffsetMinutes,
      geo,
      people: file.mediaMetadata?.people,
      camera: file.mediaMetadata?.camera,
      fileInfo,
      isFavorite: file.mediaMetadata?.isFavorite,
      rating: file.mediaMetadata?.rating,
    },
    gpsLat: geo?.latitude ?? null,
    gpsLng: geo?.longitude ?? null,
    tags: file.mediaMetadata?.tags?.map((tag) => tag.value) ?? [],
  };
}

function searchInputFromAssetQuery(input: AssetQuery): SearchInput {
  return {
    query: input.text ?? '',
    cursor: input.cursor,
    limit: input.limit,
    searchMode: 'context',
    mediaKind: mediaKindFromAssetKinds(input.modalities),
    media: {
      takenAfter: isoFromMs(input.dateRange?.fromMs),
      takenBefore: isoFromMs(input.dateRange?.toMs),
    },
  };
}

function mediaKindFromAssetKinds(
  kinds: AssetKind[] | undefined,
): SearchInput['mediaKind'] {
  if (!kinds || kinds.length !== 1) return undefined;
  if (kinds[0] === 'image') return 'image';
  if (kinds[0] === 'video') return 'video';
  if (kinds[0] === 'audio') return 'audio';
  if (kinds[0] === 'pdf' || kinds[0] === 'doc' || kinds[0] === 'text') {
    return 'document';
  }
  return undefined;
}

function inferKind(mime: string): AssetKind {
  const normalized = mime.toLowerCase();
  if (normalized.startsWith('image/')) return 'image';
  if (normalized.startsWith('video/')) return 'video';
  if (normalized.startsWith('audio/')) return 'audio';
  if (normalized === 'application/pdf') return 'pdf';
  if (normalized.startsWith('text/')) return 'text';
  if (
    normalized.includes('document') ||
    normalized.includes('presentation') ||
    normalized.includes('spreadsheet')
  ) {
    return 'doc';
  }
  return 'other';
}

function parseDateMs(value: string | Date | undefined): number | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoFromMs(value: number | undefined): string | undefined {
  return value === undefined ? undefined : new Date(value).toISOString();
}
