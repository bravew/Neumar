import { useCallback, useMemo } from 'react';
import type { DragEvent } from 'react';

import type { VideoProject } from '@/shared/types/video';

import {
  PROJECT_ASSET_DRAG_MIME,
  readProjectAssetDrag,
} from './projectAssetDrag';

interface UseAgentProjectAssetDropInput {
  assets: VideoProject['assets'];
  onAddAssetContext?: (assetId: string) => void;
}

export function useAgentProjectAssetDrop({
  assets,
  onAddAssetContext,
}: UseAgentProjectAssetDropInput) {
  const projectAssetIds = useMemo(
    () => new Set(assets.map((asset) => asset.id)),
    [assets],
  );

  const handleProjectAssetDrag = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (
        !onAddAssetContext ||
        !event.dataTransfer.types.includes(PROJECT_ASSET_DRAG_MIME)
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'copy';
    },
    [onAddAssetContext],
  );

  const handleProjectAssetDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!onAddAssetContext) return;
      const payload = readProjectAssetDrag(event.dataTransfer);
      if (!payload || !projectAssetIds.has(payload.assetId)) return;
      event.preventDefault();
      event.stopPropagation();
      onAddAssetContext(payload.assetId);
    },
    [onAddAssetContext, projectAssetIds],
  );

  return {
    onDragEnterCapture: handleProjectAssetDrag,
    onDragOverCapture: handleProjectAssetDrag,
    onDropCapture: handleProjectAssetDrop,
  };
}
