import { bookendOverlayOpacity } from '@neumar/video-ir';

import { buildVideoClipCssFilter } from '../../clipFilters';
import type {
  RemotionCaption,
  RemotionPreviewData,
  RemotionVisualClip,
} from '../remotionPreviewData';
import {
  applyLayerCanvasTransform,
  getLayerTransformGeometry,
  getObjectFitRect,
} from './layerTransform';
import {
  frameRectInViewport,
  type PreviewViewportGeometry,
  type PreviewViewportRect,
} from './previewViewport';
import type {
  WebCodecsTransitionSeam,
  WebCodecsVisualLayer,
} from './sceneModel';
import { getTransitionShaderSpec } from './transitionCatalog';
import type { WebGLTransitionRenderer } from './WebGLTransitionRenderer';

export {
  getLayerBoundsInComposition,
  getObjectFitRect,
  type FitRect,
} from './layerTransform';

const DEFAULT_FONT_FAMILY = 'Inter, system-ui, sans-serif';
const DEFAULT_CAPTION_BACKGROUND = 'rgba(0,0,0,0.7)';
const DEFAULT_CAPTION_COLOR = '#ffffff';
const CAPTION_HORIZONTAL_PADDING = 16;
const CAPTION_VERTICAL_PADDING = 8;
const BLUR_PAD_RADIUS_PX = 28;
const BLUR_PAD_SCALE = 1.12;
const WORKING_AREA_BACKGROUND = '#050505';
const OUTSIDE_FRAME_MASK = 'rgba(0,0,0,0.55)';
const FRAME_OUTLINE = '#7dd3fc';
const FRAME_OUTLINE_CONTRAST = 'rgba(0,0,0,0.75)';

export type WebCodecsDrawableSource = CanvasImageSource;

export type ResolvedWebCodecsVisualLayer =
  | {
      kind: 'video';
      layer: Extract<WebCodecsVisualLayer, { kind: 'video' }>;
      source: WebCodecsDrawableSource;
    }
  | {
      kind: 'image';
      layer: Extract<WebCodecsVisualLayer, { kind: 'image' }>;
      source: WebCodecsDrawableSource;
    };

export interface ResolvedWebCodecsTransition extends Pick<
  WebCodecsTransitionSeam,
  'direction' | 'kind' | 'params' | 'progress' | 'timing'
> {
  fromLayers: ResolvedWebCodecsVisualLayer[];
  toLayers: ResolvedWebCodecsVisualLayer[];
}

export function drawWebCodecsFrame({
  ctx,
  data,
  dpr = 1,
  frame,
  layers,
  transition,
  transitionRenderer,
  viewport,
}: {
  ctx: CanvasRenderingContext2D;
  data: RemotionPreviewData;
  dpr?: number;
  frame: number;
  layers: ResolvedWebCodecsVisualLayer[];
  transition?: ResolvedWebCodecsTransition;
  transitionRenderer?: WebGLTransitionRenderer;
  viewport?: PreviewViewportGeometry;
}): void {
  if (viewport) {
    drawViewportWebCodecsFrame({
      ctx,
      data,
      dpr,
      frame,
      layers,
      transition,
      transitionRenderer,
      viewport,
    });
    return;
  }

  drawCompositionWebCodecsFrame({
    ctx,
    data,
    frame,
    layers,
    transition,
    transitionRenderer,
  });
}

function drawViewportWebCodecsFrame({
  ctx,
  data,
  dpr,
  frame,
  layers,
  transition,
  transitionRenderer,
  viewport,
}: {
  ctx: CanvasRenderingContext2D;
  data: RemotionPreviewData;
  dpr: number;
  frame: number;
  layers: ResolvedWebCodecsVisualLayer[];
  transition?: ResolvedWebCodecsTransition;
  transitionRenderer?: WebGLTransitionRenderer;
  viewport: PreviewViewportGeometry;
}): void {
  const frameRect = frameRectInViewport(viewport);
  const pixelRatio = Math.max(1, dpr);

  ctx.save();
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.filter = 'none';
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, viewport.viewportWidth, viewport.viewportHeight);
  ctx.fillStyle = WORKING_AREA_BACKGROUND;
  ctx.fillRect(0, 0, viewport.viewportWidth, viewport.viewportHeight);

  ctx.save();
  ctx.translate(frameRect.x, frameRect.y);
  ctx.scale(viewport.scale, viewport.scale);
  drawCompositionWebCodecsFrame({
    ctx,
    data,
    frame,
    layers,
    transition,
    transitionRenderer,
  });
  ctx.restore();

  // Always dim off-frame content and mark the viewable rectangle — in both
  // editing and playback — so the output-frame region is a stable, consistent
  // reference and out-of-frame pixels read as "not in the final video".
  drawDimMaskOutside(ctx, frameRect, viewport);
  strokeFrameOutline(ctx, frameRect);
  ctx.restore();
}

