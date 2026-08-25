import type { CSSProperties } from 'react';

import { buildVideoClipCssFilter } from '../clipFilters';
import type { RemotionVisualClip } from './remotionPreviewData';

export function transformStyle(clip: RemotionVisualClip): CSSProperties {
  const transform = clip.transform;
  if (!transform) return {};
  const positionX = transform.positionX ?? 0.5;
  const positionY = transform.positionY ?? 0.5;
  return {
    backgroundColor: transform.background,
    opacity: transform.opacity,
    transform: [
      `translate(${(positionX - 0.5) * 100}%, ${(positionY - 0.5) * 100}%)`,
      `scale(${transform.scaleX ?? transform.scale ?? 1}, ${transform.scaleY ?? transform.scale ?? 1})`,
      `rotate(${transform.rotation ?? 0}deg)`,
    ].join(' '),
  };
}

export function mediaElementStyle(
  clip: RemotionVisualClip,
): CSSProperties | undefined {
  const filter = buildVideoClipCssFilter(clip.filters);
  const objectPosition = objectPositionForReframe(clip.reframe?.anchor);
  const objectFit = objectFitForTransform(clip.transform?.fit);
  if (!filter && !objectPosition && objectFit === 'cover') return undefined;
  return {
    objectFit,
    ...(filter ? { filter } : {}),
    ...(objectPosition ? { objectPosition } : {}),
  };
}

export function sourceEndFrameWithTail(
  clip: RemotionVisualClip,
  transitionTailFrames: number,
): number {
  return clip.sourceEndFrame + transitionTailFrames;
}

function objectFitForTransform(
  fit: NonNullable<RemotionVisualClip['transform']>['fit'] | undefined,
): CSSProperties['objectFit'] {
  if (fit === 'contain') return 'contain';
  if (fit === 'fill') return 'fill';
  return 'cover';
}

function objectPositionForReframe(
  anchor: string | undefined,
): string | undefined {
  if (anchor === 'left') return '0% 50%';
  if (anchor === 'right') return '100% 50%';
  if (anchor === 'top') return '50% 0%';
  if (anchor === 'bottom') return '50% 100%';
  if (anchor === 'top-third') return '50% 33%';
  return undefined;
}
