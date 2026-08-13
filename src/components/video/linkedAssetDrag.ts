import type { VideoLinkedAssetKind } from '@/shared/types/video';

export const LINKED_ASSET_DRAG_MIME = 'application/x-neuma-video-linked-asset';

export interface LinkedAssetDragPayload {
  assetId: string;
  kind: Exclude<VideoLinkedAssetKind, 'other'>;
  name: string;
  durationMs?: number;
}

export function writeLinkedAssetDrag(
  dataTransfer: DataTransfer,
  payload: LinkedAssetDragPayload,
) {
  dataTransfer.effectAllowed = 'copy';
  dataTransfer.setData(LINKED_ASSET_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.setData('text/plain', payload.name);
}

export function readLinkedAssetDrag(
  dataTransfer: DataTransfer,
): LinkedAssetDragPayload | null {
  const raw = dataTransfer.getData(LINKED_ASSET_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LinkedAssetDragPayload>;
    if (
      !parsed.assetId ||
      !parsed.name ||
      (parsed.kind !== 'image' &&
        parsed.kind !== 'video' &&
        parsed.kind !== 'audio')
    ) {
      return null;
    }
    return {
      assetId: parsed.assetId,
      kind: parsed.kind,
      name: parsed.name,
      durationMs:
        typeof parsed.durationMs === 'number' ? parsed.durationMs : undefined,
    };
  } catch {
    return null;
  }
}
