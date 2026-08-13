import type {
  RemotionPreviewData,
  RemotionVisualClip,
} from '../remotionPreviewData';

export interface FitRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface LayerTransformGeometry {
  canvasHeight: number;
  canvasWidth: number;
  positionX: number;
  positionY: number;
  rotationDegrees: number;
  scaleX: number;
  scaleY: number;
  translateX: number;
  translateY: number;
}

export interface LayerBoundsInComposition {
  cx: number;
  cy: number;
  h: number;
  rotation: number;
  w: number;
}

export function getLayerTransformGeometry({
  clip,
  data,
}: {
  clip: RemotionVisualClip;
  data: Pick<RemotionPreviewData, 'compositionHeight' | 'compositionWidth'>;
}): LayerTransformGeometry {
  const transform = clip.transform;
  const canvasWidth = data.compositionWidth;
  const canvasHeight = data.compositionHeight;
  const positionX = transform?.positionX ?? 0.5;
  const positionY = transform?.positionY ?? 0.5;
  return {
    canvasHeight,
    canvasWidth,
    positionX,
    positionY,
    rotationDegrees: transform?.rotation ?? 0,
    scaleX: transform?.scaleX ?? transform?.scale ?? 1,
    scaleY: transform?.scaleY ?? transform?.scale ?? 1,
    translateX: (positionX - 0.5) * canvasWidth,
    translateY: (positionY - 0.5) * canvasHeight,
  };
}

export function applyLayerCanvasTransform(
  ctx: Pick<CanvasRenderingContext2D, 'rotate' | 'scale' | 'translate'>,
  transform: LayerTransformGeometry,
): void {
  ctx.translate(transform.translateX, transform.translateY);
  ctx.translate(transform.canvasWidth / 2, transform.canvasHeight / 2);
  ctx.rotate(degToRad(transform.rotationDegrees));
  ctx.scale(transform.scaleX, transform.scaleY);
  ctx.translate(-transform.canvasWidth / 2, -transform.canvasHeight / 2);
}

export function getLayerBoundsInComposition({
  clip,
  data,
  sourceHeight,
  sourceWidth,
}: {
  clip: RemotionVisualClip;
  data: Pick<RemotionPreviewData, 'compositionHeight' | 'compositionWidth'>;
  sourceHeight: number;
  sourceWidth: number;
}): LayerBoundsInComposition {
  const transform = getLayerTransformGeometry({ clip, data });
  const fit =
    clip.transform?.fit === 'blur-pad'
      ? 'contain'
      : (clip.transform?.fit ?? 'cover');
  const rect = getObjectFitRect({
    fit,
    reframeAnchor:
      clip.transform?.fit === 'blur-pad' ? 'center' : clip.reframe?.anchor,
    sourceHeight,
    sourceWidth,
    targetHeight: data.compositionHeight,
    targetWidth: data.compositionWidth,
  });
  const rectCenterX = rect.x + rect.width / 2;
  const rectCenterY = rect.y + rect.height / 2;
  return {
    cx:
      data.compositionWidth / 2 +
      transform.translateX +
      (rectCenterX - data.compositionWidth / 2) * transform.scaleX,
    cy:
      data.compositionHeight / 2 +
      transform.translateY +
      (rectCenterY - data.compositionHeight / 2) * transform.scaleY,
    h: rect.height * transform.scaleY,
    rotation: transform.rotationDegrees,
    w: rect.width * transform.scaleX,
  };
}

export function getObjectFitRect({
  fit,
  reframeAnchor,
  sourceHeight,
  sourceWidth,
  targetHeight,
  targetWidth,
}: {
  fit: NonNullable<RemotionVisualClip['transform']>['fit'] | undefined;
  reframeAnchor?: string;
  sourceHeight: number;
  sourceWidth: number;
  targetHeight: number;
  targetWidth: number;
}): FitRect {
  if (fit === 'fill') {
    return { x: 0, y: 0, width: targetWidth, height: targetHeight };
  }
  // Guard against a zero-dimension source/target (a still-decoding frame can
  // report 0) so the aspect-ratio math can't produce NaN/Infinity.
  if (
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    targetWidth <= 0 ||
    targetHeight <= 0
  ) {
    return { x: 0, y: 0, width: targetWidth, height: targetHeight };
  }
  const sourceAspect = sourceWidth / sourceHeight;
  const targetAspect = targetWidth / targetHeight;
  if (fit === 'contain') {
    if (sourceAspect > targetAspect) {
      const height = targetWidth / sourceAspect;
      return {
        x: 0,
        y: (targetHeight - height) / 2,
        width: targetWidth,
        height,
      };
    }
    const width = targetHeight * sourceAspect;
    return { x: (targetWidth - width) / 2, y: 0, width, height: targetHeight };
  }
  if (sourceAspect > targetAspect) {
    const width = targetHeight * sourceAspect;
    const anchorX = anchorFractionX(reframeAnchor);
    return {
      x: (targetWidth - width) * anchorX,
      y: 0,
      width,
      height: targetHeight,
    };
  }
  const height = targetWidth / sourceAspect;
  const anchorY = anchorFractionY(reframeAnchor);
  return {
    x: 0,
    y: (targetHeight - height) * anchorY,
    width: targetWidth,
    height,
  };
}

function degToRad(value: number): number {
  return (value * Math.PI) / 180;
}

function anchorFractionX(anchor: string | undefined): number {
  if (anchor === 'left') return 0;
  if (anchor === 'right') return 1;
  return 0.5;
}

function anchorFractionY(anchor: string | undefined): number {
  if (anchor === 'top') return 0;
  if (anchor === 'top-third') return 1 / 3;
  if (anchor === 'bottom') return 1;
  return 0.5;
}
