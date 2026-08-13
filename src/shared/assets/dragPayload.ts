import type { AssetKind } from './types';

export const ASSET_DRAG_MIME = 'application/x-neuma-asset+json';

export interface AssetDragPayload {
  assetIds: string[];
  primaryKind: AssetKind;
  source: 'library' | 'project-rail';
}

export function writeAssetDragPayload(
  dataTransfer: DataTransfer,
  payload: AssetDragPayload,
): void {
  dataTransfer.setData(ASSET_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.effectAllowed = 'copy';
}

export function readAssetDragPayload(
  dataTransfer: DataTransfer,
): AssetDragPayload | null {
  const raw = dataTransfer.getData(ASSET_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AssetDragPayload>;
    if (
      !Array.isArray(parsed.assetIds) ||
      parsed.assetIds.length === 0 ||
      parsed.assetIds.some((id) => typeof id !== 'string' || !id) ||
      !isAssetKind(parsed.primaryKind) ||
      (parsed.source !== 'library' && parsed.source !== 'project-rail')
    ) {
      return null;
    }
    return {
      assetIds: parsed.assetIds,
      primaryKind: parsed.primaryKind,
      source: parsed.source,
    };
  } catch {
    return null;
  }
}

function isAssetKind(value: unknown): value is AssetKind {
  return (
    value === 'image' ||
    value === 'video' ||
    value === 'audio' ||
    value === 'pdf' ||
    value === 'text' ||
    value === 'doc' ||
    value === 'other'
  );
}
