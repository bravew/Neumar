export const TRANSITION_EASINGS = [
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'spring',
] as const;

export type TransitionEasing = (typeof TRANSITION_EASINGS)[number];

export interface TransitionTiming {
  durationMs?: number;
  easing?: TransitionEasing;
  holdPct?: number;
}

export type TransitionParamValue =
  | number
  | boolean
  | string
  | readonly [number, number]
  | readonly [number, number, number]
  | readonly [number, number, number, number];

type TransitionParamBaseDef = {
  key: string;
  labelKey: `transitions.${string}`;
  helpKey?: `transitions.${string}`;
};

export type TransitionParamDef =
  | (TransitionParamBaseDef & {
      type: 'number';
      valueKind?: 'float' | 'int';
      defaultValue: number;
      min: number;
      max: number;
      step?: number;
      unit?: 'px' | 'deg' | 'pct' | 'scalar';
    })
  | (TransitionParamBaseDef & {
      type: 'boolean';
      defaultValue: boolean;
    })
  | (TransitionParamBaseDef & {
      type: 'enum';
      defaultValue: string;
      options: readonly string[];
    })
  | (TransitionParamBaseDef & {
      type: 'vec2';
      defaultValue: readonly [number, number];
      min?: number;
      max?: number;
    })
  | (TransitionParamBaseDef & {
      type: 'color';
      defaultValue: readonly [number, number, number, number];
    });

export interface TransitionTimingDefs {
  easingOptions?: readonly TransitionEasing[];
  defaultEasing?: TransitionEasing;
  allowHoldPct?: boolean;
}

export interface ResolvedTransitionParams {
  values: Record<string, TransitionParamValue>;
  unsupportedKeys: string[];
  clampedKeys: string[];
}

export function resolveTransitionParams(
  capability: Pick<{ paramDefs?: readonly TransitionParamDef[] }, 'paramDefs'>,
  rawParams: Record<string, unknown> | undefined,
): ResolvedTransitionParams {
  const paramDefs = capability.paramDefs ?? [];
  const values: Record<string, TransitionParamValue> = {};
  const unsupportedKeys: string[] = [];
  const clampedKeys = new Set<string>();

  for (const definition of paramDefs) {
    values[definition.key] = cloneTransitionParamValue(definition.defaultValue);
  }

  if (!rawParams) {
    return { values, unsupportedKeys, clampedKeys: [] };
  }

  for (const [key, rawValue] of Object.entries(rawParams)) {
    const definition = paramDefs.find((candidate) => candidate.key === key);
    if (!definition) {
      unsupportedKeys.push(key);
      continue;
    }

    const resolved = resolveParamValue(definition, rawValue);
    if (!resolved.ok) continue;
    values[key] = resolved.value;
    if (resolved.clamped) clampedKeys.add(key);
  }

  return {
    values,
    unsupportedKeys,
    clampedKeys: [...clampedKeys],
  };
}

export function compactResolvedTransitionParams(
  capability: Pick<{ paramDefs?: readonly TransitionParamDef[] }, 'paramDefs'>,
  values: Record<string, TransitionParamValue>,
): Record<string, TransitionParamValue> | undefined {
  const paramDefs = capability.paramDefs ?? [];
  const compact: Record<string, TransitionParamValue> = {};

  for (const definition of paramDefs) {
    const value = values[definition.key];
    if (
      value !== undefined &&
      !transitionParamValueEquals(value, definition.defaultValue)
    ) {
      compact[definition.key] = cloneTransitionParamValue(value);
    }
  }

  return Object.keys(compact).length > 0 ? compact : undefined;
}

export function transitionParamValueEquals(
  left: TransitionParamValue,
  right: TransitionParamValue,
): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    return left.every((value, index) => value === right[index]);
  }
  return left === right;
}

function resolveParamValue(
  definition: TransitionParamDef,
  rawValue: unknown,
): { ok: true; value: TransitionParamValue; clamped: boolean } | { ok: false } {
  switch (definition.type) {
    case 'boolean':
      return typeof rawValue === 'boolean'
        ? { ok: true, value: rawValue, clamped: false }
        : { ok: false };
    case 'color':
      return resolveColorValue(definition, rawValue);
    case 'enum':
      return typeof rawValue === 'string' &&
        definition.options.includes(rawValue)
        ? { ok: true, value: rawValue, clamped: false }
        : { ok: false };
    case 'number':
      return resolveNumberValue(definition, rawValue);
    case 'vec2':
      return resolveVec2Value(definition, rawValue);
  }
}

function resolveNumberValue(
  definition: Extract<TransitionParamDef, { type: 'number' }>,
  rawValue: unknown,
): { ok: true; value: number; clamped: boolean } | { ok: false } {
  if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
    return { ok: false };
  }

  const bounded = clamp(rawValue, definition.min, definition.max);
  const rounded =
    definition.valueKind === 'int' ? Math.round(bounded) : bounded;
  const value = clamp(rounded, definition.min, definition.max);

  return {
    ok: true,
    value,
    clamped: value !== rawValue,
  };
}

function resolveVec2Value(
  definition: Extract<TransitionParamDef, { type: 'vec2' }>,
  rawValue: unknown,
):
  | { ok: true; value: readonly [number, number]; clamped: boolean }
  | { ok: false } {
  if (
    !Array.isArray(rawValue) ||
    rawValue.length !== 2 ||
    !rawValue.every(
      (value) => typeof value === 'number' && Number.isFinite(value),
    )
  ) {
    return { ok: false };
  }

  const min = definition.min ?? Number.NEGATIVE_INFINITY;
  const max = definition.max ?? Number.POSITIVE_INFINITY;
  const x = clamp(rawValue[0] as number, min, max);
  const y = clamp(rawValue[1] as number, min, max);

  return {
    ok: true,
    value: [x, y],
    clamped: x !== rawValue[0] || y !== rawValue[1],
  };
}

function resolveColorValue(
  _definition: Extract<TransitionParamDef, { type: 'color' }>,
  rawValue: unknown,
):
  | {
      ok: true;
      value: readonly [number, number, number, number];
      clamped: boolean;
    }
  | { ok: false } {
  if (
    !Array.isArray(rawValue) ||
    rawValue.length !== 4 ||
    !rawValue.every(
      (value) => typeof value === 'number' && Number.isFinite(value),
    )
  ) {
    return { ok: false };
  }

  const color = rawValue.map((value) => clamp(value as number, 0, 1)) as [
    number,
    number,
    number,
    number,
  ];

  return {
    ok: true,
    value: color,
    clamped: color.some((value, index) => value !== rawValue[index]),
  };
}

function cloneTransitionParamValue(
  value: TransitionParamValue,
): TransitionParamValue {
  return Array.isArray(value)
    ? ([...value] as
        | [number, number]
        | [number, number, number]
        | [number, number, number, number])
    : value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
