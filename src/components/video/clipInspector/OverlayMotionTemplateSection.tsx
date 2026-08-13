import { useEffect, useMemo, useState } from 'react';

import {
  buildVividOverlayMotionTemplateTracks,
  parseVividOverlayParams,
  VIVID_OVERLAY_MOTION_TEMPLATES,
  vividOverlayMotionTemplateSupportsCategory,
  type KeyframeTrack,
  type VividOverlayCategory,
  type VividOverlayMotionTemplateId,
  type VividOverlayMotionTemplateStrength,
} from '@neumar/video-ir';
import { Check, WandSparkles } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoEffectTimelineClip } from '@/shared/types/video';

type OverlayLabels = ReturnType<
  typeof useLanguage
>['t']['video']['editor']['clipInspector']['overlay'];

const STRENGTHS: VividOverlayMotionTemplateStrength[] = [
  'subtle',
  'normal',
  'strong',
];

export function OverlayMotionTemplateSection({
  category,
  clip,
  updateClip,
}: {
  category?: VividOverlayCategory;
  clip: VideoEffectTimelineClip;
  updateClip: (patch: Partial<VideoEffectTimelineClip>) => void;
}) {
  const { t } = useLanguage();
  const labels = t.video.editor.clipInspector.overlay;
  const templates = useMemo(
    () =>
      VIVID_OVERLAY_MOTION_TEMPLATES.filter((template) =>
        vividOverlayMotionTemplateSupportsCategory(template, category),
      ),
    [category],
  );
  const [templateId, setTemplateId] = useState<VividOverlayMotionTemplateId>(
    templates[0]?.id ?? 'entrance.scale-in',
  );
  const [strength, setStrength] =
    useState<VividOverlayMotionTemplateStrength>('normal');
  const [applied, setApplied] = useState(false);
  const selectedTemplate = templates.find(
    (template) => template.id === templateId,
  );
  useEffect(() => {
    if (selectedTemplate || !templates[0]) return;
    setTemplateId(templates[0].id);
    setApplied(false);
  }, [selectedTemplate, templates]);
  if (!selectedTemplate) return null;

  return (
    <div className="border-border grid gap-2 rounded-md border p-2">
      <div className="text-muted-foreground text-[11px] font-semibold tracking-normal uppercase">
        {labels.motionTemplate}
      </div>
      <label className="text-muted-foreground block space-y-1 text-xs">
        <span>{labels.motionTemplateRecipe}</span>
        <select
          value={templateId}
          onChange={(event) => {
            setTemplateId(event.target.value as VividOverlayMotionTemplateId);
            setApplied(false);
          }}
          className="border-input bg-background text-foreground w-full rounded-md border px-2 py-1.5 text-xs"
        >
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {motionTemplateLabel(labels, template.id)}
            </option>
          ))}
        </select>
      </label>
      <label className="text-muted-foreground block space-y-1 text-xs">
        <span>{labels.motionTemplateStrength}</span>
        <select
          value={strength}
          onChange={(event) => {
            setStrength(
              event.target.value as VividOverlayMotionTemplateStrength,
            );
            setApplied(false);
          }}
          className="border-input bg-background text-foreground w-full rounded-md border px-2 py-1.5 text-xs"
        >
          {STRENGTHS.map((value) => (
            <option key={value} value={value}>
              {labels.motionTemplateStrengths[value]}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="border-input text-muted-foreground hover:text-foreground flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs"
        onClick={() => {
          applyTemplateToClip({
            clip,
            strength,
            templateId: selectedTemplate.id,
            updateClip,
          });
          setApplied(true);
        }}
      >
        {applied ? (
          <Check className="size-3.5" />
        ) : (
          <WandSparkles className="size-3.5" />
        )}
        {applied ? labels.motionTemplateApplied : labels.applyMotionTemplate}
      </button>
    </div>
  );
}

function applyTemplateToClip({
  clip,
  strength,
  templateId,
  updateClip,
}: {
  clip: VideoEffectTimelineClip;
  strength: VividOverlayMotionTemplateStrength;
  templateId: VividOverlayMotionTemplateId;
  updateClip: (patch: Partial<VideoEffectTimelineClip>) => void;
}) {
  const params = parseVividOverlayParams(clip.params);
  if (!params) return;
  const tracks = buildVividOverlayMotionTemplateTracks({
    templateId,
    strength,
    clipDurationMs: clip.durationMs,
    transforms: clip.transforms,
  });
  const affected = new Set(tracks.map((track) => track.property));
  const keyframes: KeyframeTrack[] = [
    ...(clip.keyframes ?? []).filter((track) => !affected.has(track.property)),
    ...tracks,
  ];
  updateClip({
    keyframes,
    params: {
      ...params,
      motionTemplate: {
        source: 'motion-template',
        templateId,
        strength,
        appliedAt: new Date().toISOString(),
        affectedProperties: [...affected],
      },
    },
  });
}

function motionTemplateLabel(
  labels: OverlayLabels,
  templateId: VividOverlayMotionTemplateId,
): string {
  return labels.motionTemplates[templateId] ?? templateId;
}
