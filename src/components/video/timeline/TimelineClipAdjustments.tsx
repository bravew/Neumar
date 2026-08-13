import { useEffect, useMemo, useRef, useState } from 'react';

import { RotateCcw, SlidersHorizontal } from 'lucide-react';

import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoAudioSeamMode,
  VideoClipFilters,
  VideoTransitionKind,
} from '@/shared/types/video';
import { VIDEO_TRANSITION_REGISTRY } from '@/shared/types/video';

import {
  commonAudioSeamValue,
  commonFilterValue,
  commonTransitionValue,
  findSelectedVisualClips,
  MIXED_CLIP_VALUE,
  selectedTracksAreLocked,
} from './timelineClipAdjustmentState';
import { TimelineIconButton } from './TimelineIconButton';
import { useTimelineEditorStore } from './useTimelineEditorStore';

type FilterKey = keyof VideoClipFilters;

interface FilterControl {
  key: FilterKey;
  min: number;
  max: number;
  step: number;
  neutral: number;
  format: (value: number) => string;
}

const FILTER_CONTROLS: FilterControl[] = [
  {
    key: 'brightness',
    min: 0.25,
    max: 2,
    step: 0.05,
    neutral: 1,
    format: percentValue,
  },
  {
    key: 'contrast',
    min: 0.25,
    max: 2,
    step: 0.05,
    neutral: 1,
    format: percentValue,
  },
  {
    key: 'saturation',
    min: 0,
    max: 2,
    step: 0.05,
    neutral: 1,
    format: percentValue,
  },
  {
    key: 'hueRotateDeg',
    min: -180,
    max: 180,
    step: 1,
    neutral: 0,
    format: (value) => `${Math.round(value)}deg`,
  },
  {
    key: 'blurPx',
    min: 0,
    max: 20,
    step: 0.5,
    neutral: 0,
    format: (value) => `${value.toFixed(1)}px`,
  },
  {
    key: 'grayscale',
    min: 0,
    max: 1,
    step: 0.05,
    neutral: 0,
    format: percentValue,
  },
  {
    key: 'sepia',
    min: 0,
    max: 1,
    step: 0.05,
    neutral: 0,
    format: percentValue,
  },
];

