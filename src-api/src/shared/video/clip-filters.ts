import type { ClipFilters } from './types';

const NEUTRAL_MULTIPLIER = 1;
const NEUTRAL_ZERO = 0;
const EPSILON = 0.001;

export function buildClipCssFilter(
  filters: ClipFilters | undefined,
): string | undefined {
  const normalized = normalizeClipFilters(filters);
  if (!normalized) return undefined;
  const parts: string[] = [];
  if (normalized.brightness != null) {
    parts.push(`brightness(${formatFilterNumber(normalized.brightness)})`);
  }
  if (normalized.contrast != null) {
    parts.push(`contrast(${formatFilterNumber(normalized.contrast)})`);
  }
  if (normalized.saturation != null) {
    parts.push(`saturate(${formatFilterNumber(normalized.saturation)})`);
  }
  if (normalized.hueRotateDeg != null) {
    parts.push(`hue-rotate(${formatFilterNumber(normalized.hueRotateDeg)}deg)`);
  }
  if (normalized.blurPx != null) {
    parts.push(`blur(${formatFilterNumber(normalized.blurPx)}px)`);
  }
  if (normalized.grayscale != null) {
    parts.push(`grayscale(${formatFilterNumber(normalized.grayscale)})`);
  }
  if (normalized.sepia != null) {
    parts.push(`sepia(${formatFilterNumber(normalized.sepia)})`);
  }
  return parts.join(' ');
}

function normalizeClipFilters(
  filters: ClipFilters | undefined,
): ClipFilters | undefined {
  if (!filters) return undefined;
  const normalized: ClipFilters = {};
  assignActiveMultiplier(normalized, 'brightness', filters.brightness);
  assignActiveMultiplier(normalized, 'contrast', filters.contrast);
  assignActiveMultiplier(normalized, 'saturation', filters.saturation);
  assignActiveZero(normalized, 'hueRotateDeg', filters.hueRotateDeg);
  assignActiveZero(normalized, 'blurPx', filters.blurPx);
  assignActiveZero(normalized, 'grayscale', filters.grayscale);
  assignActiveZero(normalized, 'sepia', filters.sepia);
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function assignActiveMultiplier(
  filters: ClipFilters,
  key: 'brightness' | 'contrast' | 'saturation',
  value: number | undefined,
) {
  if (value == null || !Number.isFinite(value)) return;
  if (Math.abs(value - NEUTRAL_MULTIPLIER) <= EPSILON) return;
  filters[key] = clamp(value, 0, 3);
}

function assignActiveZero(
  filters: ClipFilters,
  key: 'hueRotateDeg' | 'blurPx' | 'grayscale' | 'sepia',
  value: number | undefined,
) {
  if (value == null || !Number.isFinite(value)) return;
  if (Math.abs(value - NEUTRAL_ZERO) <= EPSILON) return;
  if (key === 'hueRotateDeg') {
    filters[key] = clamp(value, -180, 180);
    return;
  }
  if (key === 'blurPx') {
    filters[key] = clamp(value, 0, 50);
    return;
  }
  filters[key] = clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatFilterNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}
