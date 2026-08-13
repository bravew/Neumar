import { useMemo } from 'react';

import { API_BASE_URL } from '@/config';
import type { VideoMediaItem, VideoTimelineClip } from '@/shared/types/video';

import {
  projectAssetThumbnailUrl,
  referencedCatalogAssetId,
} from '../assets/projectAssetMedia';

interface TimelineClipThumbnailProps {
  projectId: string;
  clip: VideoTimelineClip;
  asset: VideoMediaItem;
  widthPx: number;
}

const MIN_FRAMES = 1;
const MAX_FRAMES = 60;
const DEFAULT_FRAME_WIDTH_PX = 80;
const NOMINAL_FILMSTRIP_HEIGHT_PX = 45;

/**
 * Background filmstrip for image/video timeline clips. Renders a horizontal
 * sprite-strip PNG served by `/video/projects/:id/assets/:assetId/filmstrip`
 * as a tiled background sized to cover the clip body.
 *
 * Frame count scales with clip pixel width so a long clip gets ~10–20
 * sample frames and a short one gets 1–2. Strips are cached server-side
 * forever beside the source file (see `asset-thumbs.ts`).
 */
export function TimelineClipThumbnail({
  projectId,
  clip,
  asset,
  widthPx,
}: TimelineClipThumbnailProps) {
  const frameCount = useMemo(() => {
    return timelineClipFilmstripFrameCount(asset, widthPx);
  }, [asset.kind, asset.metadata.height, asset.metadata.width, widthPx]);
  const useRemotePlaceholder =
    !!referencedCatalogAssetId(asset) ||
    asset.materializationState === 'hydrating';
  const placeholderUrl = useMemo(
    () => projectAssetThumbnailUrl(projectId, asset),
    [asset, projectId],
  );

  // For images, skip ffmpeg entirely and use the raw asset stream — no probe,
  // no filmstrip cache, no roundtrip. The filmstrip endpoint refused to run
  // on stills until recently because ffprobe reports duration=0 for PNGs.
  const stillUrl = useMemo(
    () =>
      asset.kind === 'image'
        ? `${API_BASE_URL}/video/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(asset.id)}/stream`
        : `${API_BASE_URL}/video/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(asset.id)}/filmstrip?count=1`,
    [asset.id, asset.kind, projectId],
  );

  const stripUrl = useMemo(
    () =>
      `${API_BASE_URL}/video/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(asset.id)}/filmstrip?count=${frameCount}`,
    [asset.id, frameCount, projectId],
  );

  // For a single-frame still, preserve the image's natural aspect ratio inside
  // the clip bar. Images dropped on a wide clip would otherwise be cropped by
  // `object-cover`; `object-contain` over a dark backdrop reads like a film
  // strip frame.
  if (useRemotePlaceholder || frameCount === 1) {
    return (
      <div className="pointer-events-none absolute inset-0 overflow-hidden bg-black/40">
        <img
          src={useRemotePlaceholder ? placeholderUrl : stillUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-contain opacity-95"
          draggable={false}
        />
      </div>
    );
  }

  // For multi-frame strips, keep each frame's natural aspect by sizing the
  // strip at `auto 100%` — height fills the track and width scales
  // proportionally. Forcing the strip to clip width stretches every frame
  // vertically when the user resizes the timeline taller.
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden bg-black/40 opacity-95"
      role="presentation"
      style={{
        backgroundImage: `url("${stripUrl}")`,
        backgroundRepeat: 'repeat-x',
        backgroundSize: 'auto 100%',
        backgroundPosition: 'left center',
      }}
      data-clip-thumb={clip.id}
    />
  );
}

// Re-export the strip URL builder so other code (e.g. preview) can warm the
// cache with a probe request.
export function getTimelineClipFilmstripUrl(
  projectId: string,
  assetId: string,
  count: number,
): string {
  return `${API_BASE_URL}/video/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/filmstrip?count=${count}`;
}

export function timelineClipFilmstripFrameCount(
  asset: Pick<VideoMediaItem, 'kind' | 'metadata'>,
  widthPx: number,
): number {
  if (asset.kind === 'image') return 1;
  if (!Number.isFinite(widthPx) || widthPx <= 0) return MIN_FRAMES;
  const target = Math.ceil(widthPx / projectedFrameWidthPx(asset.metadata));
  return Math.max(MIN_FRAMES, Math.min(MAX_FRAMES, target));
}

function projectedFrameWidthPx(metadata: VideoMediaItem['metadata']): number {
  const { width, height } = metadata;
  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return DEFAULT_FRAME_WIDTH_PX;
  }
  const projectedWidth = (width / height) * NOMINAL_FILMSTRIP_HEIGHT_PX;
  return Math.max(1, projectedWidth);
}
