import type {
  VividOverlayCategory,
  VividOverlayMotionTemplateId,
  VividOverlayMotionTemplateStrength,
} from './overlay-types.js';
import type {
  ClipTransform,
  KeyframeTrack,
  KeyframeableProperty,
} from './timeline-types.js';

export interface VividOverlayMotionTemplateDef {
  id: VividOverlayMotionTemplateId;
  group: 'entrance' | 'emphasis' | 'attention' | 'exit' | 'ambient';
  label: string;
  compatibleCategories?: readonly VividOverlayCategory[];
  affectedProperties: readonly KeyframeableProperty[];
  durationMs: number;
  easing: 'hold' | 'linear' | 'smooth';
  reducedMotionFallback: 'opacity-only' | 'poster';
  overwritePolicy: 'replace-affected';
}

export interface BuildVividOverlayMotionTemplateTracksInput {
  templateId: VividOverlayMotionTemplateId;
  strength?: VividOverlayMotionTemplateStrength;
  clipDurationMs: number;
  transforms?: ClipTransform;
}

const CALLOUT_CATEGORIES = [
  'title',
  'callout',
  'social',
  'badge',
  'reaction',
  'progress',
  'widget',
  'caption',
] as const satisfies readonly VividOverlayCategory[];

const ALL_CATEGORIES = [
  'caption',
  'sticker',
  'title',
  'callout',
  'ambient',
  'social',
  'progress',
  'frame',
  'badge',
  'reaction',
  'screen',
  'widget',
] as const satisfies readonly VividOverlayCategory[];

const STRENGTH_MULTIPLIER: Record<VividOverlayMotionTemplateStrength, number> =
  {
    subtle: 0.65,
    normal: 1,
    strong: 1.45,
  };

export const VIVID_OVERLAY_MOTION_TEMPLATES: readonly VividOverlayMotionTemplateDef[] =
  [
    {
      id: 'entrance.fade-up',
      group: 'entrance',
      label: 'Fade up',
      compatibleCategories: CALLOUT_CATEGORIES,
      affectedProperties: ['opacity', 'positionY'],
      durationMs: 520,
      easing: 'smooth',
      reducedMotionFallback: 'opacity-only',
      overwritePolicy: 'replace-affected',
    },
    {
      id: 'entrance.scale-in',
      group: 'entrance',
      label: 'Scale in',
      compatibleCategories: ALL_CATEGORIES,
      affectedProperties: ['opacity', 'scale'],
      durationMs: 480,
      easing: 'smooth',
      reducedMotionFallback: 'opacity-only',
      overwritePolicy: 'replace-affected',
    },
    {
      id: 'emphasis.pulse',
      group: 'emphasis',
      label: 'Pulse',
      compatibleCategories: CALLOUT_CATEGORIES,
      affectedProperties: ['scale'],
      durationMs: 680,
      easing: 'smooth',
      reducedMotionFallback: 'poster',
      overwritePolicy: 'replace-affected',
    },
    {
      id: 'emphasis.shake',
      group: 'emphasis',
      label: 'Shake',
      compatibleCategories: ['callout', 'reaction', 'sticker', 'badge'],
      affectedProperties: ['positionX'],
      durationMs: 420,
      easing: 'linear',
      reducedMotionFallback: 'poster',
      overwritePolicy: 'replace-affected',
    },
    {
      id: 'attention.ping',
      group: 'attention',
      label: 'Ping',
      compatibleCategories: ['callout', 'social', 'badge', 'reaction'],
      affectedProperties: ['scale', 'opacity'],
      durationMs: 760,
      easing: 'smooth',
      reducedMotionFallback: 'opacity-only',
      overwritePolicy: 'replace-affected',
    },
    {
      id: 'exit.fade-out',
      group: 'exit',
      label: 'Fade out',
      compatibleCategories: ALL_CATEGORIES,
      affectedProperties: ['opacity'],
      durationMs: 420,
      easing: 'smooth',
      reducedMotionFallback: 'opacity-only',
      overwritePolicy: 'replace-affected',
    },
    {
      id: 'ambient.float',
      group: 'ambient',
      label: 'Float',
      compatibleCategories: ['ambient', 'sticker', 'frame', 'screen', 'widget'],
      affectedProperties: ['positionY'],
      durationMs: 1800,
      easing: 'smooth',
      reducedMotionFallback: 'poster',
      overwritePolicy: 'replace-affected',
    },
  ];

export function findVividOverlayMotionTemplate(
  templateId: string,
): VividOverlayMotionTemplateDef | undefined {
  return VIVID_OVERLAY_MOTION_TEMPLATES.find(
    (template) => template.id === templateId,
  );
}

