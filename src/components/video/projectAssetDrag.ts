/**
 * Project-asset drag payload — distinct from `LINKED_ASSET_DRAG_MIME` because
 * project assets live in `project.assets[]` already and skip the
 * `attachLinkedAsset()` round-trip the linked-asset path requires. Using the
 * linked-asset MIME for project assets surfaces as
 * `video.api.error { error: 'Linked asset not found' }` from the backend.
 */
export const PROJECT_ASSET_DRAG_MIME =
  'application/x-neuma-video-project-asset';

export interface ProjectAssetDragPayload {
  assetId: string;
  kind: 'image' | 'video' | 'audio';
  name: string;
  durationMs?: number;
}

export function writeProjectAssetDrag(
  dataTransfer: DataTransfer,
  payload: ProjectAssetDragPayload,
) {
  dataTransfer.effectAllowed = 'copy';
  dataTransfer.setData(PROJECT_ASSET_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.setData('text/plain', payload.name);
}

export function readProjectAssetDrag(
  dataTransfer: DataTransfer,
): ProjectAssetDragPayload | null {
  const raw = dataTransfer.getData(PROJECT_ASSET_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ProjectAssetDragPayload>;
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
