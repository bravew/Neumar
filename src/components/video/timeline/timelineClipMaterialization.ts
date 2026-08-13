import type { AssetMaterializationState } from '@/shared/assets';
import type { MaterializationStateMap } from '@/shared/hooks/useAssetMaterializationEvents';
import type { VideoMediaItem } from '@/shared/types/video';

export interface TimelineClipMaterializationStatus {
  phase: 'pending' | 'progress' | 'error' | 'cancelled';
  percent: number | null;
  liveState?: AssetMaterializationState;
}

export function timelineClipMaterializationStatus(
  asset: VideoMediaItem | undefined,
  states: MaterializationStateMap | undefined,
): TimelineClipMaterializationStatus | null {
  if (!asset) return null;
  const catalogAssetId = asset.provenance?.catalogAssetId;
  const liveState = catalogAssetId ? states?.[catalogAssetId] : undefined;
  if (liveState) {
    if (liveState.status === 'started') {
      return { phase: 'pending', percent: null, liveState };
    }
    if (liveState.status === 'progress') {
      return {
        phase: 'progress',
        percent: clampPercent(liveState.percent),
        liveState,
      };
    }
    if (liveState.status === 'error') {
      return {
        phase: 'error',
        percent: clampPercent(liveState.percent),
        liveState,
      };
    }
    if (liveState.status === 'cancelled') {
      return {
        phase: 'cancelled',
        percent: clampPercent(liveState.percent),
        liveState,
      };
    }
    return null;
  }
  if (
    asset.materializationState === 'referenced' ||
    asset.materializationState === 'hydrating'
  ) {
    return { phase: 'pending', percent: null };
  }
  if (asset.materializationState === 'error') {
    return { phase: 'error', percent: null };
  }
  return null;
}

function clampPercent(percent: number | null): number | null {
  if (percent === null || !Number.isFinite(percent)) return null;
  return Math.max(0, Math.min(100, Math.round(percent)));
}
