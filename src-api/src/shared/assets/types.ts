export const ASSET_SOURCES = [
  'local_fs',
  'ai_gen',
  'immich',
  'photoprism',
  'google_drive',
  'dropbox',
  'box',
  'onedrive',
  's3_compatible',
  'openverse',
  'unsplash',
  'pexels',
  'pixabay',
  'coverr',
  'videvo',
] as const;

export type AssetSource = (typeof ASSET_SOURCES)[number];

export const ASSET_KINDS = [
  'image',
  'video',
  'audio',
  'pdf',
  'text',
  'doc',
  'other',
] as const;

export type AssetKind = (typeof ASSET_KINDS)[number];

export type AssetIndexState = 'pending' | 'probing' | 'embedded' | 'failed';

export interface AttachmentScope {
  scope: 'video_project' | 'task' | 'message' | 'chat_session' | string;
  scopeId: string;
}

export interface AssetAttachment extends AttachmentScope {
  role: string | null;
  attachedAt: number;
}

export interface Asset {
  id: string;
  source: AssetSource;
  connectionId: string | null;
  sourceId: string | null;
  clientRequestId: string | null;
  kind: AssetKind;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  contentHash: string | null;
  perceptualHash: string | null;
  title: string | null;
  description: string | null;
  caption: string | null;
  ocrText: string | null;
  transcript: string | null;
  storagePath: string | null;
  thumbPath: string | null;
  previewPath: string | null;
  capturedAt: number | null;
  importedAt: number;
  modifiedAt: number;
  deletedAt: number | null;
  provenance: unknown | null;
  exif: unknown | null;
  gpsLat: number | null;
  gpsLng: number | null;
  indexState: AssetIndexState;
  indexError: string | null;
  tags: string[];
  attachments: AssetAttachment[];
}

export interface AssetMetadataHint {
  kind: AssetKind;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  durationMs: number;
  title: string;
  description: string;
  caption: string;
  ocrText: string;
  transcript: string;
  capturedAt: number;
  provenance: unknown;
  exif: unknown;
  tags: string[];
}

export interface IngestInput {
  source: AssetSource;
  connectionId?: string | null;
  sourceId?: string | null;
  clientRequestId?: string | null;
  storagePath?: string;
  hint?: Partial<AssetMetadataHint>;
}

export interface RemoteAssetInput {
  source: AssetSource;
  connectionId: string;
  sourceId: string;
  kind: AssetKind;
  mime: string;
  bytes: number;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  contentHash?: string | null;
  title?: string | null;
  description?: string | null;
  caption?: string | null;
  ocrText?: string | null;
  transcript?: string | null;
  capturedAt?: number | null;
  modifiedAt?: number | null;
  provenance?: unknown;
  exif?: unknown;
  gpsLat?: number | null;
  gpsLng?: number | null;
  tags?: string[];
}

export interface AssetPatch {
  title?: string | null;
  description?: string | null;
  tags?: string[];
}

export interface AssetQuery {
  text?: string;
  semantic?: boolean;
  modalities?: AssetKind[];
  sources?: AssetSource[];
  tags?: string[];
  collectionId?: string;
  attachedTo?: AttachmentScope;
  dateRange?: { fromMs?: number; toMs?: number };
  limit?: number;
  cursor?: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface AssetSearchHit {
  asset: Asset;
  score: number;
  scoreBreakdown: {
    fts: number;
    vector?: number;
  };
  snippet: string | null;
}

export type AssetJobStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'error'
  | 'cancelled';

export interface AssetJob {
  id: string;
  kind: string;
  status: AssetJobStatus;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  errorText: string | null;
  createdAt: number;
  updatedAt: number;
  cancelledAt: number | null;
  attempts: number;
}
