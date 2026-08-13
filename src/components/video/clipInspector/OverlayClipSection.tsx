import { useState } from 'react';

import {
  parseVividOverlayParams,
  type VividOverlayControlDef,
  type VividOverlayControlValue,
  type VividOverlayLoopMode,
  type VividOverlayParams,
  type VividOverlayStyleTransform,
  type VividOverlayTasteMetadata,
} from '@neumar/video-ir';
import { BookmarkPlus, Check } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoEffectTimelineClip } from '@/shared/types/video';
import { resolveVividOverlay } from '@/shared/video/overlays/registry';

import { useUserOverlayPresets } from '../overlays/useUserOverlayPresets';
import { useUserOverlayStyles } from '../overlays/useUserOverlayStyles';
import { OverlayMotionTemplateSection } from './OverlayMotionTemplateSection';

// Inspector section for vivid overlay (effect) clips: preset identity,
// capability badge, loop mode, and the preset's typed controls rendered as
// form fields. Control edits merge into params.controls via updateClip.

const LOOP_MODES: VividOverlayLoopMode[] = ['hold', 'loop', 'none'];

export function OverlayClipSection({
  clip,
  updateClip,
}: {
  clip: VideoEffectTimelineClip;
  updateClip: (patch: Partial<VideoEffectTimelineClip>) => void;
}) {
  const { t } = useLanguage();
  const labels = t.video.editor.clipInspector.overlay;
  const overlayText = t.video.editor.overlays as Record<string, string>;
  const params = parseVividOverlayParams(clip.params);
  const resolved = params ? resolveVividOverlay(params) : null;

  if (!params || !resolved) {
    return <p className="text-muted-foreground text-xs">{labels.unknown}</p>;
  }

  const patchParams = (next: Partial<VividOverlayParams>) => {
    updateClip({ params: { ...params, ...next } });
  };
  const setControl = (id: string, value: VividOverlayControlValue) => {
    patchParams({ controls: { ...params.controls, [id]: value } });
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-foreground truncate text-xs font-semibold">
            {overlayLabel(resolved.preset.labelKey, overlayText)}
          </div>
          <div className="text-muted-foreground text-[10px] uppercase">
            {resolved.preset.backend}
          </div>
        </div>
        {resolved.preset.capability === 'remotion-only' ? (
          <span className="rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-[10px] leading-none text-amber-700 dark:text-amber-300">
            {labels.remotionOnly}
          </span>
        ) : null}
      </div>

      {resolved.preset.requiresSourceAsset && !params.sourceAssetId ? (
        <p className="text-muted-foreground border-border rounded-md border border-dashed p-2 text-[11px]">
          {labels.needsAsset}
        </p>
      ) : null}

      <label className="text-muted-foreground block space-y-1 text-xs">
        <span>{labels.loop}</span>
        <select
          value={params.loop ?? 'hold'}
          onChange={(event) =>
            patchParams({ loop: event.target.value as VividOverlayLoopMode })
          }
          className="border-input bg-background text-foreground w-full rounded-md border px-2 py-1.5 text-xs"
        >
          {LOOP_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {labels.loopModes[mode]}
            </option>
          ))}
        </select>
      </label>

      {resolved.preset.controls.map((control) => (
        <OverlayControlField
          key={control.id}
          control={control}
          value={resolved.controls[control.id] ?? control.defaultValue}
          overlayText={overlayText}
          onChange={(value) => setControl(control.id, value)}
        />
      ))}

      <OverlayMotionTemplateSection
        category={resolved.preset.category}
        clip={clip}
        updateClip={updateClip}
      />

      {resolved.errors.length > 0 ? (
        <p className="text-destructive text-[11px]">{labels.invalidControls}</p>
      ) : null}

      {!resolved.preset.requiresSourceAsset ? (
        <div className="grid gap-2">
          <SaveToLibraryButton
            presetLabel={overlayLabel(resolved.preset.labelKey, overlayText)}
            basePresetId={resolved.preset.id}
            controls={resolved.controls}
            loop={params.loop}
          />
          <SaveStyleButton
            clip={clip}
            presetLabel={overlayLabel(resolved.preset.labelKey, overlayText)}
            basePresetId={resolved.preset.id}
            controls={resolved.controls}
            loop={params.loop}
            tags={[
              resolved.preset.category,
              resolved.preset.backend,
              ...(resolved.preset.tags ?? []),
            ]}
            taste={resolved.preset.taste}
          />
        </div>
      ) : null}
    </section>
  );
}

