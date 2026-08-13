import {
  normalizeTransition,
  transitionRegistryEntry,
  VIDEO_TRANSITION_REGISTRY,
  type TimelineTransition,
  type TransitionCapability,
  type TransitionDirection,
  type TransitionKind,
  type NormalizedTransitionSpec,
  type VideoRenderPath,
} from './types';

export type TransitionRendererSupport =
  | 'native'
  | 'custom'
  | 'fallback'
  | 'none';

export interface TransitionRendererQuality {
  fallbackKind?: TransitionKind;
  support: TransitionRendererSupport;
  unsupportedParams?: string[];
}

export interface TransitionQualityMatrixEntry {
  defaultDurationMs: number;
  directions: TransitionDirection[];
  ffmpeg: TransitionRendererQuality;
  kind: TransitionKind;
  remotion: TransitionRendererQuality;
  tier: TransitionCapability['tier'];
  webgl: TransitionRendererQuality;
}

const CUSTOM_REMOTION_KINDS = new Set<TransitionKind>([
  'clock-wipe',
  'cover',
  'cube',
  'reveal',
]);

export const TRANSITION_QUALITY_MATRIX = VIDEO_TRANSITION_REGISTRY.map(
  (entry): TransitionQualityMatrixEntry => ({
    defaultDurationMs: entry.defaultDurationMs,
    directions: [...entry.directions],
    ffmpeg: transitionRendererQuality({ kind: entry.kind }, 'ffmpeg'),
    kind: entry.kind,
    remotion: transitionRendererQuality({ kind: entry.kind }, 'remotion'),
    tier: entry.tier,
    webgl: {
      support: entry.webglPreview,
    },
  }),
);

export function transitionQualityEntry(
  kind: TransitionKind,
): TransitionQualityMatrixEntry {
  const entry = TRANSITION_QUALITY_MATRIX.find((entry) => entry.kind === kind);
  if (!entry) {
    throw new Error(`Unknown transition kind: ${kind}`);
  }
  return entry;
}

export function transitionPrefersRemotionFinalRender(
  transition: TimelineTransition | undefined,
): boolean {
  const spec = normalizeTransition(transition);
  if (spec.kind === 'cut') return false;
  const ffmpeg = transitionRendererQuality(spec, 'ffmpeg');
  if (ffmpeg.support === 'native' || ffmpeg.support === 'custom') {
    return false;
  }
  const remotion = transitionRendererQuality(spec, 'remotion');
  return remotion.support === 'native' || remotion.support === 'custom';
}

export function transitionPrefersWebCodecsFinalRender(
  transition: TimelineTransition | undefined,
): boolean {
  const spec = normalizeTransition(transition);
  if (spec.kind === 'cut') return false;
  const ffmpeg = transitionRendererQuality(spec, 'ffmpeg');
  if (ffmpeg.support === 'native' || ffmpeg.support === 'custom') {
    return false;
  }
  return transitionRegistryEntry(spec.kind).webglPreview === 'native';
}

export function transitionRendererQuality(
  transition: TimelineTransition | undefined,
  renderer: VideoRenderPath,
): TransitionRendererQuality {
  const spec = normalizeTransition(transition);
  const entry = transitionRegistryEntry(spec.kind);
  if (renderer === 'ffmpeg') return ffmpegRendererQuality(spec, entry);
  if (renderer === 'remotion') return remotionRendererQuality(spec, entry);
  return renderPathQuality(entry, renderer, spec);
}

function ffmpegRendererQuality(
  spec: NormalizedTransitionSpec,
  entry: TransitionCapability,
): TransitionRendererQuality {
  switch (spec.kind) {
    case 'clock-wipe':
      return stockOnlyParamQuality(spec, 'clock-wipe');
    case 'pixelize':
      return stockOnlyParamQuality(spec, 'pixelize');
    case 'polygon-iris':
      return {
        fallbackKind: 'iris',
        support: 'fallback',
        unsupportedParams: polygonIrisUnsupportedParams(spec),
      };
    case 'soft-wipe': {
      const unsupportedParams = softWipeUnsupportedParams(spec);
      return unsupportedParams.length === 0
        ? { support: 'native' }
        : {
            fallbackKind: 'wipe',
            support: 'fallback',
            unsupportedParams,
          };
    }
    default:
      return renderPathQuality(entry, 'ffmpeg', spec);
  }
}

function stockOnlyParamQuality(
  spec: NormalizedTransitionSpec,
  fallbackKind: TransitionKind,
): TransitionRendererQuality {
  const unsupportedParams = nonDefaultParamKeys(spec);
  return unsupportedParams.length === 0
    ? { support: 'native' }
    : { fallbackKind, support: 'fallback', unsupportedParams };
}

function remotionRendererQuality(
  spec: NormalizedTransitionSpec,
  entry: TransitionCapability,
): TransitionRendererQuality {
  switch (spec.kind) {
    case 'polygon-iris':
      return {
        fallbackKind: 'iris',
        support: 'fallback',
        unsupportedParams: polygonIrisUnsupportedParams(spec),
      };
    case 'soft-wipe': {
      const unsupportedParams = softWipeUnsupportedParams(spec);
      return unsupportedParams.length === 0
        ? renderPathQuality(entry, 'remotion', spec)
        : {
            fallbackKind: 'wipe',
            support: 'fallback',
            unsupportedParams,
          };
    }
    default:
      return renderPathQuality(entry, 'remotion', spec);
  }
}

function renderPathQuality(
  entry: TransitionCapability,
  renderer: VideoRenderPath,
  spec: NormalizedTransitionSpec,
): TransitionRendererQuality {
  if (entry.native.includes(renderer)) {
    return {
      support:
        renderer === 'remotion' && CUSTOM_REMOTION_KINDS.has(entry.kind)
          ? 'custom'
          : 'native',
    };
  }
  const fallbackKind = entry.fallbackFor[renderer];
  if (!fallbackKind) return { support: 'none' };
  const unsupportedParams = nonDefaultParamKeys(spec);
  return {
    fallbackKind,
    support: 'fallback',
    ...(unsupportedParams.length > 0 ? { unsupportedParams } : {}),
  };
}

function nonDefaultParamKeys(spec: NormalizedTransitionSpec): string[] {
  return Object.keys(spec.params ?? {}).sort();
}

function softWipeUnsupportedParams(spec: NormalizedTransitionSpec): string[] {
  const unsupported = new Set<string>();
  const params = spec.params ?? {};
  if (params.softness !== undefined) unsupported.add('softness');
  if (!isSoftWipeCardinalAngle(params.angle)) unsupported.add('angle');
  return [...unsupported].sort();
}

function polygonIrisUnsupportedParams(
  spec: NormalizedTransitionSpec,
): string[] {
  return Array.from(new Set(['sides', ...nonDefaultParamKeys(spec)])).sort();
}

function isSoftWipeCardinalAngle(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  const normalized = ((value % 360) + 360) % 360;
  return [0, 90, 180, 270].some(
    (angle) => Math.abs(normalized - angle) < 0.0001,
  );
}
