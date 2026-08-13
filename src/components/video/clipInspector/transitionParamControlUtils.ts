import type { TransitionParamValue } from '@neumar/video-ir';

import type { VideoTransitionParamDef } from '@/shared/types/video';

export function transitionParamLabel(
  labelKey: `transitions.${string}`,
  labels: Record<string, string>,
): string {
  const key = labelKey.replace('transitions.', '');
  return labels[key] ?? key;
}

export function enumOptionLabel(
  definition: Extract<VideoTransitionParamDef, { type: 'enum' }>,
  option: string,
  labels: Record<string, string>,
): string {
  const baseKey = definition.labelKey.replace('transitions.', '');
  const optionKey = `${baseKey}${toPascalCase(option)}`;
  return labels[optionKey] ?? option;
}

export function isVec2Value(
  value: TransitionParamValue | undefined,
): value is readonly [number, number] {
  return Array.isArray(value) && value.length === 2;
}

export function isColorValue(
  value: TransitionParamValue | undefined,
): value is readonly [number, number, number, number] {
  return Array.isArray(value) && value.length === 4;
}

export function colorToHex(
  value: readonly [number, number, number, number],
): string {
  const [red, green, blue] = value;
  return `#${[red, green, blue]
    .map((channel) =>
      Math.round(Math.max(0, Math.min(1, channel)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

export function hexToColor(
  hex: string,
  alpha: number,
): readonly [number, number, number, number] {
  const normalized = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.slice(1) : 'ffffff';
  const red = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const green = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(normalized.slice(4, 6), 16) / 255;
  return [red, green, blue, alpha];
}

export function formatParamNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function toPascalCase(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}
