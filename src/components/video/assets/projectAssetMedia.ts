import { API_BASE_URL } from '@/config';
import type { VideoProject } from '@/shared/types/video';

import {
  prettyProviderName,
  resolveProvider,
  type ProjectAssetLabels,
} from './projectAssetSource';

type ProjectAsset = VideoProject['assets'][number];

export function projectAssetStreamUrl(
  projectId: string,
  assetId: string,
): string {
  return `${API_BASE_URL}/video/projects/${encodeURIComponent(
    projectId,
  )}/assets/${encodeURIComponent(assetId)}/stream`;
}

export function projectAssetThumbnailUrl(
  projectId: string,
  asset: ProjectAsset,
): string {
  const remoteThumbUrl = projectAssetRemoteThumbnailUrl(asset);
  if (remoteThumbUrl) return remoteThumbUrl;
  const catalogAssetId = referencedCatalogAssetId(asset);
  if (catalogAssetId) {
    return `${API_BASE_URL}/assets/${encodeURIComponent(catalogAssetId)}/thumb`;
  }
  if (asset.kind === 'image') return projectAssetStreamUrl(projectId, asset.id);
  if (asset.kind === 'video') {
    return `${API_BASE_URL}/video/projects/${encodeURIComponent(
      projectId,
    )}/assets/${encodeURIComponent(asset.id)}/filmstrip?count=1`;
  }
  return '';
}

function projectAssetRemoteThumbnailUrl(asset: ProjectAsset): string | null {
  const provenance = asset.provenance as
    | {
        connectionId?: string;
        sourceId?: string;
        thumbnailUrl?: string;
      }
    | undefined;
  const thumbnailUrl = provenance?.thumbnailUrl;
  if (typeof thumbnailUrl !== 'string') return null;
  if (/^https?:\/\//i.test(thumbnailUrl)) return thumbnailUrl;
  const connectionId = provenance?.connectionId;
  if (!connectionId) return null;
  const match = /^[\w-]+-thumbnail:(.+)$/.exec(thumbnailUrl);
  const itemId = match?.[1] ?? provenance?.sourceId;
  if (!itemId) return null;
  return `${API_BASE_URL}/cloud-storage/connections/${encodeURIComponent(
    connectionId,
  )}/items/${encodeURIComponent(itemId)}/thumbnail`;
}

export function projectAssetRemoteContentUrl(
  asset: ProjectAsset,
): string | null {
  const provenance = asset.provenance;
  const connectionId = provenance?.connectionId;
  const sourceId = provenance?.sourceId;
  if (!connectionId || !sourceId) return null;
  return `${API_BASE_URL}/cloud-storage/connections/${encodeURIComponent(
    connectionId,
  )}/items/${encodeURIComponent(sourceId)}/content`;
}

export function referencedCatalogAssetId(asset: ProjectAsset): string | null {
  if (asset.materializationState && asset.materializationState !== 'ready') {
    return asset.provenance?.catalogAssetId ?? null;
  }
  if (asset.path.startsWith('catalog:')) {
    return asset.path.slice('catalog:'.length);
  }
  return null;
}

export function projectAssetMetaSummary(asset: ProjectAsset): string {
  const dimensions = projectAssetDimensions(asset);
  const size = asset.metadata?.fileSize
    ? formatBytes(asset.metadata.fileSize)
    : '';
  if (asset.kind === 'image') {
    return [dimensions, size].filter(Boolean).join(' · ');
  }
  const duration = positiveDurationMs(asset);
  const durationText = duration ? `${(duration / 1000).toFixed(1)}s` : '';
  return [durationText, dimensions, size].filter(Boolean).join(' · ');
}

export function projectAssetDetailRows(
  asset: ProjectAsset,
  labels: ProjectAssetLabels,
): Array<[string, string]> {
  const duration = positiveDurationMs(asset);
  return [
    [labels.kind, projectAssetKindLabel(asset.kind, labels)],
    [labels.dimensions, projectAssetDimensions(asset)],
    [labels.duration, duration ? `${(duration / 1000).toFixed(2)}s` : ''],
    [
      labels.bytes,
      asset.metadata?.fileSize ? formatBytes(asset.metadata.fileSize) : '',
    ],
    [labels.source, prettyProviderName(resolveProvider(asset), labels)],
  ];
}

function projectAssetKindLabel(
  kind: ProjectAsset['kind'],
  labels: ProjectAssetLabels,
): string {
  if (kind === 'image') return labels.kindImage ?? kind;
  if (kind === 'video') return labels.kindVideo ?? kind;
  if (kind === 'audio') return labels.kindAudio ?? kind;
  return kind;
}

export function projectAssetPreviewMedia(
  projectId: string,
  asset: ProjectAsset,
): {
  url: string | null;
  kind: 'image' | 'video' | 'audio';
  poster: string | null;
} {
  const catalogAssetId = referencedCatalogAssetId(asset);
  if (catalogAssetId) {
    if (asset.kind === 'video') {
      return {
        url:
          projectAssetRemoteContentUrl(asset) ??
          `${API_BASE_URL}/assets/${encodeURIComponent(catalogAssetId)}/raw`,
        kind: 'video',
        poster: projectAssetThumbnailUrl(projectId, asset) || null,
      };
    }
    if (asset.kind === 'audio') {
      return {
        url:
          projectAssetRemoteContentUrl(asset) ??
          `${API_BASE_URL}/assets/${encodeURIComponent(catalogAssetId)}/raw`,
        kind: 'audio',
        poster: null,
      };
    }
    return {
      url: projectAssetThumbnailUrl(projectId, asset) || null,
      kind: 'image',
      poster: null,
    };
  }
  if (asset.kind === 'video') {
    return {
      url: `${projectAssetStreamUrl(projectId, asset.id)}${
        asset.proxy ? '?variant=proxy' : ''
      }`,
      kind: 'video',
      poster: projectAssetThumbnailUrl(projectId, asset) || null,
    };
  }
  if (asset.kind === 'audio') {
    // Audio has nothing to look at, so the preview is the sound itself.
    return {
      url: projectAssetStreamUrl(projectId, asset.id),
      kind: 'audio',
      poster: null,
    };
  }
  return { url: null, kind: 'image', poster: null };
}

export function positiveDurationMs(asset: ProjectAsset): number | null {
  const duration = asset.metadata?.durationMs;
  return typeof duration === 'number' && duration > 0 ? duration : null;
}

function projectAssetDimensions(asset: ProjectAsset): string {
  const { width, height } = asset.metadata ?? {};
  return width && height ? `${width}x${height}` : '';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / (1024 * 102.4)) / 10} MB`;
}

export function filenameFromPath(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

export function projectAssetDisplayName(asset: ProjectAsset): string {
  const displayName = asset.provenance?.sourceDisplayName?.trim();
  if (displayName) return filenameFromPath(displayName);
  return filenameFromPath(asset.path);
}

export function projectAssetDisplaySubtitle(asset: ProjectAsset): string {
  if (isCatalogGeneratedPath(asset.path)) {
    return (
      asset.provenance?.sourceDisplayName?.trim() ||
      projectAssetDisplayName(asset)
    );
  }
  return asset.path;
}

function isCatalogGeneratedPath(value: string): boolean {
  if (value.startsWith('catalog:')) return true;
  return filenameFromPath(value).startsWith('catalog-');
}
