export const ASSET_KINDS = [
  'all',
  'image',
  'video',
  'audio',
  'pdf',
  'text',
  'doc',
  'other',
] as const;

export type AssetKindFilter = (typeof ASSET_KINDS)[number];
export type AssetKind = Exclude<AssetKindFilter, 'all'>;

export const ASSET_SOURCES = [
  'all',
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

export type AssetSourceFilter = (typeof ASSET_SOURCES)[number];
export type AssetSource = Exclude<AssetSourceFilter, 'all'>;

export interface AssetAttachment {
  scope: string;
  scopeId: string;
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
  provenance?: unknown;
  exif?: unknown;
  tags: string[];
  attachments: AssetAttachment[];
  indexState: 'pending' | 'probing' | 'embedded' | 'failed';
  indexError: string | null;
}

export const CREATIVE_ASSET_ROLES = [
  'source',
  'reference',
  'generated',
  'timeline',
  'design-output',
  'export',
] as const;

export type CreativeAssetRole = (typeof CREATIVE_ASSET_ROLES)[number];

export type CreativeAssetSource =
  | AssetSource
  | 'asset_catalog'
  | 'video_project'
  | 'design_project'
  | 'linked_source'
  | 'render_output'
  | 'unknown';

export type CreativeAssetMaterializationState =
  | 'local'
  | 'remote-only'
  | 'materializing'
  | 'ready'
  | 'failed'
  | 'placeholder';

export interface CreativeAssetReference {
  kind: 'asset' | 'frame' | 'prompt' | 'source' | 'url';
  id?: string;
  label?: string;
  atMs?: number;
}

export interface CreativeAssetRights {
  license?: string;
  attribution?: string;
  attributionRequired?: boolean;
  commercialUse?: 'allowed' | 'restricted' | 'unknown';
}

export interface CreativeAssetPlacement {
  kind:
    | 'catalog'
    | 'video-project'
    | 'video-timeline'
    | 'design-project'
    | 'design-output'
    | 'export';
  projectId?: string;
  assetId?: string;
  sceneId?: string;
  clipId?: string;
  path?: string;
  usedInProject?: boolean;
}

// UI-only metadata contract for creative browsing surfaces. Persisted asset,
// Design, and Video schemas stay unchanged; adapters derive this shape.
export interface CreativeAssetDescriptor {
  id: string;
  title?: string;
  kind: AssetKind;
  role: CreativeAssetRole;
  source: CreativeAssetSource;
  sourceId?: string;
  provider?: string;
  model?: string;
  promptHash?: string;
  promptExcerpt?: string;
  references: CreativeAssetReference[];
  dimensions?: { width: number; height: number };
  durationMs?: number;
  bytes?: number;
  mime?: string;
  tags: string[];
  materialization: CreativeAssetMaterializationState;
  rights?: CreativeAssetRights;
  usageCount: number;
  currentPlacement?: CreativeAssetPlacement;
  createdAt?: string | number;
  updatedAt?: string | number;
  rawPath?: string | null;
  thumbPath?: string | null;
  previewPath?: string | null;
}

export interface AssetSearchHit {
  asset: Asset;
  score: number;
  scoreBreakdown?: {
    fts: number;
    vector?: number;
  };
  score_breakdown?: {
    fts: number;
    vector?: number;
  };
  snippet: string | null;
  urls?: {
    raw: string;
    preview: string;
    proxy?: Partial<Record<string, string>>;
  };
}

export interface AssetPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface AssetStorageStats {
  totalCount: number;
  activeCount: number;
  deletedCount: number;
  totalBytes: number;
  localBytes: number;
  remoteBytes: number;
  deletedBytes: number;
  cacheBytes: number;
  materializedBytes: number;
  proxyBytes: number;
  previewArtifactBytes: number;
  managedBytes: number;
  budgetBytes: number;
  warningThresholdBytes: number;
  warning: boolean;
  materializedBytesByScope: AssetStorageScopeUsage[];
}

export interface AssetStorageScopeUsage {
  scope: string;
  materializedBytes: number;
  materializationCount: number;
  projectCount: number;
}

export type AssetMaterializeEvent =
  | {
      type: 'materialize.started';
      assetId: string;
      scope: string;
      scopeId: string;
      sessionId?: string;
    }
  | {
      type: 'materialize.progress';
      assetId: string;
      scope: string;
      scopeId: string;
      sessionId?: string;
      bytes: number;
      total: number | null;
      percent: number | null;
    }
  | {
      type: 'materialize.complete';
      assetId: string;
      scope: string;
      scopeId: string;
      sessionId?: string;
      materializationId: string;
      cacheHit: boolean;
      bytes: number;
    }
  | {
      type: 'materialize.error';
      assetId: string;
      scope: string;
      scopeId: string;
      sessionId?: string;
      code: string;
      message: string;
      retryable: boolean;
    }
  | {
      type: 'materialize.cancelled';
      assetId: string;
      scope: string;
      scopeId: string;
      sessionId?: string;
    }
  | {
      type: 'proxy.complete';
      assetId: string;
      scope: string;
      scopeId: string;
      sessionId?: string;
      preset: string;
      url: string;
    }
  | {
      type: 'proxy.error';
      assetId: string;
      scope: string;
      scopeId: string;
      sessionId?: string;
      preset: string;
      message: string;
      retryable: boolean;
    }
  | {
      type: 'artifact.complete';
      assetId: string;
      scope: string;
      scopeId: string;
      sessionId?: string;
      kind: string;
      url: string;
    }
  | {
      type: 'artifact.error';
      assetId: string;
      scope: string;
      scopeId: string;
      sessionId?: string;
      kind: string;
      message: string;
      retryable: boolean;
    };

export interface AssetMaterializationState {
  assetId: string;
  status: 'started' | 'progress' | 'complete' | 'error' | 'cancelled';
  bytes: number;
  total: number | null;
  percent: number | null;
  message: string | null;
  derivative?: {
    status: 'ready' | 'error';
    kind: 'proxy' | 'artifact';
    name: string;
    message: string | null;
  };
  updatedAt: number;
}

export interface AssetQueryState {
  q: string;
  kind: AssetKindFilter;
  source: AssetSourceFilter;
  tags: string;
  from: string;
  to: string;
  semantic: boolean;
}
