import type {
  TransitionPresentation,
  TransitionPresentationComponentProps,
} from '@remotion/transitions';
import React, { type CSSProperties } from 'react';
import { AbsoluteFill } from 'remotion';

interface RemotionClockWipePresentationProps extends Record<string, unknown> {
  center: readonly [number, number];
  counterClockwise: boolean;
  edgeColor: readonly [number, number, number, number];
  feather: number;
  height: number;
  sectors: number;
  startAngleDeg: number;
  width: number;
}

interface ClockWipeClipPathInput extends RemotionClockWipePresentationProps {
  progress: number;
}

interface ClockWipeLayerStylesInput extends ClockWipeClipPathInput {
  presentationDirection: 'entering' | 'exiting';
}

interface ClockWipeLayerStyles {
  edgeStyle?: CSSProperties;
  innerStyle: CSSProperties;
  outerStyle: CSSProperties;
}

interface ClockWipeArcPointsInput {
  center: readonly [number, number];
  counterClockwise: boolean;
  height: number;
  progress: number;
  startAngleDeg: number;
  width: number;
}

export function remotionClockWipePresentation(
  props: RemotionClockWipePresentationProps,
): TransitionPresentation<RemotionClockWipePresentationProps> {
  return { component: RemotionClockWipePresentation, props };
}

export function clockWipeClipPath({
  center,
  counterClockwise,
  height,
  progress,
  sectors,
  startAngleDeg,
  width,
}: ClockWipeClipPathInput): string {
  const clampedProgress = effectiveClockWipeProgress(progress, sectors);
  if (clampedProgress >= 1) return 'inset(0)';
  if (clampedProgress <= 0) {
    const centerPoint = [
      clamp01(center[0]) * 100,
      clamp01(center[1]) * 100,
    ] as const;
    return `polygon(${formatPoint(centerPoint)}, ${formatPoint(centerPoint)}, ${formatPoint(centerPoint)})`;
  }

  const { centerPoint, points } = clockWipeArcPoints({
    center,
    counterClockwise,
    height,
    progress: clampedProgress,
    startAngleDeg,
    width,
  });
  return `polygon(${[centerPoint, ...points].map(formatPoint).join(', ')})`;
}

export function clockWipeEdgeClipPath({
  center,
  counterClockwise,
  feather,
  height,
  progress,
  sectors,
  startAngleDeg,
  width,
}: ClockWipeClipPathInput): string | undefined {
  const edge = effectiveClockWipeProgress(progress, sectors);
  const featherProgress = clamp01(feather);
  if (edge <= 0 || edge >= 1 || featherProgress <= 0) return undefined;
  const bandProgress = Math.max(
    1 / Math.max(1, Math.min(width, height)),
    featherProgress * 0.18,
  );

  const centerPoint = clockWipeCenterPoint(center);
  const startPoint = clockWipeRayPoint({
    center,
    counterClockwise,
    height,
    progress: edge - bandProgress,
    startAngleDeg,
    width,
  });
  const endPoint = clockWipeRayPoint({
    center,
    counterClockwise,
    height,
    progress: edge + bandProgress,
    startAngleDeg,
    width,
  });
  return `polygon(${[centerPoint, startPoint, endPoint]
    .map(formatPoint)
    .join(', ')})`;
}

export function clockWipeLayerStyles({
  edgeColor,
  feather,
  presentationDirection,
  progress,
  ...input
}: ClockWipeLayerStylesInput): ClockWipeLayerStyles {
  const revealLayer = presentationDirection === 'exiting';
  const edgeClipPath = revealLayer
    ? clockWipeEdgeClipPath({ ...input, edgeColor, feather, progress })
    : undefined;
  return {
    outerStyle: {
      zIndex: revealLayer ? 2 : 1,
    },
    innerStyle: {
      clipPath: revealLayer
        ? clockWipeClipPath({ ...input, edgeColor, feather, progress })
        : undefined,
      height: '100%',
      width: '100%',
    },
    ...(edgeClipPath
      ? {
          edgeStyle: {
            backgroundColor: edgeColorToCss(edgeColor),
            clipPath: edgeClipPath,
            filter: `blur(${edgeFeatherBlurPx({
              feather,
              height: input.height,
              width: input.width,
            })}px)`,
            height: '100%',
            opacity: edgeOverlayOpacity(feather),
            width: '100%',
          },
        }
      : {}),
  };
}

