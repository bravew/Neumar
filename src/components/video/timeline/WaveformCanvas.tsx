import { useEffect, useMemo, useRef, useState } from 'react';

import { API_BASE_URL } from '@/config';

import { fallbackWaveformPeaks, getCachedWaveformPeaks } from './waveformCache';
import type { WaveformSourceRange } from './waveformPeaks';

interface WaveformCanvasProps {
  seed: string;
  src?: string;
  gainDb?: number;
  widthPx: number;
  sourceRange?: WaveformSourceRange;
  /** Server-side peaks endpoint, relative to API_BASE_URL — used as a
   * fallback when in-browser audio decoding fails (uncommon codecs). */
  peaksEndpoint?: string;
}

const WAVEFORM_BUCKETS = 320;
// Thin mirrored bars with gaps — the OpenCut / video editor convention. CSS px;
// scaled by devicePixelRatio at draw time.
const BAR_WIDTH = 2;
const BAR_GAP = 2;
// Cap bars at 85% of the track height so the loudest peak keeps headroom
// instead of touching the edges and reading as a solid block.
const MAX_BAR_FRACTION = 0.85;

export function WaveformCanvas({
  seed,
  src,
  gainDb = 0,
  widthPx,
  sourceRange,
  peaksEndpoint,
}: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fallbackPeaks = useMemo(
    () => fallbackWaveformPeaks(seed, WAVEFORM_BUCKETS),
    [seed],
  );
  const [peaks, setPeaks] = useState(fallbackPeaks);
  const [sourceKind, setSourceKind] = useState<'decoded' | 'fallback'>(
    'fallback',
  );

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setPeaks(fallbackPeaks);
    setSourceKind('fallback');
    if (!src) return;
    getCachedWaveformPeaks(src, WAVEFORM_BUCKETS, {
      signal: controller.signal,
      sourceRange,
    })
      .then(async (decoded) => {
        if (cancelled) return;
        if (decoded.length > 0) {
          setPeaks(decoded);
          setSourceKind('decoded');
          return;
        }
        // Browser-side decode returned nothing (unsupported codec, CORS,
        // etc.) — try the server-side peaks endpoint as a fallback.
        if (!peaksEndpoint) return;
        const url = new URL(`${API_BASE_URL}${peaksEndpoint}`);
        url.searchParams.set('bins', String(WAVEFORM_BUCKETS));
        if (sourceRange) {
          url.searchParams.set('startMs', String(sourceRange.startMs));
          url.searchParams.set('durationMs', String(sourceRange.durationMs));
          if (sourceRange.reverse) url.searchParams.set('reverse', '1');
        }
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) return;
        const payload = (await response.json()) as { peaks?: number[] };
        if (
          !cancelled &&
          Array.isArray(payload.peaks) &&
          payload.peaks.length > 0
        ) {
          setPeaks(payload.peaks);
          setSourceKind('decoded');
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [fallbackPeaks, src, peaksEndpoint, sourceRange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * scale));
    const height = Math.max(1, Math.round(rect.height * scale));
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return;

    context.clearRect(0, 0, width, height);

    const gain = 10 ** (gainDb / 20);
    const center = height / 2;
    const lastPeak = peaks.length - 1;
    const barWidth = Math.max(1, Math.round(BAR_WIDTH * scale));
    const stride = barWidth + Math.max(1, Math.round(BAR_GAP * scale));
    const radius = barWidth / 2;
    const count = Math.max(1, Math.floor(width / stride));
    const maxBarHeight = height * MAX_BAR_FRACTION;
    const minBarHeight = barWidth;

    context.fillStyle = 'rgba(125, 185, 255, 0.9)';
    const supportsRoundRect = typeof context.roundRect === 'function';
    context.beginPath();
    for (let index = 0; index < count; index += 1) {
      // Linearly interpolate between adjacent buckets so clips wider than the
      // bucket count stay smooth instead of stepping.
      const position = count > 1 ? (index / (count - 1)) * lastPeak : 0;
      const lowIndex = Math.floor(position);
      const highIndex = Math.min(lastPeak, lowIndex + 1);
      const blend = position - lowIndex;
      const peak =
        (peaks[lowIndex] ?? 0) * (1 - blend) + (peaks[highIndex] ?? 0) * blend;
      // log1p compression keeps dynamic range: loud-but-compressed material
      // doesn't flatten to a solid block the way a steep dB curve does.
      const scaled = Math.log1p(Math.min(1, peak * gain)) / Math.LN2;
      const barHeight = Math.max(minBarHeight, scaled * maxBarHeight);
      const x = index * stride;
      const y = center - barHeight / 2;
      if (supportsRoundRect) {
        context.roundRect(x, y, barWidth, barHeight, radius);
      } else {
        context.rect(x, y, barWidth, barHeight);
      }
    }
    context.fill();
  }, [gainDb, peaks, widthPx]);

  return (
    <canvas
      ref={canvasRef}
      className="size-full opacity-90"
      data-waveform-source={sourceKind}
    />
  );
}
