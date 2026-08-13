export const PREVIEW_PLAYBACK_RATES = [
  0.25, 0.5, 0.75, 1, 1.25, 1.5, 2,
] as const;

export type PreviewPlaybackRate = (typeof PREVIEW_PLAYBACK_RATES)[number];

export const DEFAULT_PREVIEW_PLAYBACK_RATE: PreviewPlaybackRate = 1;

export function parsePreviewPlaybackRate(
  value: string,
): PreviewPlaybackRate | null {
  const numeric = Number(value);
  return PREVIEW_PLAYBACK_RATES.find((rate) => rate === numeric) ?? null;
}

export function formatPreviewPlaybackRate(rate: PreviewPlaybackRate): string {
  return `${Number.isInteger(rate) ? rate.toFixed(0) : String(rate)}x`;
}
