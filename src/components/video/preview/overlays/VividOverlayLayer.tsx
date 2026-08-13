import { useEffect, useMemo, useRef } from 'react';

import { resolveTimelineProperty } from '@neumar/video-ir';

import {
  createOverlaySandboxHost,
  type OverlaySandboxHost,
} from '@/shared/video/overlays/html/sandboxHost';

import type { RemotionPreviewData } from '../remotionPreviewData';
import type { PreviewViewportGeometry } from '../webcodecs/previewViewport';
import {
  isVividOverlayActiveAtFrame,
  vividOverlayEntryAtLocalTime,
  resolveVividOverlaySrcdoc,
  vividOverlayLocalTimeMs,
  type OverlayAssetLoader,
  type RemotionVividOverlay,
} from './vividOverlayPreviewModel';

// Layered-iframe renderer for vivid overlays in the WebCodecs preview: the
// overlay documents (authored html/text-motion, generated gif/lottie) render
// as DOM above the canvas — never rasterized per frame — and are seeked on
// the compositor clock via the same shim the export pass uses. Known z-order
// deviation vs the final render: burned captions live inside the canvas, so
// vivid overlays draw above them in this preview.

interface HostRecord {
  host: OverlaySandboxHost;
  wrapper: HTMLDivElement;
  signature: string;
  inFlight: boolean;
  desiredMs: number | null;
  lastSentMs: number | null;
}

interface VividOverlayLayerProps {
  data: RemotionPreviewData;
  frame: number;
  geometry: PreviewViewportGeometry | null;
  enabled: boolean;
  loadAsset?: OverlayAssetLoader;
}

function entrySignature(
  entry: RemotionVividOverlay,
  size: { width: number; height: number },
  fps: number,
): string {
  return JSON.stringify([
    entry.backend,
    entry.documentId ?? null,
    entry.sourceAssetId ?? null,
    Object.entries(entry.controls).sort(([a], [b]) => (a < b ? -1 : 1)),
    size.width,
    size.height,
    fps,
    entry.opacity ?? 1,
  ]);
}

