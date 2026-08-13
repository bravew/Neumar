import { useMemo } from 'react';

import type { RemotionPreviewData } from './remotionPreviewData';

const DEFAULT_LOOKAHEAD_FRAMES = 30;
const MAX_WARMUP_SOURCES = 3;

export function useFrameWarmup({
  data,
  currentFrame,
  lookaheadFrames = DEFAULT_LOOKAHEAD_FRAMES,
}: {
  data: RemotionPreviewData;
  currentFrame: number;
  lookaheadFrames?: number;
}): string[] {
  return useMemo(
    () => getFrameWarmupSources(data, currentFrame, lookaheadFrames),
    [currentFrame, data, lookaheadFrames],
  );
}

export function getFrameWarmupSources(
  data: RemotionPreviewData,
  currentFrame: number,
  lookaheadFrames = DEFAULT_LOOKAHEAD_FRAMES,
): string[] {
  const warmupEndFrame = currentFrame + Math.max(1, lookaheadFrames);
  const sources: string[] = [];
  const seen = new Set<string>();

  for (const clip of [...data.visualClips].sort(
    (a, b) => a.fromFrame - b.fromFrame || a.id.localeCompare(b.id),
  )) {
    if (clip.mediaKind !== 'video' || !clip.src) continue;
    const clipEndFrame = clip.fromFrame + clip.durationInFrames;
    const intersectsWarmupWindow =
      clipEndFrame > currentFrame && clip.fromFrame <= warmupEndFrame;
    if (!intersectsWarmupWindow || seen.has(clip.src)) continue;
    seen.add(clip.src);
    sources.push(clip.src);
    if (sources.length >= MAX_WARMUP_SOURCES) break;
  }

  return sources;
}
