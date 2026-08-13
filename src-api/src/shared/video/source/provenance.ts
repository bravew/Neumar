import type { MediaProvenance } from '@/shared/video/types';

import type { FetchedSource } from './ingest';

// Phase 4 M1 provenance stamping
// (dev-doc/html-video/06-05/04-source-to-video-ingestion.md):
//
//   > Record provenance: the source URL + fetch timestamp on the resulting
//   > project / generated assets (MediaItem.provenance) so the video is
//   > traceable to its source.
//
// MediaProvenance already carries `sourceUrl` and `sourceDisplayName`; the
// `sourceFetchedAt` field added alongside this helper completes the
// "what + when" record. Agent wiring (M2) writes the resulting partial onto
// the MediaItem at materialization time.

/** Stable provider id surfaced on every link/repo ingestion. */
export const VIDEO_SOURCE_INGEST_PROVIDER = 'video-source-ingest' as const;

/**
 * Build the `MediaProvenance` partial for an asset derived from an external
 * source URL. Callers spread the result onto an existing provenance object
 * so model/cost fields from generative providers are preserved.
 *
 *   const prov = { ...mediaItem.provenance, ...buildSourceProvenance(src) };
 */
export function buildSourceProvenance(
  source: FetchedSource,
  options: { now?: () => Date } = {},
): Pick<
  MediaProvenance,
  'provider' | 'sourceUrl' | 'sourceDisplayName' | 'sourceFetchedAt'
> {
  const now = options.now?.() ?? new Date();
  return {
    provider: VIDEO_SOURCE_INGEST_PROVIDER,
    sourceUrl: source.url,
    sourceDisplayName: source.title || source.url,
    sourceFetchedAt: now.toISOString(),
  };
}
