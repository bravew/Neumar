import type {
  ClipEffect,
  ClipEffectKind,
  ClipEffectParameter,
  ClipEffectStack,
  EffectParameterKeyframeTrack,
  Keyframe,
} from './timeline-types.js';

export interface ClipEffectParameterDefinition {
  key: ClipEffectParameter;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
}

export interface ClipEffectCatalogEntry {
  kind: ClipEffectKind;
  category: 'grading' | 'blur';
  parameters: readonly ClipEffectParameterDefinition[];
}

export const CLIP_EFFECT_CATALOG = [
  {
    kind: 'brightness',
    category: 'grading',
    parameters: [
      { key: 'amount', defaultValue: 0, min: -1, max: 1, step: 0.01 },
    ],
  },
  {
    kind: 'contrast',
    category: 'grading',
    parameters: [
      { key: 'amount', defaultValue: 1, min: 0, max: 3, step: 0.01 },
    ],
  },
  {
    kind: 'saturation',
    category: 'grading',
    parameters: [
      { key: 'amount', defaultValue: 1, min: 0, max: 3, step: 0.01 },
    ],
  },
  {
    kind: 'white-balance',
    category: 'grading',
    parameters: [
      { key: 'temperature', defaultValue: 0, min: -1, max: 1, step: 0.01 },
      { key: 'tint', defaultValue: 0, min: -1, max: 1, step: 0.01 },
    ],
  },
  {
    kind: 'blur',
    category: 'blur',
    parameters: [
      { key: 'radius', defaultValue: 0, min: 0, max: 100, step: 0.5 },
    ],
  },
] as const satisfies readonly ClipEffectCatalogEntry[];

export function createClipEffect(kind: ClipEffectKind): ClipEffect {
  const base = { id: crypto.randomUUID(), version: 1 as const };
  switch (kind) {
    case 'brightness':
      return { ...base, kind, params: { amount: 0 } };
    case 'contrast':
      return { ...base, kind, params: { amount: 1 } };
    case 'saturation':
      return { ...base, kind, params: { amount: 1 } };
    case 'white-balance':
      return { ...base, kind, params: { temperature: 0, tint: 0 } };
    case 'blur':
      return {
        ...base,
        kind,
        params: { radius: 0, horizontal: true, vertical: true },
      };
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export function getClipEffectCatalogEntry(
  kind: ClipEffectKind,
): ClipEffectCatalogEntry {
  const entry = CLIP_EFFECT_CATALOG.find(
    (candidate) => candidate.kind === kind,
  );
  if (!entry) throw new Error(`Unknown clip effect kind: ${kind}`);
  return entry;
}

export function getClipEffectParameterDefinition(
  kind: ClipEffectKind,
  parameter: ClipEffectParameter,
): ClipEffectParameterDefinition | null {
  return (
    getClipEffectCatalogEntry(kind).parameters.find(
      (candidate) => candidate.key === parameter,
    ) ?? null
  );
}

/**
 * Read one parameter off an effect. Shared so the inspector, the agent tools,
 * and the render layer resolve the same kind-to-parameter mapping.
 */
export function getClipEffectParameterValue(
  effect: ClipEffect,
  parameter: ClipEffectParameter,
): number {
  const params = effect.params as Record<string, number | boolean>;
  const value = params[parameter];
  if (typeof value !== 'number') {
    throw new Error(`${parameter} is not valid for ${effect.kind}`);
  }
  return value;
}

/** Immutably set one parameter on an effect, preserving its siblings. */
export function setClipEffectParameterValue(
  effect: ClipEffect,
  parameter: ClipEffectParameter,
  value: number,
): ClipEffect {
  getClipEffectParameterValue(effect, parameter);
  return {
    ...effect,
    params: { ...effect.params, [parameter]: value },
  } as ClipEffect;
}

export function findEffectParameterTrack(
  stack: ClipEffectStack | undefined,
  effectId: string,
  parameter: ClipEffectParameter,
): EffectParameterKeyframeTrack | null {
  return (
    stack?.keyframes?.find(
      (track) => track.effectId === effectId && track.parameter === parameter,
    ) ?? null
  );
}

export function resolveClipEffectParameter(
  stack: ClipEffectStack,
  effect: ClipEffect,
  parameter: ClipEffectParameter,
  localMs: number,
): number {
  const fallback = effectParameterValue(effect, parameter);
  const track = findEffectParameterTrack(stack, effect.id, parameter);
  return track ? interpolateKeys(track.keys, fallback, localMs) : fallback;
}

export function effectParameterValue(
  effect: ClipEffect,
  parameter: ClipEffectParameter,
): number {
  switch (effect.kind) {
    case 'brightness':
    case 'contrast':
    case 'saturation':
      if (parameter === 'amount') return effect.params.amount;
      break;
    case 'white-balance':
      if (parameter === 'temperature') return effect.params.temperature;
      if (parameter === 'tint') return effect.params.tint;
      break;
    case 'blur':
      if (parameter === 'radius') return effect.params.radius;
      break;
  }
  throw new Error(`${parameter} is not valid for ${effect.kind}`);
}

function interpolateKeys(
  keys: readonly Keyframe[],
  fallback: number,
  localMs: number,
): number {
  if (!Number.isFinite(localMs) || keys.length === 0) return fallback;
  const sorted = [...keys].sort((left, right) => left.atMs - right.atMs);
  const first = sorted[0]!;
  if (localMs <= first.atMs) return first.value;
  const last = sorted[sorted.length - 1]!;
  if (localMs >= last.atMs) return last.value;
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const left = sorted[index]!;
    const right = sorted[index + 1]!;
    if (localMs < left.atMs || localMs > right.atMs) continue;
    if ((left.interp ?? 'linear') === 'hold') return left.value;
    const raw = (localMs - left.atMs) / (right.atMs - left.atMs);
    const progress = left.interp === 'smooth' ? raw * raw * (3 - 2 * raw) : raw;
    return left.value + (right.value - left.value) * progress;
  }
  return fallback;
}
