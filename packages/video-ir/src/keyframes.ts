import type {
  ClipTransform,
  Keyframe,
  KeyframeTrack,
  KeyframeableProperty,
} from './timeline-types.js';

export const KEYFRAMEABLE_PROPERTIES = [
  'opacity',
  'scale',
  'scaleX',
  'scaleY',
  'positionX',
  'positionY',
  'rotation',
  'cropTop',
  'cropRight',
  'cropBottom',
  'cropLeft',
  'volumeDb',
  'textOpacity',
  'textScale',
] as const satisfies readonly KeyframeableProperty[];

export const KEYFRAME_INTERPOLATIONS = ['hold', 'linear', 'smooth'] as const;

export interface KeyframePropertySource {
  keyframes?: KeyframeTrack[];
  transforms?: ClipTransform;
  gainDb?: number;
}

type ValueBounds = { min: number; max: number };

const PROPERTY_BOUNDS: Record<KeyframeableProperty, ValueBounds> = {
  opacity: { min: 0, max: 1 },
  scale: { min: 0.01, max: 20 },
  scaleX: { min: 0.01, max: 20 },
  scaleY: { min: 0.01, max: 20 },
  positionX: { min: -10, max: 10 },
  positionY: { min: -10, max: 10 },
  rotation: { min: -36_000, max: 36_000 },
  cropTop: { min: 0, max: 1 },
  cropRight: { min: 0, max: 1 },
  cropBottom: { min: 0, max: 1 },
  cropLeft: { min: 0, max: 1 },
  volumeDb: { min: -96, max: 24 },
  textOpacity: { min: 0, max: 1 },
  textScale: { min: 0.01, max: 20 },
};

export function keyframeValueValidationError(
  property: KeyframeableProperty,
  value: number,
): string | null {
  if (!Number.isFinite(value))
    return `${property} keyframe value must be finite`;
  const bounds = PROPERTY_BOUNDS[property];
  if (value < bounds.min || value > bounds.max) {
    return `${property} keyframe value must be between ${bounds.min} and ${bounds.max}`;
  }
  return null;
}

export function keyframeTrackValidationError(
  track: KeyframeTrack,
): string | null {
  if (track.keys.length === 0) return 'Keyframe track needs at least one key';
  let previousAtMs = -1;
  for (const key of track.keys) {
    if (!Number.isInteger(key.atMs) || key.atMs < 0) {
      return 'Keyframe atMs must be a non-negative integer';
    }
    if (key.atMs <= previousAtMs) {
      return 'Keyframe keys must be strictly sorted and unique by atMs';
    }
    const valueError = keyframeValueValidationError(track.property, key.value);
    if (valueError) return valueError;
    previousAtMs = key.atMs;
  }
  return null;
}

export function normalizeKeyframeTrack(track: KeyframeTrack): KeyframeTrack {
  return {
    property: track.property,
    keys: [...track.keys].sort((left, right) => left.atMs - right.atMs),
  };
}

export function findKeyframeTrack(
  tracks: readonly KeyframeTrack[] | undefined,
  property: KeyframeableProperty,
): KeyframeTrack | null {
  return tracks?.find((track) => track.property === property) ?? null;
}

export function findKeyframeAt(
  track: KeyframeTrack | null | undefined,
  atMs: number,
): Keyframe | null {
  return track?.keys.find((key) => key.atMs === atMs) ?? null;
}

export function staticTimelinePropertyValue(
  source: KeyframePropertySource,
  property: KeyframeableProperty,
): number {
  const transform = source.transforms;
  switch (property) {
    case 'opacity':
      return transform?.opacity ?? 1;
    case 'scale':
      return transform?.scale ?? 1;
    case 'scaleX':
      return transform?.scaleX ?? transform?.scale ?? 1;
    case 'scaleY':
      return transform?.scaleY ?? transform?.scale ?? 1;
    case 'positionX':
      return transform?.positionX ?? 0.5;
    case 'positionY':
      return transform?.positionY ?? 0.5;
    case 'rotation':
      return transform?.rotation ?? 0;
    case 'cropTop':
      return transform?.crop?.top ?? 0;
    case 'cropRight':
      return transform?.crop?.right ?? 0;
    case 'cropBottom':
      return transform?.crop?.bottom ?? 0;
    case 'cropLeft':
      return transform?.crop?.left ?? 0;
    case 'volumeDb':
      return source.gainDb ?? 0;
    case 'textOpacity':
      return 1;
    case 'textScale':
      return 1;
    default: {
      const exhaustive: never = property;
      return exhaustive;
    }
  }
}

export function resolveTimelineProperty(
  source: KeyframePropertySource,
  property: KeyframeableProperty,
  localMs: number,
): number {
  const fallback = staticTimelinePropertyValue(source, property);
  if (!Number.isFinite(localMs)) return fallback;
  const track = findKeyframeTrack(source.keyframes, property);
  if (!track || track.keys.length === 0) return fallback;
  const keys = normalizeKeyframeTrack(track).keys;
  const first = keys[0]!;
  if (localMs <= first.atMs) return first.value;
  const last = keys[keys.length - 1]!;
  if (localMs >= last.atMs) return last.value;

  for (let index = 0; index < keys.length - 1; index += 1) {
    const left = keys[index]!;
    const right = keys[index + 1]!;
    if (localMs < left.atMs || localMs > right.atMs) continue;
    const spanMs = right.atMs - left.atMs;
    if (spanMs <= 0) return right.value;
    if ((left.interp ?? 'linear') === 'hold') return left.value;
    const rawT = (localMs - left.atMs) / spanMs;
    const t = left.interp === 'smooth' ? rawT * rawT * (3 - 2 * rawT) : rawT;
    return left.value + (right.value - left.value) * t;
  }

  return fallback;
}
