import { useEffect, useRef, useState } from 'react';

import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';

import {
  instantiatedVividOverlayDocument,
  resolveVividOverlaySrcdoc,
  vividOverlayLocalTimeMs,
  type OverlayAssetLoader,
  type RemotionVividOverlay as VividOverlayEntry,
} from './overlays/vividOverlayPreviewModel';

// Remotion-path renderer for a vivid overlay clip: the overlay document runs
// in a same-origin iframe inside the composition and is seeked directly via
// the shim's window hook on every Remotion frame — the same document + shim
// the WebCodecs layer and the export pass use, so all paths look identical.
// Rendered before captions in the composition so captions stay on top
// (pipeline hard rule: captions are the last overlay step).

export function RemotionVividOverlayClip({
  entry,
  loadAsset,
}: {
  entry: VividOverlayEntry;
  loadAsset?: OverlayAssetLoader;
}) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Document-backed backends resolve synchronously; gif needs its asset.
  const [srcdoc, setSrcdoc] = useState<string | null>(() =>
    instantiatedVividOverlayDocument(entry, { width, height }, fps),
  );
  useEffect(() => {
    if (entry.backend !== 'gif') return;
    let cancelled = false;
    void resolveVividOverlaySrcdoc(entry, { width, height }, fps, loadAsset)
      .then((resolved) => {
        if (!cancelled) setSrcdoc(resolved);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [entry, fps, height, loadAsset, width]);

  // `frame` here is composition-global because the Sequence wrapper is not
  // used for this component (loop math needs the absolute frame).
  const localMs = vividOverlayLocalTimeMs(entry, frame, fps);

  useEffect(() => {
    if (localMs === null) return;
    const contentWindow = iframeRef.current?.contentWindow as
      | (Window & { __neumaOverlaySeek?: (tMs: number) => void })
      | null;
    contentWindow?.__neumaOverlaySeek?.(localMs);
  }, [localMs, srcdoc]);

  if (!srcdoc || localMs === null) return null;

  return (
    <AbsoluteFill
      style={{ opacity: entry.opacity ?? 1, pointerEvents: 'none' }}
    >
      <iframe
        ref={iframeRef}
        sandbox="allow-scripts allow-same-origin"
        title={`vivid-overlay-${entry.presetId}`}
        srcDoc={srcdoc}
        style={{
          width: '100%',
          height: '100%',
          border: 0,
          background: 'transparent',
        }}
        onLoad={() => {
          const contentWindow = iframeRef.current?.contentWindow as
            | (Window & { __neumaOverlaySeek?: (tMs: number) => void })
            | null;
          if (localMs !== null) contentWindow?.__neumaOverlaySeek?.(localMs);
        }}
      />
    </AbsoluteFill>
  );
}
