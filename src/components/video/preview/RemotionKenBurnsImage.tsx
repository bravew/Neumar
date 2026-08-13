import type { CSSProperties } from 'react';

import { Img, interpolate, useCurrentFrame } from 'remotion';

import type { RemotionVisualClip } from './remotionPreviewData';

// Animated Ken Burns image for the preview. Mirrors the FFmpeg `zoompan`
// semantics (kenBurnsFilter in pipeline.ts): zoom = max(1/w, 1/h) clamped
// [1,10], centered on the rect center, eased from `from` to `to` over the clip.
export function KenBurnsImage({
  src,
  imagePan,
  durationInFrames,
  mediaStyle,
}: {
  src: string;
  imagePan: NonNullable<RemotionVisualClip['imagePan']>;
  durationInFrames: number;
  mediaStyle: CSSProperties | undefined;
}) {
  const frame = useCurrentFrame();
  const progress = interpolate(
    frame,
    [0, Math.max(1, durationInFrames - 1)],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  const from = normalizeKenBurnsRect(imagePan.from);
  const to = normalizeKenBurnsRect(imagePan.to);
  const zoom = lerp(rectZoom(from), rectZoom(to), progress);
  const cx = lerp(from.x + from.width / 2, to.x + to.width / 2, progress);
  const cy = lerp(from.y + from.height / 2, to.y + to.height / 2, progress);
  return (
    <Img
      src={src}
      className="size-full object-cover"
      style={{
        ...mediaStyle,
        transformOrigin: `${cx * 100}% ${cy * 100}%`,
        transform: `translate(${(0.5 - cx) * 100}%, ${(0.5 - cy) * 100}%) scale(${zoom})`,
      }}
    />
  );
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clampUnit(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeKenBurnsRect(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}): { x: number; y: number; width: number; height: number } {
  const width = clampUnit(rect.width, 0.05, 1);
  const height = clampUnit(rect.height, 0.05, 1);
  return {
    x: clampUnit(rect.x, 0, 1 - width),
    y: clampUnit(rect.y, 0, 1 - height),
    width,
    height,
  };
}

function rectZoom(rect: { width: number; height: number }): number {
  return clampUnit(Math.max(1 / rect.width, 1 / rect.height), 1, 10);
}
