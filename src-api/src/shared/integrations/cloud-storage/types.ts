// shape mirrors src-site packages/features/agents/cloud-storage/src/types/provider.ts
export type CloudStorageProvider =
  | 'local_fs'
  | 'google_drive'
  | 'dropbox'
  | 'box'
  | 'onedrive'
  | 's3_compatible'
  | 'immich'
  | 'photoprism'
  | 'openverse'
  | 'unsplash'
  | 'pexels'
  | 'pixabay'
  | 'coverr'
  | 'videvo';

// shape mirrors src-site packages/features/agents/cloud-storage/src/types/operations.ts
export interface Capabilities {
  fullTextSearch: boolean;
  thumbnails: boolean;
  exportContent: boolean;
  watch: boolean;
  longPoll: boolean;
  sharedDrives: boolean;
  extractedTextRepresentation?: boolean;
  mediaMetadata?: {
    structuredSearch: boolean;
    writableFields: Array<'description' | 'isFavorite' | 'rating' | 'tags'>;
  };
  licenseInfo?: {
    attributionRequired: boolean;
    downloadTrackingRequired: boolean;
  };
  lanBridge?: {
    available: boolean;
    verifiedMappings: number;
    totalMappings: number;
    writeModes?: Array<'api-only' | 'direct-then-scan'>;
  };
}

export interface MediaMetadata {
  takenAt?: string;
  importedAt?: string;
  timezoneOffsetMinutes?: number;
  geo?: {
    latitude: number;
    longitude: number;
    altitude?: number;
    accuracyMeters?: number;
    placeName?: string;
    city?: string;
    state?: string;
    country?: string;
  };
  people?: Array<{
    id: string;
    name?: string;
    confidence?: number;
    isHidden?: boolean;
    isFavorite?: boolean;
    boundingBox?: { x: number; y: number; width: number; height: number };
  }>;
  tags?: Array<{ id: string; value: string; isPath?: boolean }>;
  description?: string;
  isFavorite?: boolean;
  rating?: number;
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
    checksumAlgorithm?: 'sha1' | 'sha256' | 'md5' | 'unknown';
    originalPath?: string;
    durationSeconds?: number;
    width?: number;
    height?: number;
    orientation?: number;
  };
}

export interface LicenseInfo {
  provider?: string;
  license?: string;
  licenseUrl?: string;
  attributionText?: string;
  attributionUrl?: string;
  creatorName?: string;
  creatorUrl?: string;
  downloadTrackingUrl?: string;
  requiresAttribution?: boolean;
  requiresDownloadTracking?: boolean;
}

// shape mirrors src-site packages/features/agents/cloud-storage/src/types/file.ts
export interface CloudFile {
  id: string;
  name: string;
  path?: string;
  mimeType: string;
  size: number;
  createdAt: string | Date;
  modifiedAt: string | Date;
  parentId: string | null;
  isFolder: boolean;
  provider: CloudStorageProvider;
  webUrl?: string;
  thumbnailUrl?: string;
  etag?: string;
  revision?: string;
  owner?: { id?: string; name?: string; email?: string };
  shared?: boolean;
  // For folders: number of children, when the provider returns it cheaply.
  // Immich albums populate this from `assetCount`. Box and Google Drive do
  // not return a child count on their list endpoints, so they leave it
  // unset rather than expose the recursive byte-size as if it were a count.
  itemCount?: number;
  mediaMetadata?: MediaMetadata;
  licenseInfo?: LicenseInfo;
}

// shape mirrors src-site packages/features/agents/cloud-storage/src/types/file.ts
export interface FileContent {
  fileId: string;
  content: string;
  mimeType: string;
  size?: number;
  isBase64?: boolean;
}

// shape mirrors src-site packages/features/agents/cloud-storage/src/types/operations.ts
export interface Page<T> {
  items: T[];
  totalCount?: number;
  nextCursor?: string;
  hasMore: boolean;
}

export type ListResult<T> = Page<T>;

export interface ItemRef {
  connectionId: string;
  providerItemId: string;
}

export interface ListChildrenInput {
  parentId?: string | null;
  cursor?: string;
  limit?: number;
  includeTrashed?: boolean;
  mimeTypes?: string[];
}

export type SearchMode = 'context' | 'filename' | 'description' | 'ocr';

export interface SearchInput extends ListChildrenInput {
  query: string;
  nameOnly?: boolean;
  fileTypes?: string[];
  mediaKind?: 'image' | 'video' | 'audio' | 'document';
  licenseFilter?: string[];
  orientation?: 'landscape' | 'portrait' | 'square';
  colorPalette?: string;
  searchMode?: SearchMode;
  minDimensions?: {
    width: number;
    height: number;
  };
  place?: {
    country?: string;
    state?: string;
    city?: string;
  };
  camera?: {
    make?: string;
    model?: string;
    lensModel?: string;
  };
  media?: {
    takenAfter?: string;
    takenBefore?: string;
    importedAfter?: string;
    importedBefore?: string;
    personIds?: string[];
    tagIds?: string[];
    isFavorite?: boolean;
    isArchived?: boolean;
    isInAlbum?: boolean;
    minRating?: number;
    geoBounds?: {
      north: number;
      south: number;
      east: number;
      west: number;
    };
  };
}

export type TimelineBucketSize = 'day' | 'month';

export interface TimelineBucketsInput {
  size?: TimelineBucketSize;
  parentId?: string | null;
  isFavorite?: boolean;
  mediaKind?: 'image' | 'video' | 'audio' | 'document';
}

export interface TimelineBucket {
  bucket: string;
  count: number;
}

export interface TimelineBucketsResult {
  size: TimelineBucketSize;
  buckets: TimelineBucket[];
}

export interface ExportInput {
  providerItemId: string;
  mimeType?: string;
}

export interface UploadInput {
  parentId: string | null;
  name: string;
  content: BodyInit;
  mimeType?: string;
  overwrite?: boolean;
  metadata?: Record<string, string>;
}

export interface MetadataUpdateInput {
  name?: string;
  metadata?: Record<string, string>;
}

export interface CopyMoveInput {
  providerItemId: string;
  newParentId: string;
  newName?: string;
  overwrite?: boolean;
}

export interface ChangeCursorInput {
  cursor?: string;
  limit?: number;
  rootId?: string | null;
}

export interface ChangeEvent {
  id: string;
  type: 'created' | 'updated' | 'deleted';
  itemId: string;
  item?: CloudFile;
  occurredAt?: string | Date;
}

export interface ChangePage {
  changes: ChangeEvent[];
  nextCursor?: string;
  hasMore: boolean;
  resetRequired?: boolean;
  pacingHints?: {
    retryAfterMs?: number;
    defaultDelayMs?: number;
  };
}

export interface WatchInput {
  rootId?: string | null;
  callbackUrl: string;
  cursor?: string;
}

export interface WatchRegistration {
  id: string;
  resourceId?: string;
  expiresAt?: string | Date;
  cursor?: string;
}

export interface CachedCloudStorageConnection {
  id: string;
  provider: CloudStorageProvider;
  accountEmail: string | null;
  displayName: string | null;
  status: string;
  capabilitiesJson: string | null;
  connectedAt: string;
  lastSyncedWithSiteAt: string | null;
}
