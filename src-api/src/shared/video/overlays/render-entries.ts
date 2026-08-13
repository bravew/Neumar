import {
  buildVividOverlayRenderEntries as buildEntriesWithResolver,
  compiledVividOverlayDocumentSource,
  instantiateOverlayDocument,
  type VividOverlayRenderEntry,
} from '@neumar/video-ir';

import type { VideoProject, VideoTimeline } from '@/shared/video/types';

import { resolveVividOverlay } from './registry';

// Backend binding of the shared vivid-overlay entry builder
// (@neumar/video-ir overlay-timing.ts) to the backend registry copy. The
// builder logic itself is single-sourced; only the catalog is duplicated
// across workspaces (pinned by the overlay registry parity test).

export function buildVividOverlayRenderEntries(
  timeline: VideoTimeline | undefined,
  fps: number,
): VividOverlayRenderEntry[] {
  return buildEntriesWithResolver(timeline, fps, resolveVividOverlay);
}

export function projectHasVividOverlays(project: VideoProject): boolean {
  const timeline = project.timeline;
  if (!timeline) return false;
  return (
    buildVividOverlayRenderEntries(timeline, timeline.fps || 30).length > 0
  );
}

const compiledCache = new Map<string, string>();

// Browser-safe (this module bundles into the Remotion composition): gif
// entries must already carry their asset bytes (enriched server-side by
// remotion-render-input); every other backend resolves from built-ins.
export function instantiatedVividOverlayRenderDocument(
  entry: VividOverlayRenderEntry,
  size: { width: number; height: number },
  fps: number,
): string | null {
  const compiledKey = entryUsesSourceAsset(entry)
    ? `${entry.backend}|${entry.sourceAssetId ?? ''}`
    : `${entry.backend}|${entry.documentId ?? ''}`;
  let compiled = compiledCache.get(compiledKey);
  if (!compiled) {
    const source = compiledVividOverlayDocumentSource({
      backend: entry.backend,
      documentId: entry.documentId,
      sourceAsset: entry.sourceAsset,
    });
    if (!source) return null;
    compiled = source;
    if (compiledCache.size > 32) compiledCache.clear();
    compiledCache.set(compiledKey, compiled);
  }
  return instantiateOverlayDocument(compiled, {
    controls: entry.controls,
    widthPx: size.width,
    heightPx: size.height,
    fps,
  });
}

function entryUsesSourceAsset(entry: VividOverlayRenderEntry): boolean {
  return (
    entry.backend === 'gif' ||
    (entry.backend === 'lottie' && Boolean(entry.sourceAssetId))
  );
}