function drawCompositionWebCodecsFrame({
  ctx,
  data,
  frame,
  layers,
  transition,
  transitionRenderer,
}: {
  ctx: CanvasRenderingContext2D;
  data: RemotionPreviewData;
  frame: number;
  layers: ResolvedWebCodecsVisualLayer[];
  transition?: ResolvedWebCodecsTransition;
  transitionRenderer?: WebGLTransitionRenderer;
}): void {
  if (transition && transition.kind !== 'cut') {
    const transitionCanvas = renderTransitionFrame({
      data,
      frame,
      transition,
      transitionRenderer,
    });
    if (transitionCanvas) {
      ctx.drawImage(
        transitionCanvas,
        0,
        0,
        data.compositionWidth,
        data.compositionHeight,
      );
      return;
    }
  }

  ctx.save();
  ctx.filter = 'none';
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, data.compositionWidth, data.compositionHeight);
  ctx.restore();

  for (const layer of layers) {
    drawVisualLayer({
      clip: layer.layer.clip,
      ctx,
      data,
      frame,
      source: layer.source,
    });
  }

  for (const caption of data.captions) {
    drawCaptionLayer({ caption, ctx, data, frame });
  }

  const opacity = bookendOverlayOpacity({
    absoluteFrame: frame,
    compositionDurationInFrames: data.durationInFrames,
    introFrames: data.introFrames,
    outroFrames: data.outroFrames,
  });
  if (opacity > 0) {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, data.compositionWidth, data.compositionHeight);
    ctx.restore();
  }
}

function renderTransitionFrame({
  data,
  frame,
  transition,
  transitionRenderer,
}: {
  data: RemotionPreviewData;
  frame: number;
  transition: ResolvedWebCodecsTransition;
  transitionRenderer?: WebGLTransitionRenderer;
}): HTMLCanvasElement | null {
  const spec = getTransitionShaderSpec(transition);
  if (!spec) return null;

  // Reuse persistent scratch canvases across frames — allocating fresh
  // composition-sized canvases per frame churned the GC during a dissolve.
  const from = getScratchCompositionCanvas('transition-from', data);
  const to = getScratchCompositionCanvas('transition-to', data);
  if (!from || !to) return null;

  drawCompositionWebCodecsFrame({
    ctx: from.ctx,
    data,
    frame,
    layers: transition.fromLayers,
  });
  drawCompositionWebCodecsFrame({
    ctx: to.ctx,
    data,
    frame,
    layers: transition.toLayers,
  });

  if (transitionRenderer) {
    return transitionRenderer.renderTransition({
      from: from.canvas,
      height: data.compositionHeight,
      progress: transition.progress,
      spec,
      to: to.canvas,
      width: data.compositionWidth,
    });
  }

  const fallback = getScratchCompositionCanvas('transition-fallback', data);
  if (!fallback) return null;
  fallback.ctx.clearRect(0, 0, data.compositionWidth, data.compositionHeight);
  fallback.ctx.globalAlpha = 1;
  fallback.ctx.drawImage(from.canvas, 0, 0);
  fallback.ctx.globalAlpha = clamp01(transition.progress);
  fallback.ctx.drawImage(to.canvas, 0, 0);
  fallback.ctx.globalAlpha = 1;
  return fallback.canvas;
}

const scratchCompositionCanvases = new Map<
  string,
  { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }
>();

function getScratchCompositionCanvas(
  key: string,
  data: Pick<RemotionPreviewData, 'compositionHeight' | 'compositionWidth'>,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const width = Math.max(1, Math.round(data.compositionWidth));
  const height = Math.max(1, Math.round(data.compositionHeight));
  let entry = scratchCompositionCanvases.get(key);
  if (!entry) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    entry = { canvas, ctx };
    scratchCompositionCanvases.set(key, entry);
  }
  // Reassigning width/height clears the surface, so only do it on a real
  // size change; each frame fully repaints the canvas anyway.
  if (entry.canvas.width !== width) entry.canvas.width = width;
  if (entry.canvas.height !== height) entry.canvas.height = height;
  return entry;
}