export function VividOverlayLayer({
  data,
  frame,
  geometry,
  enabled,
  loadAsset,
}: VividOverlayLayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hostsRef = useRef<Map<string, HostRecord>>(new Map());
  const pendingRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);
  const frameRef = useRef(frame);
  frameRef.current = frame;

  const size = useMemo(
    () => ({ width: data.compositionWidth, height: data.compositionHeight }),
    [data.compositionWidth, data.compositionHeight],
  );

  const overlays = useMemo(
    () => (enabled ? data.vividOverlays : []),
    [data.vividOverlays, enabled],
  );

  // Mount/unmount hosts to match the overlays active at the current frame.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const hosts = hostsRef.current;
    const active = new Map<
      string,
      { entry: RemotionVividOverlay; localMs: number }
    >();
    for (const entry of overlays) {
      if (!isVividOverlayActiveAtFrame(entry, frame)) continue;
      const localMs = vividOverlayLocalTimeMs(entry, frame, data.fps);
      if (localMs === null) continue;
      active.set(entry.clipId, {
        entry: vividOverlayEntryAtLocalTime(entry, localMs),
        localMs,
      });
    }
    for (const [clipId, record] of hosts) {
      const activeItem = active.get(clipId);
      if (
        !activeItem ||
        entrySignature(activeItem.entry, size, data.fps) !== record.signature
      ) {
        record.host.dispose();
        record.wrapper.remove();
        hosts.delete(clipId);
      }
    }
    for (const [clipId, activeItem] of active) {
      const { entry, localMs } = activeItem;
      if (hosts.has(clipId) || pendingRef.current.has(clipId)) continue;
      pendingRef.current.add(clipId);
      const signature = entrySignature(entry, size, data.fps);
      void resolveVividOverlaySrcdoc(entry, size, data.fps, loadAsset)
        .then((srcdoc) => {
          pendingRef.current.delete(clipId);
          if (!mountedRef.current || !srcdoc || hosts.has(clipId)) return;
          if (!containerRef.current) return;
          const wrapper = document.createElement('div');
          Object.assign(wrapper.style, {
            position: 'absolute',
            inset: '0',
            pointerEvents: 'none',
            zIndex: String(entry.layer),
            ...overlayWrapperStyle(entry, localMs),
          });
          containerRef.current.appendChild(wrapper);
          // Documents come from the first-party pipeline (authored presets or
          // generated around project assets), hence trusted (same-origin).
          const host = createOverlaySandboxHost({
            container: wrapper,
            srcdoc,
            trusted: true,
          });
          const record: HostRecord = {
            host,
            wrapper,
            signature,
            inFlight: false,
            desiredMs: null,
            lastSentMs: null,
          };
          hosts.set(clipId, record);
          const currentLocalMs = vividOverlayLocalTimeMs(
            entry,
            frameRef.current,
            data.fps,
          );
          if (currentLocalMs !== null) {
            record.desiredMs = currentLocalMs;
            pumpSeek(record);
          }
        })
        .catch(() => pendingRef.current.delete(clipId));
    }
  }, [data.fps, frame, loadAsset, overlays, size]);

  // Seek every mounted host to the frame's local time, latest-wins.
  useEffect(() => {
    const hosts = hostsRef.current;
    for (const entry of overlays) {
      const record = hosts.get(entry.clipId);
      if (!record) continue;
      const localMs = vividOverlayLocalTimeMs(entry, frame, data.fps);
      record.wrapper.style.visibility = localMs === null ? 'hidden' : '';
      if (localMs === null) continue;
      Object.assign(record.wrapper.style, overlayWrapperStyle(entry, localMs));
      if (localMs === record.lastSentMs) continue;
      record.desiredMs = localMs;
      pumpSeek(record);
    }
  }, [data.fps, frame, overlays]);

  // Dispose everything on unmount / when disabled.
  useEffect(() => {
    if (enabled) return;
    disposeAll(hostsRef.current);
  }, [enabled]);
  useEffect(() => {
    // Restore on (re)mount so React 19 StrictMode's mount→cleanup→mount in
    // dev doesn't leave the flag stuck false and block all async host mounts.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      disposeAll(hostsRef.current);
    };
  }, []);

  if (!enabled || !geometry || overlays.length === 0) return null;

  const left = geometry.viewportWidth / 2 - geometry.centerX * geometry.scale;
  const top = geometry.viewportHeight / 2 - geometry.centerY * geometry.scale;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
      data-vivid-overlay-layer=""
    >
      <div
        ref={containerRef}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: size.width,
          height: size.height,
          transform: `translate(${left}px, ${top}px) scale(${geometry.scale})`,
          transformOrigin: '0 0',
          overflow: 'hidden',
        }}
      />
    </div>
  );
}

function overlayWrapperStyle(
  entry: RemotionVividOverlay,
  localMs: number,
): Partial<CSSStyleDeclaration> {
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
    opacity: String(resolveTimelineProperty(entry, 'opacity', localMs)),
    transform: [
      `translate(${(positionX - 0.5) * 100}%, ${(positionY - 0.5) * 100}%)`,
      `scale(${scaleX}, ${scaleY})`,
      `rotate(${resolveTimelineProperty(entry, 'rotation', localMs)}deg)`,
    ].join(' '),
    transformOrigin: 'center center',
  };
}

function hasEntryKeyframe(
  entry: RemotionVividOverlay,
  property: 'scaleX' | 'scaleY',
): boolean {
  return Boolean(entry.keyframes?.some((track) => track.property === property));
}

function pumpSeek(record: HostRecord) {
  if (record.inFlight || record.desiredMs === null) return;
  const target = record.desiredMs;
  record.desiredMs = null;
  record.inFlight = true;
  record.lastSentMs = target;
  record.host
    .seek(target)
    .catch(() => {})
    .finally(() => {
      record.inFlight = false;
      pumpSeek(record);
    });
}

function disposeAll(hosts: Map<string, HostRecord>) {
  for (const record of hosts.values()) {
    record.host.dispose();
    record.wrapper.remove();
  }
  hosts.clear();
}
