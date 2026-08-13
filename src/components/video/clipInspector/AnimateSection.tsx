import type {
  VideoCaptionTimelineClip,
  VideoVisualTimelineClip,
} from '@/shared/types/video';

import type { ClipInspectorLabels } from './types';

type AnimatableClip = VideoVisualTimelineClip | VideoCaptionTimelineClip;

interface Props {
  clip: AnimatableClip;
  labels: ClipInspectorLabels;
  updateClip: (patch: Partial<AnimatableClip>) => void;
}

/**
 * Per-clip entrance / exit fade. The Remotion preview and full renderer both
 * apply an opacity ramp using these values; FFmpeg overlay tracks also honor
 * them via fade=t=in / fade=t=out. Clamped at render time so the two ramps
 * never overlap.
 */
export function AnimateSection({ clip, labels, updateClip }: Props) {
  const entranceMs = clip.entranceMs ?? 0;
  const exitMs = clip.exitMs ?? 0;
  return (
    <section className="space-y-3">
      <h4 className="text-foreground text-[11px] font-semibold uppercase">
        {labels.sections.animate}
      </h4>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-[11px]">
          <span className="flex items-center justify-between">
            <span>{labels.entrance}</span>
            <span className="text-muted-foreground tabular-nums">
              {entranceMs} ms
            </span>
          </span>
          <input
            type="range"
            min={0}
            max={Math.min(2000, clip.durationMs)}
            step={50}
            value={entranceMs}
            className="accent-primary w-full"
            onChange={(event) =>
              updateClip({
                entranceMs: Math.max(0, Number(event.currentTarget.value)),
              } as Partial<AnimatableClip>)
            }
          />
        </label>
        <label className="grid gap-1 text-[11px]">
          <span className="flex items-center justify-between">
            <span>{labels.exit}</span>
            <span className="text-muted-foreground tabular-nums">
              {exitMs} ms
            </span>
          </span>
          <input
            type="range"
            min={0}
            max={Math.min(2000, clip.durationMs)}
            step={50}
            value={exitMs}
            className="accent-primary w-full"
            onChange={(event) =>
              updateClip({
                exitMs: Math.max(0, Number(event.currentTarget.value)),
              } as Partial<AnimatableClip>)
            }
          />
        </label>
      </div>
      <p className="text-muted-foreground text-[10px]">{labels.animateHint}</p>
    </section>
  );
}
