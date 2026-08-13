import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AbsoluteFill,
  Composition,
  continueRender,
  delayRender,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type { CalculateMetadataFunction } from 'remotion';

export const REMOTION_HTML_FRAME_COMPOSITION_ID = 'HtmlFrame';

interface HtmlFrameProps extends Record<string, unknown> {
  html: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
}

type GsapTimeline = { pause: () => void; time: (seconds?: number) => unknown };
type GsapWindow = Window & { gsap?: { globalTimeline?: GsapTimeline } };

const DEFAULT_PROPS: HtmlFrameProps = {
  html: '<!doctype html><html><body></body></html>',
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 150,
};
const MAX_DOC_READY_POLL_TRIES = 200;
const DOC_READY_POLL_INTERVAL_MS = 25;

const calculateMetadata: CalculateMetadataFunction<HtmlFrameProps> = ({
  props,
}) => ({
  width: props.width,
  height: props.height,
  fps: props.fps,
  durationInFrames: props.durationInFrames,
});

type TypedCompositionProps = {
  id: string;
  component: React.ComponentType<HtmlFrameProps>;
  defaultProps: HtmlFrameProps;
  calculateMetadata: CalculateMetadataFunction<HtmlFrameProps>;
};

export function HtmlFrameBridgeRoot() {
  const TypedComposition =
    Composition as unknown as React.ComponentType<TypedCompositionProps>;
  return React.createElement(TypedComposition, {
    id: REMOTION_HTML_FRAME_COMPOSITION_ID,
    component: HtmlFrameBridge,
    defaultProps: DEFAULT_PROPS,
    calculateMetadata,
  });
}

function frameDoc(iframe: HTMLIFrameElement | null): Document | undefined {
  try {
    return iframe?.contentWindow?.document ?? undefined;
  } catch {
    return undefined;
  }
}

function docReady(doc: Document | undefined): boolean {
  if (!doc?.body) return false;
  const hasAnimations = (doc.getAnimations?.()?.length ?? 0) > 0;
  const hasBody = doc.body.innerHTML.trim().length > 0;
  if (!hasAnimations && !hasBody) return false;
  return (
    (doc as Document & { fonts?: FontFaceSet }).fonts?.status !== 'loading'
  );
}

function HtmlFrameBridge({ html, width, height }: HtmlFrameProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const firstHandleCleared = useRef(false);
  const [initialHandle] = useState(() => delayRender('HTML frame seek @0ms'));
  const timeMs = (frame / fps) * 1000;

  const seek = useCallback((targetMs: number) => {
    const win = iframeRef.current?.contentWindow as GsapWindow | null;
    const doc = frameDoc(iframeRef.current);
    if (!win || !doc) return;

    try {
      for (const animation of doc.getAnimations?.() ?? []) {
        try {
          animation.pause();
          animation.currentTime = targetMs;
        } catch {
          // Some idle or finished animations reject currentTime writes.
        }
      }
    } catch {
      // Web Animations API is optional.
    }

    try {
      const timeline = win.gsap?.globalTimeline;
      if (timeline) {
        timeline.pause();
        timeline.time(targetMs / 1000);
      }
    } catch {
      // GSAP is optional.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let completed = false;
    const handle = firstHandleCleared.current
      ? delayRender(`HTML frame seek @${Math.round(timeMs)}ms`)
      : initialHandle;
    let tries = 0;

    const releaseHandle = () => {
      if (completed) return;
      completed = true;
      firstHandleCleared.current = true;
      continueRender(handle);
    };

    const finish = () => {
      if (cancelled) return;
      seek(timeMs);
      releaseHandle();
    };

    const tick = () => {
      if (cancelled) return;
      if (
        docReady(frameDoc(iframeRef.current)) ||
        tries++ >= MAX_DOC_READY_POLL_TRIES
      ) {
        finish();
        return;
      }
      setTimeout(tick, DOC_READY_POLL_INTERVAL_MS);
    };

    tick();
    return () => {
      cancelled = true;
      releaseHandle();
    };
  }, [initialHandle, seek, timeMs]);

  return React.createElement(
    AbsoluteFill,
    { style: { backgroundColor: '#000000' } },
    React.createElement('iframe', {
      ref: iframeRef,
      srcDoc: html,
      width,
      height,
      // Source HTML is trusted internal template code. Same-origin access lets
      // the bridge pause and seek Web Animations and GSAP timelines.
      sandbox: 'allow-same-origin allow-scripts',
      style: {
        width,
        height,
        border: 'none',
        display: 'block',
      },
    }),
  );
}