function SaveToLibraryButton({
  basePresetId,
  controls,
  loop,
  presetLabel,
}: {
  basePresetId: string;
  controls: Record<string, VividOverlayControlValue>;
  loop?: VividOverlayLoopMode;
  presetLabel: string;
}) {
  const { t } = useLanguage();
  const labels = t.video.editor.clipInspector.overlay;
  const { save } = useUserOverlayPresets();
  const [state, setState] = useState<'idle' | 'saved' | 'failed'>('idle');
  return (
    <button
      type="button"
      className="border-input text-muted-foreground hover:text-foreground flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs"
      onClick={async () => {
        const ok = await save({
          name: presetLabel,
          basePresetId,
          controls,
          ...(loop ? { loop } : {}),
        });
        setState(ok ? 'saved' : 'failed');
      }}
    >
      {state === 'saved' ? (
        <Check className="size-3.5" />
      ) : (
        <BookmarkPlus className="size-3.5" />
      )}
      {state === 'saved'
        ? labels.savedToLibrary
        : state === 'failed'
          ? labels.saveToLibraryFailed
          : labels.saveToLibrary}
    </button>
  );
}

function SaveStyleButton({
  basePresetId,
  clip,
  controls,
  loop,
  presetLabel,
  tags,
  taste,
}: {
  basePresetId: string;
  clip: VideoEffectTimelineClip;
  controls: Record<string, VividOverlayControlValue>;
  loop?: VividOverlayLoopMode;
  presetLabel: string;
  tags: string[];
  taste?: VividOverlayTasteMetadata;
}) {
  const { t } = useLanguage();
  const labels = t.video.editor.clipInspector.overlay;
  const { save } = useUserOverlayStyles();
  const [state, setState] = useState<'idle' | 'saved' | 'failed'>('idle');
  return (
    <button
      type="button"
      className="border-input text-muted-foreground hover:text-foreground flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs"
      onClick={async () => {
        const transform = styleTransformFromClip(clip);
        const ok = await save({
          name: clip.name ?? presetLabel,
          basePresetId,
          controls,
          ...(loop ? { loop } : {}),
          ...(transform ? { transform } : {}),
          ...(clip.keyframes ? { keyframes: clip.keyframes } : {}),
          tags,
          ...(taste ? { taste } : {}),
          provenance: { kind: 'saved-from-timeline', sourceId: clip.id },
        });
        setState(ok ? 'saved' : 'failed');
      }}
    >
      {state === 'saved' ? (
        <Check className="size-3.5" />
      ) : (
        <BookmarkPlus className="size-3.5" />
      )}
      {state === 'saved'
        ? labels.savedStyle
        : state === 'failed'
          ? labels.saveStyleFailed
          : labels.saveStyle}
    </button>
  );
}

function styleTransformFromClip(
  clip: VideoEffectTimelineClip,
): VividOverlayStyleTransform | undefined {
  if (!clip.transforms) return undefined;
  const out: VividOverlayStyleTransform = {};
  for (const field of [
    'scale',
    'scaleX',
    'scaleY',
    'positionX',
    'positionY',
    'opacity',
    'rotation',
  ] as const) {
    const value = clip.transforms[field];
    if (typeof value === 'number' && Number.isFinite(value)) out[field] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function OverlayControlField({
  control,
  onChange,
  overlayText,
  value,
}: {
  control: VividOverlayControlDef;
  onChange: (value: VividOverlayControlValue) => void;
  overlayText: Record<string, string>;
  value: VividOverlayControlValue;
}) {
  const label = overlayLabel(control.labelKey, overlayText);
  const inputClass =
    'border-input bg-background text-foreground w-full rounded-md border px-2 py-1.5 text-xs';
  if (control.type === 'toggle') {
    return (
      <label className="text-muted-foreground flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{label}</span>
      </label>
    );
  }
  return (
    <label className="text-muted-foreground block space-y-1 text-xs">
      <span>{label}</span>
      {control.type === 'select' ? (
        <select
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
          className={inputClass}
        >
          {(control.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : control.type === 'number' ? (
        <input
          type="number"
          value={Number(value)}
          min={control.min}
          max={control.max}
          step={control.step}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onChange(next);
          }}
          className={inputClass}
        />
      ) : control.type === 'color' ? (
        <input
          type="color"
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
          className="border-input bg-background h-8 w-full rounded-md border px-1"
        />
      ) : (
        <input
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
          className={inputClass}
        />
      )}
    </label>
  );
}

function overlayLabel(
  labelKey: string,
  labels: Record<string, string>,
): string {
  const key = labelKey.replace('overlays.', '');
  return labels[key] ?? key;
}