function drawDimMaskOutside(
  ctx: CanvasRenderingContext2D,
  frameRect: PreviewViewportRect,
  viewport: Pick<PreviewViewportGeometry, 'viewportHeight' | 'viewportWidth'>,
): void {
  const frameLeft = clamp(frameRect.x, 0, viewport.viewportWidth);
  const frameTop = clamp(frameRect.y, 0, viewport.viewportHeight);
  const frameRight = clamp(
    frameRect.x + frameRect.w,
    0,
    viewport.viewportWidth,
  );
  const frameBottom = clamp(
    frameRect.y + frameRect.h,
    0,
    viewport.viewportHeight,
  );

  ctx.save();
  ctx.fillStyle = OUTSIDE_FRAME_MASK;
  ctx.fillRect(0, 0, viewport.viewportWidth, frameTop);
  ctx.fillRect(
    0,
    frameBottom,
    viewport.viewportWidth,
    viewport.viewportHeight - frameBottom,
  );
  ctx.fillRect(0, frameTop, frameLeft, frameBottom - frameTop);
  ctx.fillRect(
    frameRight,
    frameTop,
    viewport.viewportWidth - frameRight,
    frameBottom - frameTop,
  );
  ctx.restore();
}

function strokeFrameOutline(
  ctx: CanvasRenderingContext2D,
  frameRect: PreviewViewportRect,
): void {
  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = FRAME_OUTLINE_CONTRAST;
  ctx.strokeRect(frameRect.x, frameRect.y, frameRect.w, frameRect.h);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = FRAME_OUTLINE;
  ctx.strokeRect(frameRect.x, frameRect.y, frameRect.w, frameRect.h);
  ctx.restore();
}

export function drawVisualLayer({
  clip,
  ctx,
  data,
  frame,
  source,
}: {
  clip: RemotionVisualClip;
  ctx: CanvasRenderingContext2D;
  data: Pick<RemotionPreviewData, 'compositionHeight' | 'compositionWidth'>;
  frame: number;
  source: WebCodecsDrawableSource;
}): void {
  const sourceSize = getDrawableSize(source);
  if (!sourceSize) return;
  const width = data.compositionWidth;
  const height = data.compositionHeight;
  const transform = getLayerTransformGeometry({ clip, data });

  ctx.save();
  ctx.globalAlpha = clamp01(clip.transform?.opacity ?? 1);
  applyLayerCanvasTransform(ctx, transform);
  drawClipSource({
    clip,
    cssFilter: buildVideoClipCssFilter(clip.filters) ?? 'none',
    ctx,
    frame,
    source,
    sourceHeight: sourceSize.height,
    sourceWidth: sourceSize.width,
    targetHeight: height,
    targetWidth: width,
  });
  ctx.restore();
}

export interface KenBurnsRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

export function getKenBurnsRect({
  durationInFrames,
  imagePan,
  localFrame,
}: {
  durationInFrames: number;
  imagePan: NonNullable<RemotionVisualClip['imagePan']>;
  localFrame: number;
}): KenBurnsRect {
  const progress = clamp01(localFrame / Math.max(1, durationInFrames - 1));
  const from = normalizeKenBurnsRect(imagePan.from);
  const to = normalizeKenBurnsRect(imagePan.to);
  return {
    x: lerp(from.x, to.x, progress),
    y: lerp(from.y, to.y, progress),
    width: lerp(from.width, to.width, progress),
    height: lerp(from.height, to.height, progress),
  };
}

export function getCaptionOpacity({
  caption,
  frame,
}: {
  caption: RemotionCaption;
  frame: number;
}): number {
  const localFrame = frame - caption.fromFrame;
  if (localFrame < 0 || localFrame >= caption.durationInFrames) return 0;
  const durationFrames = Math.max(1, caption.durationInFrames);
  const entranceFrames = Math.max(
    0,
    Math.min(caption.entranceFrames ?? 0, durationFrames),
  );
  const exitFrames = Math.max(
    0,
    Math.min(caption.exitFrames ?? 0, durationFrames - entranceFrames),
  );
  let opacity = 1;
  if (entranceFrames > 0 && localFrame < entranceFrames) {
    opacity = localFrame / entranceFrames;
  }
  if (exitFrames > 0 && localFrame > durationFrames - exitFrames) {
    opacity = Math.min(
      opacity,
      Math.max(0, (durationFrames - localFrame) / exitFrames),
    );
  }
  return clamp01(opacity);
}

