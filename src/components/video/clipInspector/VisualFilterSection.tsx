import type {
  VideoClipFilters,
  VideoVisualTimelineClip,
} from '@/shared/types/video';

import type { ClipInspectorLabels } from './types';
import { percent } from './types';

interface FilterControl {
  key: keyof VideoClipFilters;
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
    format: percent,
  },
  {
    key: 'contrast',
    min: 0.25,
    max: 2,
    step: 0.05,
    neutral: 1,
    format: percent,
  },
  {
    key: 'saturation',
    min: 0,
    max: 2,
    step: 0.05,
    neutral: 1,
    format: percent,
  },
  {
    key: 'hueRotateDeg',
    min: -180,
    max: 180,
    step: 1,
    neutral: 0,
    format: (v) => `${Math.round(v)}deg`,
  },
  {
    key: 'blurPx',
    min: 0,
    max: 20,
    step: 0.5,
    neutral: 0,
    format: (v) => `${v.toFixed(1)}px`,
  },
  { key: 'grayscale', min: 0, max: 1, step: 0.05, neutral: 0, format: percent },
  { key: 'sepia', min: 0, max: 1, step: 0.05, neutral: 0, format: percent },
];

interface Props {
  clip: VideoVisualTimelineClip;
  labels: ClipInspectorLabels;
  filterLabels: Record<string, string>;
  updateFilters: (patch: Partial<VideoClipFilters>) => void;
}

export function VisualFilterSection({
  clip,
  labels,
  filterLabels,
  updateFilters,
}: Props) {
  const filters = clip.filters ?? {};
  return (
    <section className="space-y-2">
      <h4 className="text-foreground text-[11px] font-semibold uppercase">
        {labels.sections.filters}
      </h4>
      <div className="space-y-2">
        {FILTER_CONTROLS.map((control) => {
          const raw = filters[control.key];
          const value = typeof raw === 'number' ? raw : control.neutral;
          return (
            <label key={control.key} className="grid gap-1 text-[11px]">
              <span className="flex items-center justify-between">
                <span>{filterLabels[control.key] ?? control.key}</span>
                <span className="text-muted-foreground tabular-nums">
                  {control.format(value)}
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
    </section>
  );
}