export function TimelineClipAdjustments() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const timeline = useTimelineEditorStore((state) => state.timeline);
  const selectedClipIds = useTimelineEditorStore(
    (state) => state.selectedClipIds,
  );
  const updateTransition = useTimelineEditorStore(
    (state) => state.updateSelectedVisualClipTransition,
  );
  const updateAudioSeam = useTimelineEditorStore(
    (state) => state.updateSelectedVisualClipAudioSeam,
  );
  const updateFilters = useTimelineEditorStore(
    (state) => state.updateSelectedVisualClipFilters,
  );
  const resetFilters = useTimelineEditorStore(
    (state) => state.resetSelectedVisualClipFilters,
  );
  const selected = useMemo(
    () => findSelectedVisualClips(timeline?.tracks ?? [], selectedClipIds),
    [selectedClipIds, timeline?.tracks],
  );

  useEffect(() => {
    if (selected.length === 0) setOpen(false);
  }, [selected.length]);
  useEffect(() => {
    if (!open) return;
    const closeIfOutside = (event: PointerEvent | FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeIfOutside, true);
    document.addEventListener('focusin', closeIfOutside, true);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeIfOutside, true);
      document.removeEventListener('focusin', closeIfOutside, true);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  if (selected.length === 0) return null;
  const disabled = selectedTracksAreLocked(selected);
  const transition = commonTransitionValue(selected);
  const audioSeam = commonAudioSeamValue(selected);
  const filterLabels = t.video.editor.timeline.filterControls;
  const transitionLabels = t.video.storyboard.transitions as Record<
    string,
    string
  >;

  return (
    <div ref={rootRef} className="relative">
      <TimelineIconButton
        label={t.video.editor.timeline.clipAdjustments}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <SlidersHorizontal className="size-3.5" />
      </TimelineIconButton>
      {open ? (
        <div className="bg-popover text-popover-foreground border-border absolute top-full right-0 z-40 mt-2 w-80 rounded-md border p-3 shadow-lg">
          {selected.length > 1 ? (
            <p className="text-muted-foreground mb-3 text-[11px]">
              {t.video.editor.timeline.selectedClipCount.replace(
                '{count}',
                String(selected.length),
              )}
            </p>
          ) : null}
          <label className="grid gap-1 text-[11px] font-medium">
            <span>{t.video.editor.timeline.clipTransition}</span>
            <select
              className="border-input bg-background h-8 rounded-md border px-2 text-xs"
              value={transition.mixed ? MIXED_CLIP_VALUE : transition.value}
              onChange={(event) =>
                updateTransition(
                  event.currentTarget.value as VideoTransitionKind,
                )
              }
            >
              {transition.mixed ? (
                <option value={MIXED_CLIP_VALUE} disabled>
                  {t.video.editor.timeline.mixed}
                </option>
              ) : null}
              {VIDEO_TRANSITION_REGISTRY.map((entry) => (
                <option key={entry.kind} value={entry.kind}>
                  {transitionLabels[transitionLabelId(entry.labelKey)] ??
                    entry.kind}
                  {transitionRenderNote(
                    entry.native,
                    t.video.editor.timeline.remotionOnly,
                    t.video.editor.timeline.ffmpegOnly,
                  )}
                </option>
              ))}
            </select>
          </label>
          {!transition.mixed && transition.value !== 'cut' ? (
            <div className="mt-3 grid gap-1 text-[11px] font-medium">
              <span className="flex items-center justify-between">
                <span>{t.video.editor.timeline.audioSeam}</span>
                {audioSeam.mixed ? (
                  <span className="text-muted-foreground">
                    {t.video.editor.timeline.mixed}
                  </span>
                ) : null}
              </span>
              <div className="bg-muted grid grid-cols-2 gap-1 rounded-md p-1">
                {(['follow', 'cut'] satisfies VideoAudioSeamMode[]).map(
                  (mode) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={
                        !audioSeam.mixed && audioSeam.value === mode
                      }
                      className={
                        !audioSeam.mixed && audioSeam.value === mode
                          ? 'bg-background text-foreground h-7 rounded px-2 text-[11px] shadow-sm'
                          : 'text-muted-foreground hover:text-foreground h-7 rounded px-2 text-[11px]'
                      }
                      onClick={() => updateAudioSeam(mode)}
                    >
                      {mode === 'follow'
                        ? t.video.editor.timeline.audioSeamFollow
                        : t.video.editor.timeline.audioSeamCut}
                    </button>
                  ),
                )}
              </div>
            </div>
          ) : null}
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs font-semibold">
              {t.video.editor.timeline.filters}
            </span>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[11px]"
              onClick={resetFilters}
            >
              <RotateCcw className="size-3" />
              {t.video.editor.timeline.resetFilters}
            </button>
          </div>
          <div className="mt-2 grid gap-2">
            {FILTER_CONTROLS.map((control) => {
              const filter = commonFilterValue(
                selected,
                control.key,
                control.neutral,
              );
              const value = filter.mixed ? control.neutral : filter.value;
              return (
                <label key={control.key} className="grid gap-1 text-[11px]">
                  <span className="flex items-center justify-between">
                    <span>{filterLabels[control.key]}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {filter.mixed
                        ? t.video.editor.timeline.mixed
                        : control.format(value)}
                    </span>
                  </span>
                  <input
                    type="range"
                    min={control.min}
                    max={control.max}
                    step={control.step}
                    value={value}
                    className="accent-primary w-full"
                    onChange={(event) =>
                      updateFilters({
                        [control.key]: Number(event.currentTarget.value),
                      })
                    }
                  />
                </label>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function percentValue(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function transitionLabelId(labelKey: `transitions.${string}`): string {
  return labelKey.slice('transitions.'.length);
}

function supportsFfmpeg(native: readonly string[]): boolean {
  return native.some((path) => path === 'ffmpeg');
}

function supportsRemotion(native: readonly string[]): boolean {
  return native.some((path) => path === 'remotion');
}

function transitionRenderNote(
  native: readonly string[],
  remotionOnly: string,
  ffmpegOnly: string,
): string {
  if (!supportsFfmpeg(native)) return ` (${remotionOnly})`;
  if (!supportsRemotion(native)) return ` (${ffmpegOnly})`;
  return '';
}