function drawClipSource({
  clip,
  cssFilter,
  ctx,
  frame,
  source,
  sourceHeight,
  sourceWidth,
  targetHeight,
  targetWidth,
}: {
  clip: RemotionVisualClip;
  cssFilter: string;
  ctx: CanvasRenderingContext2D;
  frame: number;
  source: WebCodecsDrawableSource;
  sourceHeight: number;
  sourceWidth: number;
  targetHeight: number;
  targetWidth: number;
}): void {
  if (clip.transform?.background) {
    ctx.save();
    ctx.fillStyle = clip.transform.background;
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.restore();
  }

  if (clip.transform?.fit === 'blur-pad') {
    drawBlurPadSource({
      clip,
      cssFilter,
      ctx,
      source,
      sourceHeight,
      sourceWidth,
      targetHeight,
      targetWidth,
    });
    return;
  }

  ctx.save();
  ctx.filter = cssFilter;
  if (clip.imagePan) {
    drawKenBurnsSource({
      clip,
      ctx,
      frame,
      source,
      sourceHeight,
      sourceWidth,
      targetHeight,
      targetWidth,
    });
  } else {
    drawFittedSource({
      ctx,
      fit: clip.transform?.fit ?? 'cover',
      reframeAnchor: clip.reframe?.anchor,
      source,
      sourceHeight,
      sourceWidth,
      targetHeight,
      targetWidth,
    });
  }
  ctx.restore();
}

function drawBlurPadSource({
  clip,
  cssFilter,
  ctx,
  source,
  sourceHeight,
  sourceWidth,
  targetHeight,
  targetWidth,
}: {
  clip: RemotionVisualClip;
  cssFilter: string;
  ctx: CanvasRenderingContext2D;
  source: WebCodecsDrawableSource;
  sourceHeight: number;
  sourceWidth: number;
  targetHeight: number;
  targetWidth: number;
}) {
  ctx.save();
  ctx.filter = combineCanvasFilters(cssFilter, `blur(${BLUR_PAD_RADIUS_PX}px)`);
  ctx.translate(targetWidth / 2, targetHeight / 2);
  ctx.scale(BLUR_PAD_SCALE, BLUR_PAD_SCALE);
  ctx.translate(-targetWidth / 2, -targetHeight / 2);
  drawFittedSource({
    ctx,
    fit: 'cover',
    reframeAnchor: clip.reframe?.anchor,
    source,
    sourceHeight,
    sourceWidth,
    targetHeight,
    targetWidth,
  });
  ctx.restore();

  ctx.save();
  ctx.filter = cssFilter;
  drawFittedSource({
    ctx,
    fit: 'contain',
    reframeAnchor: 'center',
    source,
    sourceHeight,
    sourceWidth,
    targetHeight,
    targetWidth,
  });
  ctx.restore();
}

function drawKenBurnsSource({
  clip,
  ctx,
  frame,
  source,
  sourceHeight,
  sourceWidth,
  targetHeight,
  targetWidth,
}: {
  clip: RemotionVisualClip;
  ctx: CanvasRenderingContext2D;
  frame: number;
  source: WebCodecsDrawableSource;
  sourceHeight: number;
  sourceWidth: number;
  targetHeight: number;
  targetWidth: number;
}) {
  if (!clip.imagePan) return;
  const rect = getKenBurnsRect({
    durationInFrames: clip.durationInFrames,
    imagePan: clip.imagePan,
    localFrame: frame - clip.fromFrame,
  });
  ctx.drawImage(
    source,
    rect.x * sourceWidth,
    rect.y * sourceHeight,
    rect.width * sourceWidth,
    rect.height * sourceHeight,
    0,
    0,
    targetWidth,
    targetHeight,
  );
}

function drawFittedSource({
  ctx,
  fit,
  reframeAnchor,
  source,
  sourceHeight,
  sourceWidth,
  targetHeight,
  targetWidth,
}: {
  ctx: CanvasRenderingContext2D;
  fit: NonNullable<RemotionVisualClip['transform']>['fit'] | undefined;
  reframeAnchor?: string;
  source: WebCodecsDrawableSource;
  sourceHeight: number;
  sourceWidth: number;
  targetHeight: number;
  targetWidth: number;
}) {
  const rect = getObjectFitRect({
    fit,
    reframeAnchor,
    sourceHeight,
    sourceWidth,
    targetHeight,
    targetWidth,
  });
  ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height);
}

