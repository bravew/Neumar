import type { VideoVisualTimelineClip } from '@/shared/types/video';

import { pixelsToMs } from './timelineMath';
import type { TimelineTransitionSeam } from './timelineTransitions';

const NEAREST_SEAM_RADIUS_PX = 20;
const CLIP_EDGE_ZONE_RATIO = 0.3;

export function resolveTimelineTransitionDropTarget({
  clips,
  seams,
  pointerMs,
  pixelsPerSecond,
}: {
  clips: readonly VideoVisualTimelineClip[];
  seams: readonly TimelineTransitionSeam[];
  pointerMs: number;
  pixelsPerSecond: number;
}): TimelineTransitionSeam | null {
  const nearestSeam = nearestSeamWithinRadius(
    seams,
    pointerMs,
    pixelsToMs(NEAREST_SEAM_RADIUS_PX, pixelsPerSecond),
  );
  if (nearestSeam) return nearestSeam;

  const edgeCandidates: Array<{
    seam: TimelineTransitionSeam;
    distanceMs: number;
  }> = [];
  for (const clip of clips) {
    const clipStartMs = clip.startMs;
    const clipEndMs = clip.startMs + clip.durationMs;
    if (pointerMs < clipStartMs || pointerMs > clipEndMs) continue;
    const edgeZoneMs = clip.durationMs * CLIP_EDGE_ZONE_RATIO;
    const distanceToStartMs = pointerMs - clipStartMs;
    const distanceToEndMs = clipEndMs - pointerMs;
    if (distanceToStartMs <= edgeZoneMs) {
      const seam = seams.find((candidate) => candidate.toClipId === clip.id);
      if (seam) edgeCandidates.push({ seam, distanceMs: distanceToStartMs });
    }
    if (distanceToEndMs <= edgeZoneMs) {
      const seam = seams.find((candidate) => candidate.fromClipId === clip.id);
      if (seam) edgeCandidates.push({ seam, distanceMs: distanceToEndMs });
    }
  }

  return (
    edgeCandidates.sort(
      (left, right) =>
        left.distanceMs - right.distanceMs ||
        left.seam.startMs - right.seam.startMs,
    )[0]?.seam ?? null
  );
}

function nearestSeamWithinRadius(
  seams: readonly TimelineTransitionSeam[],
  pointerMs: number,
  radiusMs: number,
): TimelineTransitionSeam | null {
  let nearest: { seam: TimelineTransitionSeam; distanceMs: number } | null =
    null;
  for (const seam of seams) {
    const distanceMs = Math.abs(pointerMs - seam.startMs);
    if (distanceMs > radiusMs) continue;
    if (!nearest || distanceMs < nearest.distanceMs) {
      nearest = { seam, distanceMs };
    }
  }
  return nearest?.seam ?? null;
}