export function vividOverlayMotionTemplateSupportsCategory(
  template: VividOverlayMotionTemplateDef,
  category: VividOverlayCategory | undefined,
): boolean {
  return (
    !category ||
    !template.compatibleCategories ||
    template.compatibleCategories.includes(category)
  );
}

export function buildVividOverlayMotionTemplateTracks(
  input: BuildVividOverlayMotionTemplateTracksInput,
): KeyframeTrack[] {
  const template = findVividOverlayMotionTemplate(input.templateId);
  if (!template) return [];
  const strength = input.strength ?? 'normal';
  const multiplier = STRENGTH_MULTIPLIER[strength];
  const durationMs = Math.max(
    1,
    Math.min(template.durationMs, input.clipDurationMs),
  );
  const base = baseValues(input.transforms);
  switch (template.id) {
    case 'entrance.fade-up':
      return [
        {
          property: 'opacity',
          keys: [
            { atMs: 0, value: 0, interp: 'smooth' },
            { atMs: durationMs, value: base.opacity },
          ],
        },
        {
          property: 'positionY',
          keys: [
            {
              atMs: 0,
              value: base.positionY + 0.08 * multiplier,
              interp: 'smooth',
            },
            { atMs: durationMs, value: base.positionY },
          ],
        },
      ];
    case 'entrance.scale-in':
      return [
        {
          property: 'opacity',
          keys: [
            { atMs: 0, value: 0, interp: 'smooth' },
            { atMs: durationMs, value: base.opacity },
          ],
        },
        {
          property: 'scale',
          keys: [
            {
              atMs: 0,
              value: Math.max(0.01, base.scale * (1 - 0.18 * multiplier)),
              interp: 'smooth',
            },
            { atMs: durationMs, value: base.scale },
          ],
        },
      ];
    case 'emphasis.pulse':
      return [
        {
          property: 'scale',
          keys: [
            { atMs: 0, value: base.scale, interp: 'smooth' },
            {
              atMs: Math.round(durationMs / 2),
              value: base.scale + 0.1 * multiplier,
              interp: 'smooth',
            },
            { atMs: durationMs, value: base.scale },
          ],
        },
      ];
    case 'emphasis.shake': {
      const amount = 0.018 * multiplier;
      return [
        {
          property: 'positionX',
          keys: [
            { atMs: 0, value: base.positionX, interp: 'linear' },
            {
              atMs: Math.round(durationMs * 0.25),
              value: base.positionX - amount,
              interp: 'linear',
            },
            {
              atMs: Math.round(durationMs * 0.5),
              value: base.positionX + amount,
              interp: 'linear',
            },
            {
              atMs: Math.round(durationMs * 0.75),
              value: base.positionX - amount * 0.5,
              interp: 'linear',
            },
            { atMs: durationMs, value: base.positionX },
          ],
        },
      ];
    }
    case 'attention.ping':
      return [
        {
          property: 'scale',
          keys: [
            { atMs: 0, value: base.scale, interp: 'smooth' },
            {
              atMs: Math.round(durationMs * 0.45),
              value: base.scale + 0.16 * multiplier,
              interp: 'smooth',
            },
            { atMs: durationMs, value: base.scale },
          ],
        },
        {
          property: 'opacity',
          keys: [
            { atMs: 0, value: base.opacity, interp: 'smooth' },
            {
              atMs: Math.round(durationMs * 0.45),
              value: Math.max(0.2, base.opacity * 0.82),
              interp: 'smooth',
            },
            { atMs: durationMs, value: base.opacity },
          ],
        },
      ];
    case 'exit.fade-out': {
      const startAtMs = Math.max(0, input.clipDurationMs - durationMs);
      return [
        {
          property: 'opacity',
          keys: [
            { atMs: startAtMs, value: base.opacity, interp: 'smooth' },
            { atMs: input.clipDurationMs, value: 0 },
          ],
        },
      ];
    }
    case 'ambient.float':
      return [
        {
          property: 'positionY',
          keys: [
            { atMs: 0, value: base.positionY, interp: 'smooth' },
            {
              atMs: Math.round(durationMs / 2),
              value: base.positionY - 0.035 * multiplier,
              interp: 'smooth',
            },
            { atMs: durationMs, value: base.positionY },
          ],
        },
      ];
    default: {
      const exhaustive: never = template.id;
      return exhaustive;
    }
  }
}

function baseValues(transforms: ClipTransform | undefined): {
  opacity: number;
  positionX: number;
  positionY: number;
  scale: number;
} {
  return {
    opacity: transforms?.opacity ?? 1,
    positionX: transforms?.positionX ?? 0.5,
    positionY: transforms?.positionY ?? 0.5,
    scale: transforms?.scale ?? 1,
  };
}