function effectiveClockWipeProgress(progress: number, sectors: number): number {
  const clampedProgress = clamp01(progress);
  const sectorCount = Math.max(1, Math.round(sectors));
  return sectorCount <= 1
    ? clampedProgress
    : Math.floor(clampedProgress * sectorCount + 0.0001) / sectorCount;
}

function clockWipeArcPoints({
  center,
  counterClockwise,
  height,
  progress,
  startAngleDeg,
  width,
}: ClockWipeArcPointsInput): {
  centerPoint: readonly [number, number];
  points: Array<readonly [number, number]>;
} {
  const clampedProgress = clamp01(progress);
  const centerPoint = clockWipeCenterPoint(center);
  if (clampedProgress <= 0) return { centerPoint, points: [] };

  const sweepDeg = clampedProgress * 360;
  const steps = Math.max(2, Math.ceil(sweepDeg / 8));
  return {
    centerPoint,
    points: Array.from({ length: steps + 1 }, (_, index) => {
      const ratio = index / steps;
      return clockWipeRayPoint({
        center,
        counterClockwise,
        height,
        progress: clampedProgress * ratio,
        startAngleDeg,
        width,
      });
    }),
  };
}

function clockWipeCenterPoint(
  center: readonly [number, number],
): readonly [number, number] {
  return [clamp01(center[0]) * 100, clamp01(center[1]) * 100] as const;
}

function clockWipeRayPoint({
  center,
  counterClockwise,
  height,
  progress,
  startAngleDeg,
  width,
}: ClockWipeArcPointsInput): readonly [number, number] {
  const centerX = clamp01(center[0]);
  const centerY = clamp01(center[1]);
  const radiusPx = Math.sqrt(width * width + height * height);
  const sweepSign = counterClockwise ? -1 : 1;
  const startRad = degreesToRadians(startAngleDeg - 180);
  const angle = startRad + sweepSign * degreesToRadians(progress * 360);
  const xPx = centerX * width + Math.cos(angle) * radiusPx;
  const yPx = centerY * height + Math.sin(angle) * radiusPx;
  return [(xPx / width) * 100, (yPx / height) * 100] as const;
}

function edgeFeatherBlurPx({
  feather,
  height,
  width,
}: {
  feather: number;
  height: number;
  width: number;
}): number {
  return Math.round(Math.min(width, height) * clamp01(feather) * 0.2 * 10) / 10;
}

function edgeOverlayOpacity(feather: number): number {
  return Math.round(Math.min(0.9, 0.45 + clamp01(feather) * 2) * 100) / 100;
}

function RemotionClockWipePresentation({
  children,
  presentationDirection,
  presentationProgress,
  passedProps,
}: TransitionPresentationComponentProps<RemotionClockWipePresentationProps>) {
  const styles = clockWipeLayerStyles({
    ...passedProps,
    presentationDirection,
    progress: presentationProgress,
  });

  return React.createElement(
    AbsoluteFill,
    { style: styles.outerStyle },
    React.createElement(AbsoluteFill, { style: styles.innerStyle }, children),
    styles.edgeStyle
      ? React.createElement(AbsoluteFill, { style: styles.edgeStyle })
      : null,
  );
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function formatPoint(point: readonly [number, number]): string {
  return `${formatPercent(point[0])}% ${formatPercent(point[1])}%`;
}

function formatPercent(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

function edgeColorToCss(
  color: readonly [number, number, number, number],
): string {
  const [red, green, blue, alpha] = color;
  return `rgba(${colorChannel(red)}, ${colorChannel(green)}, ${colorChannel(
    blue,
  )}, ${clamp01(alpha)})`;
}

function colorChannel(value: number): number {
  return Math.round(clamp01(value) * 255);
}
