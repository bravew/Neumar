import type {
  VideoAspectRatio,
  VideoClipTransform,
} from '@/shared/types/video';

export const FRAME_FOCUS_POINTS = [
  { focusX: 0.2, focusY: 0.2, label: 'nw' },
  { focusX: 0.5, focusY: 0.2, label: 'n' },
  { focusX: 0.8, focusY: 0.2, label: 'ne' },
  { focusX: 0.2, focusY: 0.5, label: 'w' },
  { focusX: 0.5, focusY: 0.5, label: 'c' },
  { focusX: 0.8, focusY: 0.5, label: 'e' },
  { focusX: 0.2, focusY: 0.8, label: 'sw' },
  { focusX: 0.5, focusY: 0.8, label: 's' },
  { focusX: 0.8, focusY: 0.8, label: 'se' },
] as const;

const ASPECT_RATIO_VALUE: Record<VideoAspectRatio, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '4:5': 4 / 5,
};

export interface SourceFrameSize {
  width?: number;
  height?: number;
}

export function coverScaleForAspect(
  source: SourceFrameSize | undefined,
  aspectRatio: VideoAspectRatio,
): number {
  if (!source?.width || !source.height) return 1;
  const sourceAspect = source.width / source.height;
  const targetAspect = ASPECT_RATIO_VALUE[aspectRatio];
  if (!Number.isFinite(sourceAspect) || sourceAspect <= 0) return 1;
  return roundFrameValue(
    sourceAspect > targetAspect
      ? sourceAspect / targetAspect
      : targetAspect / sourceAspect,
  );
}

export function fillFrameTransform(
  source: SourceFrameSize | undefined,
  aspectRatio: VideoAspectRatio,
  focus: { focusX?: number; focusY?: number } = {},
): Partial<VideoClipTransform> {
  const scale = coverScaleForAspect(source, aspectRatio);
  const next: VideoClipTransform = {
    fit: 'contain',
    scale,
    scaleX: undefined,
    scaleY: undefined,
  };
  return {
    ...next,
    ...framePositionForFocus(source, aspectRatio, next, {
      focusX: focus.focusX ?? 0.5,
      focusY: focus.focusY ?? 0.5,
    }),
  };
}

export function containFrameTransform(): Partial<VideoClipTransform> {
  return {
    fit: 'contain',
    scale: 1,
    scaleX: undefined,
    scaleY: undefined,
    positionX: 0.5,
    positionY: 0.5,
  };
}

export function centeredFrameTransform(): Partial<VideoClipTransform> {
  return {
    positionX: 0.5,
    positionY: 0.5,
  };
}

export function framePositionForFocus(
  source: SourceFrameSize | undefined,
  aspectRatio: VideoAspectRatio,
  transforms: VideoClipTransform,
  focus: { focusX: number; focusY: number },
): Partial<VideoClipTransform> {
  const size = scaledMediaSize(source, aspectRatio, transforms);
  return {
    positionX: positionForFocus(size.width, focus.focusX),
    positionY: positionForFocus(size.height, focus.focusY),
  };
}

export function nudgeFrameTransform(
  transforms: VideoClipTransform,
  delta: { x?: number; y?: number },
  source: SourceFrameSize | undefined,
  aspectRatio: VideoAspectRatio,
): Partial<VideoClipTransform> {
  return clampFramePosition(source, aspectRatio, {
    ...transforms,
    positionX: (transforms.positionX ?? 0.5) + (delta.x ?? 0),
    positionY: (transforms.positionY ?? 0.5) + (delta.y ?? 0),
  });
}

export function clampFramePosition(
  source: SourceFrameSize | undefined,
  aspectRatio: VideoAspectRatio,
  transforms: VideoClipTransform,
): Partial<VideoClipTransform> {
  const size = scaledMediaSize(source, aspectRatio, transforms);
  return {
    positionX: clampAxisPosition(transforms.positionX ?? 0.5, size.width),
    positionY: clampAxisPosition(transforms.positionY ?? 0.5, size.height),
  };
}

function scaledMediaSize(
  source: SourceFrameSize | undefined,
  aspectRatio: VideoAspectRatio,
  transforms: VideoClipTransform,
): { width: number; height: number } {
  const sourceAspect =
    source?.width && source.height ? source.width / source.height : 0;
  const targetAspect = ASPECT_RATIO_VALUE[aspectRatio];
  if (!Number.isFinite(sourceAspect) || sourceAspect <= 0) {
    const scaleX = transforms.scaleX ?? transforms.scale ?? 1;
    const scaleY = transforms.scaleY ?? transforms.scale ?? 1;
    return { width: scaleX, height: scaleY };
  }
  const base =
    sourceAspect > targetAspect
      ? { width: 1, height: targetAspect / sourceAspect }
      : { width: sourceAspect / targetAspect, height: 1 };
  return {
    width: base.width * (transforms.scaleX ?? transforms.scale ?? 1),
    height: base.height * (transforms.scaleY ?? transforms.scale ?? 1),
  };
}

function positionForFocus(mediaSize: number, focus: number): number {
  if (mediaSize <= 1) return 0.5;
  return clampAxisPosition(0.5 + mediaSize * (0.5 - focus), mediaSize);
}

function clampAxisPosition(value: number, mediaSize: number): number {
  if (mediaSize <= 1) return 0.5;
  const min = 1 - mediaSize / 2;
  const max = mediaSize / 2;
  return roundFrameValue(Math.max(min, Math.min(max, value)));
}

function roundFrameValue(value: number): number {
  return Math.round(value * 1000) / 1000;
}
