import { useEffect, useRef, useState } from 'react';

import { cn } from '@/shared/lib/utils';
import type {
  VideoTransitionCapability,
  VideoTransitionDirection,
  VideoTransitionParamValue,
  VideoTransitionTiming,
} from '@/shared/types/video';

import { getTransitionShaderSpec } from '../preview/webcodecs/transitionCatalog';
import { WebGLTransitionRenderer } from '../preview/webcodecs/WebGLTransitionRenderer';

const PREVIEW_WIDTH = 160;
const PREVIEW_HEIGHT = 90;

interface TransitionTilePreviewProps {
  active: boolean;
  className?: string;
  params?: Record<string, VideoTransitionParamValue>;
  previewDirection?: VideoTransitionDirection;
  timing?: VideoTransitionTiming;
  transition: VideoTransitionCapability;
}

export function TransitionTilePreview({
  active,
  className,
  params,
  previewDirection,
  timing,
  transition,
}: TransitionTilePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<WebGLTransitionRenderer | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!active) {
      drawGradientFallback(canvas, transition.kind === 'cut' ? 0 : 0.5);
      return;
    }
    const direction = previewDirection ?? transition.directions[0];
    if (reducedMotion || transition.webglPreview === 'none') {
      drawStaticPreview(canvas, transition, direction, params, timing);
      return;
    }

    const spec = getTransitionShaderSpec({
      kind: transition.kind,
      direction,
      params,
      timing,
    });
    if (!spec) {
      drawStaticPreview(canvas, transition, direction, params, timing);
      return;
    }

    let frameId = 0;
    const renderer =
      rendererRef.current ??
      new WebGLTransitionRenderer(document.createElement('canvas'));
    rendererRef.current = renderer;
    const from = previewFrame('from');
    const to = previewFrame('to');
    const startedAt = performance.now();

    const render = (now: number) => {
      const progress = ((now - startedAt) % 1800) / 1800;
      const rendered = renderer.renderTransition({
        from,
        height: PREVIEW_HEIGHT,
        progress,
        spec,
        to,
        width: PREVIEW_WIDTH,
      });
      paintCanvas(canvas, rendered);
      frameId = window.requestAnimationFrame(render);
    };
    frameId = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(frameId);
  }, [active, params, previewDirection, reducedMotion, timing, transition]);

  useEffect(() => {
    return () => {
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={PREVIEW_WIDTH}
      height={PREVIEW_HEIGHT}
      className={cn('bg-muted h-16 w-full rounded-md object-cover', className)}
      aria-hidden="true"
    />
  );
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (!window.matchMedia) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const handleChange = (event: MediaQueryListEvent) =>
      setReduced(event.matches);
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);
  return reduced;
}

function drawStaticPreview(
  canvas: HTMLCanvasElement,
  transition: VideoTransitionCapability,
  direction: VideoTransitionDirection | undefined,
  params: Record<string, VideoTransitionParamValue> | undefined,
  timing: VideoTransitionTiming | undefined,
): void {
  const spec = getTransitionShaderSpec({
    kind: transition.kind,
    direction,
    params,
    timing,
  });
  if (!spec) {
    drawGradientFallback(canvas, transition.kind === 'cut' ? 0 : 0.5);
    return;
  }
  const renderer = new WebGLTransitionRenderer(
    document.createElement('canvas'),
  );
  const rendered = renderer.renderTransition({
    from: previewFrame('from'),
    height: PREVIEW_HEIGHT,
    progress: 0.5,
    spec,
    to: previewFrame('to'),
    width: PREVIEW_WIDTH,
  });
  paintCanvas(canvas, rendered);
  renderer.destroy();
}

function paintCanvas(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
): void {
  canvas.width = PREVIEW_WIDTH;
  canvas.height = PREVIEW_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  context.drawImage(source, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
}

function previewFrame(kind: 'from' | 'to'): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = PREVIEW_WIDTH;
  canvas.height = PREVIEW_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) return canvas;

  const gradient = context.createLinearGradient(
    0,
    0,
    PREVIEW_WIDTH,
    PREVIEW_HEIGHT,
  );
  if (kind === 'from') {
    gradient.addColorStop(0, '#0f766e');
    gradient.addColorStop(1, '#f59e0b');
  } else {
    gradient.addColorStop(0, '#4338ca');
    gradient.addColorStop(1, '#f43f5e');
  }
  context.fillStyle = gradient;
  context.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  context.fillStyle = 'rgba(255,255,255,0.72)';
  if (kind === 'from') {
    context.fillRect(18, 18, 56, 36);
    context.fillStyle = 'rgba(15,23,42,0.26)';
    context.fillRect(94, 24, 44, 7);
    context.fillRect(94, 39, 32, 7);
  } else {
    context.beginPath();
    context.arc(116, 44, 24, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = 'rgba(15,23,42,0.26)';
    context.fillRect(24, 27, 52, 7);
    context.fillRect(24, 43, 38, 7);
  }
  return canvas;
}

function drawGradientFallback(
  canvas: HTMLCanvasElement,
  progress: number,
): void {
  canvas.width = PREVIEW_WIDTH;
  canvas.height = PREVIEW_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.drawImage(previewFrame(progress < 0.5 ? 'from' : 'to'), 0, 0);
}