function drawCaptionLayer({
  caption,
  ctx,
  data,
  frame,
}: {
  caption: RemotionCaption;
  ctx: CanvasRenderingContext2D;
  data: Pick<RemotionPreviewData, 'compositionHeight' | 'compositionWidth'>;
  frame: number;
}) {
  const opacity = getCaptionOpacity({ caption, frame });
  if (opacity <= 0) return;
  const defaultY =
    caption.position === 'top'
      ? 0.1
      : caption.position === 'middle'
        ? 0.5
        : 0.85;
  const fontSize =
    caption.fontSize ?? Math.round(data.compositionHeight * 0.045);
  const maxWidth = Math.max(
    1,
    data.compositionWidth *
      Math.max(0.05, Math.min(1, caption.maxWidth ?? 0.8)),
  );
  const x = data.compositionWidth * clamp01(caption.positionX ?? 0.5);
  const y = data.compositionHeight * clamp01(caption.positionY ?? defaultY);
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.font = `${caption.fontStyle ?? 'normal'} ${caption.fontWeight ?? '700'} ${fontSize}px ${
    caption.fontFamily ?? DEFAULT_FONT_FAMILY
  }`;
  ctx.textBaseline = 'top';
  ctx.textAlign = caption.textAlign ?? 'center';
  const textMaxWidth = Math.max(1, maxWidth - CAPTION_HORIZONTAL_PADDING * 2);
  const lines = wrapText(ctx, caption.text, textMaxWidth);
  const lineHeight = Math.round(fontSize * 1.18);
  const textWidth = Math.min(
    textMaxWidth,
    Math.max(...lines.map((line) => ctx.measureText(line).width), 1),
  );
  const boxWidth = textWidth + CAPTION_HORIZONTAL_PADDING * 2;
  const boxHeight = lines.length * lineHeight + CAPTION_VERTICAL_PADDING * 2;
  const boxX = clamp(x - boxWidth / 2, 0, data.compositionWidth - boxWidth);
  const boxY = clamp(y, 0, data.compositionHeight - boxHeight);
  ctx.fillStyle = caption.background ?? DEFAULT_CAPTION_BACKGROUND;
  ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
  ctx.fillStyle = caption.color ?? DEFAULT_CAPTION_COLOR;
  const textX =
    (caption.textAlign ?? 'center') === 'left'
      ? boxX + CAPTION_HORIZONTAL_PADDING
      : (caption.textAlign ?? 'center') === 'right'
        ? boxX + boxWidth - CAPTION_HORIZONTAL_PADDING
        : boxX + boxWidth / 2;
  if (caption.shadowColor) {
    ctx.shadowColor = caption.shadowColor;
    ctx.shadowBlur = caption.shadowBlur ?? 0;
    ctx.shadowOffsetX = caption.shadowOffsetX ?? 0;
    ctx.shadowOffsetY = caption.shadowOffsetY ?? 0;
  }
  for (const [index, line] of lines.entries()) {
    const textY = boxY + CAPTION_VERTICAL_PADDING + index * lineHeight;
    if (caption.strokeColor && caption.strokeWidth && caption.strokeWidth > 0) {
      ctx.lineWidth = caption.strokeWidth;
      ctx.strokeStyle = caption.strokeColor;
      ctx.strokeText(line, textX, textY);
    }
    ctx.fillText(line, textX, textY);
  }
  ctx.restore();
}

function wrapText(
  ctx: Pick<CanvasRenderingContext2D, 'measureText'>,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = words[0] ?? '';
  for (const word of words.slice(1)) {
    const next = `${current} ${word}`;
    if (ctx.measureText(next).width <= maxWidth) {
      current = next;
    } else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines;
}

function getDrawableSize(source: WebCodecsDrawableSource): {
  height: number;
  width: number;
} | null {
  const maybe = source as {
    height?: number;
    naturalHeight?: number;
    naturalWidth?: number;
    videoHeight?: number;
    videoWidth?: number;
    width?: number;
  };
  const width = maybe.videoWidth ?? maybe.naturalWidth ?? maybe.width;
  const height = maybe.videoHeight ?? maybe.naturalHeight ?? maybe.height;
  if (!width || !height || width <= 0 || height <= 0) return null;
  return { width, height };
}

function combineCanvasFilters(baseFilter: string, nextFilter: string): string {
  if (baseFilter === 'none') return nextFilter;
  return `${baseFilter} ${nextFilter}`;
}

function normalizeKenBurnsRect(rect: KenBurnsRect): KenBurnsRect {
  const width = clamp(rect.width, 0.05, 1);
  const height = clamp(rect.height, 0.05, 1);
  return {
    x: clamp(rect.x, 0, 1 - width),
    y: clamp(rect.y, 0, 1 - height),
    width,
    height,
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
