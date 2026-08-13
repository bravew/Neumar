import type { VideoSubtitleStyle } from '@/shared/types/video';

import type { ClipInspectorLabels } from './types';

interface Props {
  style: VideoSubtitleStyle;
  labels: ClipInspectorLabels;
  patchStyle: (next: Partial<VideoSubtitleStyle>) => void;
}

export function CaptionShadowSubsection({ style, labels, patchStyle }: Props) {
  return (
    <div className="space-y-2">
      <h5 className="text-foreground text-[10px] font-semibold uppercase">
        {labels.shadow}
      </h5>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-[11px]">
          <span>{labels.shadowColor}</span>
          <input
            type="color"
            value={style.shadowColor ?? '#000000'}
            className="border-input bg-background h-7 w-full rounded-md border px-1"
            onChange={(event) =>
              patchStyle({ shadowColor: event.target.value })
            }
          />
        </label>
        <SliderField
          label={labels.shadowBlur}
          value={style.shadowBlur ?? 0}
          min={0}
          max={64}
          step={1}
          onChange={(v) => patchStyle({ shadowBlur: v })}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <SliderField
          label={labels.shadowOffsetX}
          value={style.shadowOffsetX ?? 0}
          min={-40}
          max={40}
          step={1}
          onChange={(v) => patchStyle({ shadowOffsetX: v })}
        />
        <SliderField
          label={labels.shadowOffsetY}
          value={style.shadowOffsetY ?? 0}
          min={-40}
          max={40}
          step={1}
          onChange={(v) => patchStyle({ shadowOffsetY: v })}
        />
      </div>
    </div>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid gap-1 text-[11px]">
      <span className="flex items-center justify-between">
        <span>{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {value.toFixed(0)}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        className="accent-primary w-full"
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}
