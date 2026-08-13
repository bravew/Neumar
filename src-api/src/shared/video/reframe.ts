import type { AspectRatio, AssetPlan, ReframeOverride } from './types';

export const REFRAME_ANCHORS = [
  'left',
  'center',
  'right',
  'top',
  'bottom',
  'top-third',
] as const;

export type ReframeAnchor = (typeof REFRAME_ANCHORS)[number];

export interface VideoReframePlan {
  aspect: AspectRatio;
  anchor: ReframeAnchor;
  offsetPx?: number;
}

export function defaultReframeAnchor(input: {
  aspectRatio: AspectRatio;
  assetPlanKind?: AssetPlan['kind'];
}): ReframeAnchor {
  if (input.aspectRatio !== '16:9' && input.assetPlanKind === 'lipsync') {
    return 'top-third';
  }
  return 'center';
}

export function resolveReframePlan(input: {
  aspectRatio: AspectRatio;
  enabled?: boolean;
  override?: ReframeOverride;
  assetPlanKind?: AssetPlan['kind'];
}): VideoReframePlan | undefined {
  if (input.enabled === false) return undefined;

  const override =
    input.override?.aspect === input.aspectRatio ? input.override : undefined;
  if (input.aspectRatio === '16:9' && !override) return undefined;

  const offsetPx = sanitizeOffsetPx(override?.offsetPx);
  return {
    aspect: input.aspectRatio,
    anchor:
      override?.anchor ??
      defaultReframeAnchor({
        aspectRatio: input.aspectRatio,
        assetPlanKind: input.assetPlanKind,
      }),
    ...(offsetPx === undefined ? {} : { offsetPx }),
  };
}

export function buildReframeCropFilters(
  size: { width: number; height: number },
  reframe: VideoReframePlan,
): string[] {
  return [
    `scale=${size.width}:${size.height}:force_original_aspect_ratio=increase`,
    `crop=${size.width}:${size.height}:${cropX(reframe)}:${cropY(reframe)}`,
  ];
}

function cropX(reframe: VideoReframePlan): string {
  const base =
    reframe.anchor === 'left'
      ? '0'
      : reframe.anchor === 'right'
        ? 'iw-ow'
        : '(iw-ow)/2';
  return clampExpression(
    applyOffset(base, reframe.offsetPx, horizontalOffset(reframe.anchor)),
    'iw-ow',
  );
}

function cropY(reframe: VideoReframePlan): string {
  const base =
    reframe.anchor === 'top'
      ? '0'
      : reframe.anchor === 'bottom'
        ? 'ih-oh'
        : reframe.anchor === 'top-third'
          ? '(ih-oh)/3'
          : '(ih-oh)/2';
  return clampExpression(
    applyOffset(base, reframe.offsetPx, !horizontalOffset(reframe.anchor)),
    'ih-oh',
  );
}

function horizontalOffset(anchor: ReframeAnchor): boolean {
  return anchor === 'left' || anchor === 'center' || anchor === 'right';
}

function applyOffset(
  expression: string,
  offsetPx: number | undefined,
  applies: boolean,
): string {
  if (!offsetPx || !applies) return expression;
  return offsetPx > 0
    ? `${expression}+${offsetPx}`
    : `${expression}${offsetPx}`;
}

function clampExpression(expression: string, maxExpression: string): string {
  return `min(max(${expression}\\,0)\\,${maxExpression})`;
}

function sanitizeOffsetPx(offsetPx: number | undefined): number | undefined {
  if (offsetPx === undefined) return undefined;
  if (!Number.isFinite(offsetPx)) return undefined;
  return Math.max(-5000, Math.min(5000, Math.round(offsetPx)));
}
