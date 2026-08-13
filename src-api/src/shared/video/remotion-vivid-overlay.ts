import {
  resolveTimelineProperty,
  vividOverlayControlsAtLocalTime,
  vividOverlayLocalTimeMs,
  type VividOverlayRenderEntry,
} from '@neumar/video-ir';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AbsoluteFill,
  continueRender,
  delayRender,
  useCurrentFrame,
} from 'remotion';

import { instantiatedVividOverlayRenderDocument } from './overlays/render-entries';

// Headless-render twin of the frontend RemotionVividOverlayClip: the overlay
// document runs in a same-origin iframe and is seeked through the shared shim
// on every Remotion frame. delayRender brackets both the iframe load and each
// seek so the screenshot never races the document (the HtmlFrameDriver
// pattern). Rendered before captions in the main composition; alone on a
// transparent background in the overlay-pass composition.

type SeekWindow = Window & { __neumaOverlaySeek?: (tMs: number) => void };

function continueAfterFrameSettle(handle: number): () => void {
  let continued = false;
  let secondFrame: number | undefined;
  const release = () => {
    if (continued) return;
    continued = true;
    continueRender(handle);
  };
  const firstFrame = requestAnimationFrame(() => {
    secondFrame = requestAnimationFrame(release);
  });

  return () => {
    cancelAnimationFrame(firstFrame);
    if (secondFrame !== undefined) cancelAnimationFrame(secondFrame);
    release();
  };
}

export function VividOverlayLayerNodes(props: {
  entries: readonly VividOverlayRenderEntry[];
  fps: number;
  width: number;
  height: number;
}): React.ReactNode[] {
  return props.entries.map((entry) =>
    React.createElement(VividOverlayClipNode, {
      key: entry.clipId,
      entry,
      fps: props.fps,
      width: props.width,
      height: props.height,
    }),
  );
}

function VividOverlayClipNode({
  entry,
  fps,
  width,
  height,
}: {
  entry: VividOverlayRenderEntry;
  fps: number;
  width: number;
  height: number;
}) {
  const frame = useCurrentFrame();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadHandle] = useState(() =>
    delayRender(`vivid-overlay-load-${entry.clipId}`),
  );

  const localMs = vividOverlayLocalTimeMs(entry, frame, fps);
  const renderEntry = useMemo(() => {
    if (localMs === null) return entry;
    const controls = vividOverlayControlsAtLocalTime(entry, localMs);
    return controls === entry.controls ? entry : { ...entry, controls };
  }, [entry, localMs]);
  const srcdoc = useMemo(
    () =>
      instantiatedVividOverlayRenderDocument(
        renderEntry,
        { width, height },
        fps,
      ),
    [renderEntry, fps, height, width],
  );

  useEffect(() => {
    // Documents render for the clip's whole Sequence-free lifetime; when the
    // overlay is not visible at this frame there is nothing to settle.
    if (srcdoc === null || localMs === null) {
      continueRender(loadHandle);
    }
    // continueRender is idempotent per handle; safe to call again on later frames.
  }, [loadHandle, localMs, srcdoc]);

  useEffect(() => {
    if (!loaded || localMs === null) return;
    const handle = delayRender(`vivid-overlay-seek-${entry.clipId}-${frame}`);
    const contentWindow = iframeRef.current?.contentWindow as SeekWindow | null;
    if (!contentWindow?.__neumaOverlaySeek) {
      continueRender(handle);
      return;
    }
    contentWindow.__neumaOverlaySeek(localMs);
    return continueAfterFrameSettle(handle);
  }, [entry.clipId, frame, loaded, localMs]);

  if (!srcdoc || localMs === null) return null;

  return React.createElement(
    AbsoluteFill,
    {
      style: {
        ...overlayWrapperStyle(renderEntry, localMs),
        pointerEvents: 'none',
      },
    },
    React.createElement('iframe', {
      ref: iframeRef,
      sandbox: 'allow-scripts allow-same-origin',
      title: `vivid-overlay-${entry.presetId}`,
      srcDoc: srcdoc,
      style: {
        width: '100%',
        height: '100%',
        border: 0,
        background: 'transparent',
      },
      onLoad: () => {
        const contentWindow = iframeRef.current
          ?.contentWindow as SeekWindow | null;
        contentWindow?.__neumaOverlaySeek?.(localMs);
        setLoaded(true);
        continueAfterFrameSettle(loadHandle);
      },
    }),
  );
}

function overlayWrapperStyle(
  entry: VividOverlayRenderEntry,
  localMs: number,
): React.CSSProperties {
  const positionX = resolveTimelineProperty(entry, 'positionX', localMs);
  const positionY = resolveTimelineProperty(entry, 'positionY', localMs);
  const scale = resolveTimelineProperty(entry, 'scale', localMs);
  const scaleX =
    entry.transforms?.scaleX != null || hasEntryKeyframe(entry, 'scaleX')
      ? resolveTimelineProperty(entry, 'scaleX', localMs)
      : scale;
  const scaleY =
    entry.transforms?.scaleY != null || hasEntryKeyframe(entry, 'scaleY')
      ? resolveTimelineProperty(entry, 'scaleY', localMs)
      : scale;
  return {
    opacity: resolveTimelineProperty(entry, 'opacity', localMs),
    transform: [
      `translate(${(positionX - 0.5) * 100}%, ${(positionY - 0.5) * 100}%)`,
      `scale(${scaleX}, ${scaleY})`,
      `rotate(${resolveTimelineProperty(entry, 'rotation', localMs)}deg)`,
    ].join(' '),
    transformOrigin: 'center center',
  };
}

function hasEntryKeyframe(
  entry: VividOverlayRenderEntry,
  property: 'scaleX' | 'scaleY',
): boolean {
  return Boolean(entry.keyframes?.some((track) => track.property === property));
}
