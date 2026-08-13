import type { VividOverlayCategory } from '@neumar/video-ir';

import { VIDEO_OVERLAY_REGISTRY } from '@/shared/video/overlays/registry';

import type { ImportedOverlayItem } from './useImportedOverlays';
import type { UserOverlayPreset } from './useUserOverlayPresets';
import type { UserOverlayStyle } from './useUserOverlayStyles';

export const CATEGORY_ORDER: VividOverlayCategory[] = [
  'title',
  'callout',
  'social',
  'badge',
  'reaction',
  'progress',
  'widget',
  'frame',
  'screen',
  'sticker',
  'ambient',
  'caption',
];

export type OverlaySourceFilter =
  | 'all'
  | 'builtIn'
  | 'myOverlays'
  | 'styles'
  | 'imported';

export const SOURCE_ORDER: OverlaySourceFilter[] = [
  'all',
  'builtIn',
  'myOverlays',
  'styles',
  'imported',
];

export function overlayLabel(
  labelKey: string,
  labels: Record<string, string>,
): string {
  const key = labelKey.replace('overlays.', '');
  return labels[key] ?? key;
}

export function matchesSearchTokens(
  values: readonly string[],
  tokens: string[],
) {
  if (tokens.length === 0) return true;
  const haystack = values.join(' ').toLowerCase();
  const words = haystack.split(/[^a-z0-9@#]+/);
  return tokens.every(
    (token) =>
      haystack.includes(token) || words.some((word) => word.startsWith(token)),
  );
}

export function userPresetMatches(
  preset: UserOverlayPreset,
  category: VividOverlayCategory | null,
  overlayText: Record<string, string>,
  tokens: string[],
): boolean {
  const base = VIDEO_OVERLAY_REGISTRY.find(
    (candidate) => candidate.id === preset.basePresetId,
  );
  if (category && base?.category !== category) return false;
  return matchesSearchTokens(
    [
      preset.name,
      preset.basePresetId,
      base?.category ?? '',
      ...(base?.tags ?? []),
      base ? overlayLabel(base.labelKey, overlayText) : '',
    ],
    tokens,
  );
}

export function userStyleMatches(
  style: UserOverlayStyle,
  category: VividOverlayCategory | null,
  overlayText: Record<string, string>,
  tokens: string[],
): boolean {
  const base = VIDEO_OVERLAY_REGISTRY.find(
    (candidate) => candidate.id === style.basePresetId,
  );
  if (category && base?.category !== category) return false;
  return matchesSearchTokens(
    [
      style.name,
      style.basePresetId,
      base?.category ?? '',
      ...(style.tags ?? []),
      ...(base?.tags ?? []),
      base ? overlayLabel(base.labelKey, overlayText) : '',
    ],
    tokens,
  );
}

export function importedOverlayMatches(
  item: ImportedOverlayItem,
  category: VividOverlayCategory | null,
  tokens: string[],
): boolean {
  const categoryGuess = item.kind === 'gif' ? 'sticker' : 'ambient';
  if (category && category !== categoryGuess) return false;
  return matchesSearchTokens(
    [
      item.name,
      item.kind,
      item.source.fileName,
      item.source.mimeType,
      item.provenance.provider,
      categoryGuess,
    ],
    tokens,
  );
}
