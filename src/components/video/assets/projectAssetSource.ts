import type { VideoProject } from '@/shared/types/video';

type ProjectAsset = VideoProject['assets'][number];

// Locale shape we pull the pretty source names out of. Only the
// `source*` keys are touched here; the rest of `t.assets` already flows
// through `ProjectAssetTile` for the other detail rows.
export interface ProjectAssetLabels {
  kind: string;
  kindImage?: string;
  kindVideo?: string;
  kindAudio?: string;
  dimensions: string;
  duration: string;
  bytes: string;
  mime?: string;
  source: string;
  sourceLocalFs?: string;
  sourceAiGen?: string;
  sourceImmich?: string;
  sourcePhotoprism?: string;
  sourceGoogleDrive?: string;
  sourceDropbox?: string;
  sourceBox?: string;
  sourceOnedrive?: string;
  sourceS3?: string;
  sourceOpenverse?: string;
  sourceUnsplash?: string;
  sourcePexels?: string;
  sourcePixabay?: string;
  sourceCoverr?: string;
  sourceVidevo?: string;
}

// Providers that have a brand SVG bundled under
// `src/components/library/CloudProviderIcon`. The hover preview footer
// only renders a brand icon when this set contains the provider id.
export const HAS_CLOUD_PROVIDER_ICON = new Set([
  'immich',
  'photoprism',
  'google_drive',
  'dropbox',
  'box',
  'onedrive',
  's3_compatible',
  'unsplash',
  'pexels',
  'pixabay',
  'coverr',
  'videvo',
  'openverse',
]);

// Prefer the upstream provider when present (catalog attaches carry
// 'immich' / 'box' / 'google_drive' / … in `provenance.provider`).
// Fall back to the raw enum (`'user' | 'downloaded' | …`) so generated
// assets and manual uploads still surface their origin.
export function resolveProvider(asset: ProjectAsset): string {
  return asset.provenance?.provider ?? asset.source;
}

// Map the raw provider id to the localised brand name via the
// existing `t.assets.source*` strings. Unknown values fall through to
// a Title-Case of the id so we never render the bare `google_drive`
// token in user-facing UI.
export function prettyProviderName(
  provider: string,
  labels: ProjectAssetLabels,
): string {
  const map: Record<string, string | undefined> = {
    local_fs: labels.sourceLocalFs,
    ai_gen: labels.sourceAiGen,
    immich: labels.sourceImmich,
    photoprism: labels.sourcePhotoprism,
    google_drive: labels.sourceGoogleDrive,
    dropbox: labels.sourceDropbox,
    box: labels.sourceBox,
    onedrive: labels.sourceOnedrive,
    s3_compatible: labels.sourceS3,
    openverse: labels.sourceOpenverse,
    unsplash: labels.sourceUnsplash,
    pexels: labels.sourcePexels,
    pixabay: labels.sourcePixabay,
    coverr: labels.sourceCoverr,
    videvo: labels.sourceVidevo,
  };
  return map[provider] ?? toTitleCase(provider);
}

function toTitleCase(value: string): string {
  return value
    .split(/[_\s]+/)
    .map((word) =>
      word.length > 0 ? word[0]!.toUpperCase() + word.slice(1) : word,
    )
    .join(' ');
}
