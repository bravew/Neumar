import { useMemo } from 'react';

import { parseVividOverlayParams } from '@neumar/video-ir';

import type { VideoTimelineClip } from '@/shared/types/video';

import { useImportedOverlays } from '../overlays/useImportedOverlays';

export function useImportedOverlayClipDisplayName(
  clip: VideoTimelineClip | null,
): string | undefined {
  const { imports } = useImportedOverlays();
  return useMemo(() => {
    if (clip?.kind !== 'effect') return undefined;
    const params = parseVividOverlayParams(clip.params);
    const sourceAssetId = params?.sourceAssetId;
    if (!sourceAssetId?.startsWith('import:')) return undefined;
    return imports.find((item) => item.id === sourceAssetId)?.name;
  }, [clip, imports]);
}
