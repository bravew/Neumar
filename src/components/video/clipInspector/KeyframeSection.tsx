import { useMemo, useState } from 'react';

import type {
  Keyframe,
  KeyframeInterpolation,
  KeyframeTrack,
  KeyframeableProperty,
} from '@neumar/video-ir';
import { KeyRound, Plus, Trash2 } from 'lucide-react';

import type {
  VideoAudioTimelineClip,
  VideoCaptionTimelineClip,
  VideoVisualTimelineClip,
} from '@/shared/types/video';

import type { ClipInspectorLabels } from './types';

type AnimatableClip =
  | VideoVisualTimelineClip
  | VideoAudioTimelineClip
  | VideoCaptionTimelineClip;

interface KeyframeSectionProps {
  clip: AnimatableClip;
  labels: ClipInspectorLabels;
  playheadMs: number;
  updateClip: (patch: Partial<AnimatableClip>) => void;
}

const INTERPOLATIONS: KeyframeInterpolation[] = ['linear', 'smooth', 'hold'];

const PROPERTY_BOUNDS: Record<
  KeyframeableProperty,
  { min: number; max: number; step: number }
> = {
  opacity: { min: 0, max: 1, step: 0.05 },
  scale: { min: 0.01, max: 20, step: 0.05 },
  scaleX: { min: 0.01, max: 20, step: 0.05 },
  scaleY: { min: 0.01, max: 20, step: 0.05 },
  positionX: { min: -10, max: 10, step: 0.01 },
  positionY: { min: -10, max: 10, step: 0.01 },
  rotation: { min: -36000, max: 36000, step: 1 },
  cropTop: { min: 0, max: 1, step: 0.01 },
  cropRight: { min: 0, max: 1, step: 0.01 },
  cropBottom: { min: 0, max: 1, step: 0.01 },
  cropLeft: { min: 0, max: 1, step: 0.01 },
  volumeDb: { min: -96, max: 24, step: 0.5 },
  textOpacity: { min: 0, max: 1, step: 0.05 },
  textScale: { min: 0.01, max: 20, step: 0.05 },
};

