import { useCurrentFrame, useVideoConfig } from 'remotion';
import { spring } from 'remotion';

interface StaggeredEntranceOptions {
  itemCount: number;
  staggerFrames?: number;
  startFrame?: number;
  springConfig?: { damping?: number; stiffness?: number };
}

/**
 * Returns an array of progress values (0-1) for staggered entrance animations.
 * Each item starts its animation `staggerFrames` after the previous.
 */
export function useStaggeredEntrance({
  itemCount,
  staggerFrames = 8,
  startFrame = 0,
  springConfig = { damping: 15, stiffness: 200 },
}: StaggeredEntranceOptions): number[] {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return Array.from({ length: itemCount }, (_, i) =>
    spring({
      frame: frame - startFrame - i * staggerFrames,
      fps,
      config: springConfig,
      durationInFrames: 20,
    }),
  );
}
