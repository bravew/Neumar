import { useCurrentFrame, useVideoConfig } from 'remotion';
import { interpolate, spring } from 'remotion';

interface ZoomPanOptions {
  startFrame: number;
  durationInFrames: number;
  holdFrames?: number;
  from: { x: number; y: number; zoom: number };
  to: { x: number; y: number; zoom: number };
}

/**
 * Computes transform values for smooth zoom-pan camera movements.
 * Returns CSS transform string and opacity for smooth entrance.
 */
export function useZoomPan({
  startFrame,
  durationInFrames,
  holdFrames = 60,
  from,
  to,
}: ZoomPanOptions) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const moveIn = spring({
    frame: frame - startFrame,
    fps,
    config: { damping: 200 },
    durationInFrames,
  });

  const moveOut = spring({
    frame: frame - startFrame - durationInFrames - holdFrames,
    fps,
    config: { damping: 200 },
    durationInFrames,
  });

  const progress = moveIn - moveOut;

  const x = interpolate(progress, [0, 1], [from.x, to.x]);
  const y = interpolate(progress, [0, 1], [from.y, to.y]);
  const zoom = interpolate(progress, [0, 1], [from.zoom, to.zoom]);

  const transform = `scale(${zoom}) translate(${-x}px, ${-y}px)`;

  return { transform, x, y, zoom, progress };
}
