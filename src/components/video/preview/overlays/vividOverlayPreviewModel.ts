import {
  buildVividOverlayRenderEntries,
  compiledVividOverlayDocumentSource,
  instantiateOverlayDocument,
  vividOverlayControlsAtLocalTime,
  type VividOverlayRenderEntry,
  type VividOverlaySourceAsset,
} from '@neumar/video-ir';

import type { VideoTimeline } from '@/shared/types/video';
import { resolveVividOverlay } from '@/shared/video/overlays/registry';

// Preview-side model for vivid overlay clips. Both preview renderers (the
// WebCodecs layered iframe and the Remotion in-composition iframe) consume the
// same entries and the same instantiated documents, which is what keeps the
// two paths visually identical. The entry builder, shape, and timing math
// live in video-ir (overlay-timing.ts) so the backend render pass shares
// them too — this module only binds the frontend registry.

export type RemotionVividOverlay = VividOverlayRenderEntry;
export {
  isVividOverlayActiveAtFrame,
  vividOverlayLocalTimeMs,
} from '@neumar/video-ir';

export function buildVividOverlayEntries(
  timeline: VideoTimeline | undefined,
  fps: number,
): RemotionVividOverlay[] {
  return buildVividOverlayRenderEntries(timeline, fps, resolveVividOverlay);
}

export function vividOverlayEntryAtLocalTime(
  entry: RemotionVividOverlay,
  localMs: number | null,
): RemotionVividOverlay {
  const controls = vividOverlayControlsAtLocalTime(entry, localMs);
  return controls === entry.controls ? entry : { ...entry, controls };
}

export type OverlayAssetLoader = (
  assetId: string,
) => Promise<VividOverlaySourceAsset | null>;

// Compiled/instantiated document caches. Compilation is pure and documents
// are static (gif documents embed the loaded asset, keyed by its id), so
// module scope is safe; instantiation is keyed by the deterministic control
// serialization so identical controls share one srcdoc string (and therefore
// one iframe identity check downstream).
const compiledCache = new Map<string, string>();
const instantiatedCache = new Map<string, string>();

function instantiateCached(
  compiledKey: string,
  compiled: string,
  entry: RemotionVividOverlay,
  size: { width: number; height: number },
  fps: number,
): string {
  const key = `${compiledKey}|${size.width}x${size.height}|${fps}|${JSON.stringify(
    Object.entries(entry.controls).sort(([a], [b]) => (a < b ? -1 : 1)),
  )}`;
  let instantiated = instantiatedCache.get(key);
  if (!instantiated) {
    instantiated = instantiateOverlayDocument(compiled, {
      controls: entry.controls,
      widthPx: size.width,
      heightPx: size.height,
      fps,
    });
    if (instantiatedCache.size > 64) instantiatedCache.clear();
    instantiatedCache.set(key, instantiated);
  }
  return instantiated;
}

/**
 * Resolve the instantiated srcdoc for any backend. Synchronous for
 * document-backed backends (html / text-motion / lottie); async only when a
 * gif asset must be fetched through `loadAsset`.
 */
export function instantiatedVividOverlayDocument(
  entry: RemotionVividOverlay,
  size: { width: number; height: number },
  fps: number,
): string | null {
  if (entryUsesSourceAsset(entry)) return null;
  const compiledKey = `${entry.backend}|${entry.documentId ?? ''}`;
  let compiled = compiledCache.get(compiledKey);
  if (!compiled) {
    const source = compiledVividOverlayDocumentSource({
      backend: entry.backend,
      documentId: entry.documentId,
    });
    if (!source) return null;
    compiled = source;
    compiledCache.set(compiledKey, compiled);
  }
  return instantiateCached(compiledKey, compiled, entry, size, fps);
}

export async function resolveVividOverlaySrcdoc(
  entry: RemotionVividOverlay,
  size: { width: number; height: number },
  fps: number,
  loadAsset?: OverlayAssetLoader,
): Promise<string | null> {
  if (!entryUsesSourceAsset(entry)) {
    return instantiatedVividOverlayDocument(entry, size, fps);
  }
  if (!entry.sourceAssetId) return null;
  const compiledKey = `${entry.backend}|${entry.sourceAssetId}`;
  let compiled = compiledCache.get(compiledKey);
  if (!compiled) {
    // Server-enriched entries carry the bytes; the live preview loads them.
    const sourceAsset =
      entry.sourceAsset ?? (await loadAsset?.(entry.sourceAssetId));
    if (!sourceAsset) return null;
    const source = compiledVividOverlayDocumentSource({
      backend: entry.backend,
      documentId: entry.documentId,
      sourceAsset,
    });
    if (!source) return null;
    compiled = source;
    compiledCache.set(compiledKey, compiled);
  }
  return instantiateCached(compiledKey, compiled, entry, size, fps);
}

function entryUsesSourceAsset(entry: RemotionVividOverlay): boolean {
  return (
    entry.backend === 'gif' ||
    (entry.backend === 'lottie' && Boolean(entry.sourceAssetId))
  );
}
