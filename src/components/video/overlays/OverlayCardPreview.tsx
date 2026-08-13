import { useEffect, useRef, useState } from 'react';

import {
  compiledVividOverlayDocumentSource,
  instantiateOverlayDocument,
  vividOverlayControlDefaults,
  vividOverlayPreviewPosterMs,
  type VividOverlayPresetDef,
  type VividOverlaySourceAsset,
} from '@neumar/video-ir';

import { cn } from '@/shared/lib/utils';
import {
  createOverlaySandboxHost,
  type OverlaySandboxHost,
} from '@/shared/video/overlays/html/sandboxHost';

// Live card previews for the overlay library. A card renders the preset's
// REAL overlay document (the same compiled+instantiated srcdoc the timeline
// uses) in a scaled-down sandboxed iframe: seeked once to a poster time at
// rest, and driven through a lead-in → play → hold loop while hovered. A
// paused iframe is inert DOM (the authoring lint forbids rAF/timers), so the
// rest cost is memory only; IntersectionObserver unmounts off-screen hosts
// and a module-level slot counter caps concurrently animating cards.

const DESIGN_WIDTH = 640;
const DESIGN_HEIGHT = 360;
const PREVIEW_FPS = 30;
const LEAD_IN_MS = 250;
const HOLD_END_MS = 450;
const MAX_ANIMATING_CARDS = 4;

let animatingCards = 0;

const srcdocCache = new Map<string, string | null>();

/**
 * Instantiated preview document, or null (gif/etc). `controlsOverride` merges
 * over the preset defaults — used by "My overlays" cards to preview saved
 * control values.
 */
export function overlayPresetPreviewSrcdoc(
  preset: VividOverlayPresetDef,
  controlsOverride?: Record<string, string | number | boolean>,
  sourceAsset?: VividOverlaySourceAsset,
  sourceAssetCacheKey?: string,
): string | null {
  if (preset.requiresSourceAsset && !sourceAsset) return null;
  const controlsKey = controlsOverride
    ? JSON.stringify(
        Object.entries(controlsOverride).sort(([a], [b]) => (a < b ? -1 : 1)),
      )
    : '';
  const cacheKey = `${preset.id}|${sourceAssetCacheKey ?? ''}|${controlsKey}`;
  const cached = srcdocCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const compiled = compiledVividOverlayDocumentSource({
    backend: preset.backend,
    documentId: preset.documentId,
    sourceAsset,
  });
  const srcdoc = compiled
    ? instantiateOverlayDocument(compiled, {
        controls: {
          ...vividOverlayControlDefaults(preset.controls),
          ...(controlsOverride ?? {}),
        },
        widthPx: DESIGN_WIDTH,
        heightPx: DESIGN_HEIGHT,
        fps: PREVIEW_FPS,
      })
    : null;
  if (srcdocCache.size > 128) srcdocCache.clear();
  srcdocCache.set(cacheKey, srcdoc);
  return srcdoc;
}

const BACKGROUND_CLASS: Record<string, string> = {
  dark: 'bg-zinc-900',
  light: 'bg-zinc-100',
  // No network in the rail either — a gradient stands in for footage.
  photo: 'bg-gradient-to-br from-sky-800 via-slate-600 to-amber-700',
};

interface OverlayCardPreviewProps {
  preset: VividOverlayPresetDef;
  /** Play the animation loop (hover/focus). Poster frame otherwise. */
  animate: boolean;
  /** "My overlays": saved control values to preview instead of defaults. */
  controlsOverride?: Record<string, string | number | boolean>;
  /** Local imported GIF/Lottie bytes for generated source-asset previews. */
  sourceAsset?: VividOverlaySourceAsset;
  sourceAssetCacheKey?: string;
  className?: string;
}

export function OverlayCardPreview({
  animate,
  className,
  controlsOverride,
  preset,
  sourceAsset,
  sourceAssetCacheKey,
}: OverlayCardPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<OverlaySandboxHost | null>(null);
  const pumpRef = useRef({ inFlight: false, desiredMs: null as number | null });
  const rafRef = useRef<number | null>(null);
  const holdsSlotRef = useRef(false);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);
  const [scale, setScale] = useState(0);

  const posterMs = vividOverlayPreviewPosterMs(preset);

  // Track visibility so off-screen cards carry no iframe.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries[0]?.isIntersecting ?? false),
      { rootMargin: '200px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Scale the fixed design stage to the card width.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setScale(width / DESIGN_WIDTH);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Mount the host while visible; seek to the poster frame.
  useEffect(() => {
    if (!visible || failed) return;
    const stage = stageRef.current;
    if (!stage) return;
    const srcdoc = overlayPresetPreviewSrcdoc(
      preset,
      controlsOverride,
      sourceAsset,
      sourceAssetCacheKey,
    );
    if (!srcdoc) {
      setFailed(true);
      return;
    }
    let cancelled = false;
    const host = createOverlaySandboxHost({
      container: stage,
      srcdoc,
      trusted: true,
    });
    hostRef.current = host;
    host.seek(posterMs).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
      stopLoop();
      host.dispose();
      hostRef.current = null;
      pumpRef.current = { inFlight: false, desiredMs: null };
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, failed, preset.id, posterMs, sourceAsset, sourceAssetCacheKey]);

  // Hover/focus animation loop — latest-wins seeks on a rAF clock.
  useEffect(() => {
    if (!animate || !visible || failed) {
      stopLoop();
      sendSeek(posterMs);
      return;
    }
    if (prefersReducedMotion()) return;
    if (!holdsSlotRef.current) {
      if (animatingCards >= MAX_ANIMATING_CARDS) return;
      animatingCards += 1;
      holdsSlotRef.current = true;
    }
    const cycleMs = LEAD_IN_MS + preset.defaultDurationMs + HOLD_END_MS;
    let startTime: number | null = null;
    const tick = (now: number) => {
      if (startTime === null) startTime = now;
      const elapsed = (now - startTime) % cycleMs;
      const localMs =
        elapsed < LEAD_IN_MS
          ? 0
          : Math.min(preset.defaultDurationMs, elapsed - LEAD_IN_MS);
      sendSeek(localMs);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      stopLoop();
      sendSeek(posterMs);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate, visible, failed, posterMs, preset.defaultDurationMs]);

  function stopLoop() {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (holdsSlotRef.current) {
      animatingCards = Math.max(0, animatingCards - 1);
      holdsSlotRef.current = false;
    }
  }

  function sendSeek(tMs: number) {
    const pump = pumpRef.current;
    pump.desiredMs = tMs;
    drainSeek();
  }

  function drainSeek() {
    const pump = pumpRef.current;
    const host = hostRef.current;
    if (!host || pump.inFlight || pump.desiredMs === null) return;
    const target = pump.desiredMs;
    pump.desiredMs = null;
    pump.inFlight = true;
    host
      .seek(target)
      .catch(() => {})
      .finally(() => {
        pump.inFlight = false;
        drainSeek();
      });
  }

  if (failed) return null;

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-0 overflow-hidden',
        BACKGROUND_CLASS[preset.previewBackground ?? 'dark'],
        className,
      )}
    >
      <div
        ref={stageRef}
        style={{
          position: 'absolute',
          left: 0,
          top: '50%',
          width: DESIGN_WIDTH,
          height: DESIGN_HEIGHT,
          transform: `translateY(-50%) scale(${scale})`,
          transformOrigin: '0 50%',
        }}
      />
    </div>
  );
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