export function KeyframeSection({
  clip,
  labels,
  playheadMs,
  updateClip,
}: KeyframeSectionProps) {
  const properties = useMemo(() => propertiesForClip(clip), [clip]);
  const [selectedProperty, setSelectedProperty] = useState(
    () => properties[0] ?? 'opacity',
  );
  const property = properties.includes(selectedProperty)
    ? selectedProperty
    : properties[0]!;
  const track =
    clip.keyframes?.find((candidate) => candidate.property === property) ??
    null;
  const localPlayheadMs = clamp(
    Math.round(playheadMs - clip.startMs),
    0,
    clip.durationMs,
  );

  const setTrack = (nextTrack: KeyframeTrack | null) => {
    const remaining =
      clip.keyframes?.filter((candidate) => candidate.property !== property) ??
      [];
    const keyframes = nextTrack ? [...remaining, nextTrack] : remaining;
    updateClip({ keyframes: keyframes.length > 0 ? keyframes : undefined });
  };
  const upsertKey = (key: Keyframe) => {
    const keys = [...(track?.keys ?? [])].filter(
      (candidate) => candidate.atMs !== key.atMs,
    );
    keys.push(key);
    setTrack({ property, keys: keys.sort((a, b) => a.atMs - b.atMs) });
  };
  const updateKey = (atMs: number, patch: Partial<Keyframe>) => {
    if (!track) return;
    const current = track.keys.find((key) => key.atMs === atMs);
    if (!current) return;
    const edited = normalizeKey({ ...current, ...patch });
    const keys = track.keys
      .filter((key) => key.atMs !== atMs && key.atMs !== edited.atMs)
      .concat(edited)
      .sort((a, b) => a.atMs - b.atMs);
    setTrack({ property, keys });
  };
  const removeKey = (atMs: number) => {
    if (!track) return;
    const keys = track.keys.filter((key) => key.atMs !== atMs);
    setTrack(keys.length > 0 ? { property, keys } : null);
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-foreground flex items-center gap-1 text-[11px] font-semibold uppercase">
          <KeyRound className="size-3" />
          <span>{labels.keyframes}</span>
        </h4>
        <button
          type="button"
          className="border-input hover:bg-accent inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px]"
          onClick={() =>
            upsertKey({
              atMs: localPlayheadMs,
              value: staticValue(clip, property),
              interp: 'linear',
            })
          }
        >
          <Plus className="size-3" />
          <span>{labels.keyframeAddAtPlayhead}</span>
        </button>
      </div>
      <label className="grid gap-1 text-[11px]">
        <span>{labels.keyframeProperty}</span>
        <select
          className="border-input bg-background rounded-md border px-2 py-1"
          value={property}
          onChange={(event) =>
            setSelectedProperty(
              event.currentTarget.value as KeyframeableProperty,
            )
          }
        >
          {properties.map((item) => (
            <option key={item} value={item}>
              {labels.keyframeProperties[item]}
            </option>
          ))}
        </select>
      </label>
      {(track?.keys.length ?? 0) === 0 ? (
        <p className="text-muted-foreground text-[10px]">
          {labels.keyframeEmpty}
        </p>
      ) : (
        <div className="space-y-2">
          {track!.keys.map((key) => (
            <KeyframeRow
              key={`${property}-${key.atMs}`}
              interpolationLabels={labels.keyframeInterpolationValues}
              keyframe={key}
              labels={labels}
              property={property}
              onRemove={() => removeKey(key.atMs)}
              onUpdate={(patch) => updateKey(key.atMs, patch)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function KeyframeRow({
  interpolationLabels,
  keyframe,
  labels,
  onRemove,
  onUpdate,
  property,
}: {
  interpolationLabels: ClipInspectorLabels['keyframeInterpolationValues'];
  keyframe: Keyframe;
  labels: ClipInspectorLabels;
  onRemove: () => void;
  onUpdate: (patch: Partial<Keyframe>) => void;
  property: KeyframeableProperty;
}) {
  const bounds = PROPERTY_BOUNDS[property];
  return (
    <div className="border-border grid grid-cols-[1fr_1fr_1fr_auto] gap-1 rounded-md border p-1.5">
      <label className="grid gap-0.5 text-[10px]">
        <span>{labels.keyframeTime}</span>
        <input
          type="number"
          min={0}
          value={keyframe.atMs}
          className="border-input bg-background rounded border px-1 py-0.5"
          onChange={(event) =>
            onUpdate({
              atMs: Math.max(0, Math.round(Number(event.currentTarget.value))),
            })
          }
        />
      </label>
      <label className="grid gap-0.5 text-[10px]">
        <span>{labels.keyframeValue}</span>
        <input
          type="number"
          min={bounds.min}
          max={bounds.max}
          step={bounds.step}
          value={keyframe.value}
          className="border-input bg-background rounded border px-1 py-0.5"
          onChange={(event) =>
            onUpdate({
              value: clamp(
                Number(event.currentTarget.value),
                bounds.min,
                bounds.max,
              ),
            })
          }
        />
      </label>
      <label className="grid gap-0.5 text-[10px]">
        <span>{labels.keyframeInterpolation}</span>
        <select
          className="border-input bg-background rounded border px-1 py-0.5"
          value={keyframe.interp ?? 'linear'}
          onChange={(event) =>
            onUpdate({
              interp: event.currentTarget.value as KeyframeInterpolation,
            })
          }
        >
          {INTERPOLATIONS.map((item) => (
            <option key={item} value={item}>
              {interpolationLabels[item]}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="text-muted-foreground hover:text-destructive self-end p-1"
        aria-label={labels.keyframeDelete}
        onClick={onRemove}
      >
        <Trash2 className="size-3" />
      </button>
    </div>
  );
}

function propertiesForClip(clip: AnimatableClip): KeyframeableProperty[] {
  if (clip.kind === 'audio') return ['volumeDb'];
  if (clip.kind === 'caption') return ['textOpacity', 'textScale'];
  return [
    'opacity',
    'scale',
    'scaleX',
    'scaleY',
    'positionX',
    'positionY',
    'rotation',
    'cropTop',
    'cropRight',
    'cropBottom',
    'cropLeft',
  ];
}

function staticValue(
  clip: AnimatableClip,
  property: KeyframeableProperty,
): number {
  const transform =
    clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'overlay'
      ? clip.transforms
      : undefined;
  switch (property) {
    case 'opacity':
      return transform?.opacity ?? 1;
    case 'scale':
      return transform?.scale ?? 1;
    case 'scaleX':
      return transform?.scaleX ?? transform?.scale ?? 1;
    case 'scaleY':
      return transform?.scaleY ?? transform?.scale ?? 1;
    case 'positionX':
      return transform?.positionX ?? 0.5;
    case 'positionY':
      return transform?.positionY ?? 0.5;
    case 'rotation':
      return transform?.rotation ?? 0;
    case 'cropTop':
      return transform?.crop?.top ?? 0;
    case 'cropRight':
      return transform?.crop?.right ?? 0;
    case 'cropBottom':
      return transform?.crop?.bottom ?? 0;
    case 'cropLeft':
      return transform?.crop?.left ?? 0;
    case 'volumeDb':
      return clip.kind === 'audio' ? (clip.gainDb ?? 0) : 0;
    case 'textOpacity':
    case 'textScale':
      return 1;
    default: {
      const exhaustive: never = property;
      return exhaustive;
    }
  }
}

function normalizeKey(key: Keyframe): Keyframe {
  return {
    atMs: Math.max(0, Math.round(key.atMs)),
    value: key.value,
    interp: key.interp ?? 'linear',
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
