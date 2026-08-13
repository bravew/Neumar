import type {
  VideoAudioFadeCurve,
  VideoAudioTimelineClip,
} from '@/shared/types/video';

import type { ClipInspectorLabels } from './types';

const AUDIO_FADE_CURVES: VideoAudioFadeCurve[] = [
  'linear',
  'equal-power',
  'ease-in-out',
];

export function AudioClipSections({
  clip,
  labels,
  onFadeChange,
  onGainChange,
  onMuteChange,
  updateTranscript,
}: {
  clip: VideoAudioTimelineClip;
  labels: ClipInspectorLabels;
  onFadeChange: (
    edge: 'in' | 'out',
    durationMs: number,
    curve: VideoAudioFadeCurve,
  ) => void;
  onGainChange: (gainDb: number) => void;
  onMuteChange: (muted: boolean) => void;
  updateTranscript: (transcriptText: string) => void;
}) {
  const fadeInCurve = clip.fadeInCurve ?? 'linear';
  const fadeOutCurve = clip.fadeOutCurve ?? 'linear';

  return (
    <section className="space-y-3">
      <h4 className="text-foreground text-[11px] font-semibold uppercase">
        {labels.sections.audio}
      </h4>
      <label className="flex items-center gap-2 text-[11px]">
        <input
          type="checkbox"
          checked={clip.muted === true}
          className="accent-primary size-3.5"
          onChange={(event) => onMuteChange(event.currentTarget.checked)}
        />
        <span>{labels.muted}</span>
      </label>
      <label className="grid gap-1 text-[11px]">
        <span className="flex items-center justify-between">
          <span>{labels.gain}</span>
          <span className="text-muted-foreground tabular-nums">
            {(clip.gainDb ?? 0).toFixed(1)} dB
          </span>
        </span>
        <input
          type="range"
          min={-30}
          max={12}
          step={0.5}
          value={clip.gainDb ?? 0}
          className="accent-primary w-full"
          onChange={(event) => onGainChange(Number(event.currentTarget.value))}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-[11px]">
          <span>{labels.fadeIn}</span>
          <input
            type="number"
            min={0}
            step={50}
            value={clip.fadeInMs ?? 0}
            className="border-input bg-background rounded-md border px-2 py-1 text-xs"
            onChange={(event) =>
              onFadeChange(
                'in',
                Math.max(0, Number(event.currentTarget.value)),
                fadeInCurve,
              )
            }
          />
        </label>
        <label className="grid gap-1 text-[11px]">
          <span>{labels.fadeOut}</span>
          <input
            type="number"
            min={0}
            step={50}
            value={clip.fadeOutMs ?? 0}
            className="border-input bg-background rounded-md border px-2 py-1 text-xs"
            onChange={(event) =>
              onFadeChange(
                'out',
                Math.max(0, Number(event.currentTarget.value)),
                fadeOutCurve,
              )
            }
          />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-[11px]">
          <span>{labels.fadeInCurve}</span>
          <select
            className="border-input bg-background rounded-md border px-2 py-1 text-xs"
            value={fadeInCurve}
            onChange={(event) =>
              onFadeChange(
                'in',
                clip.fadeInMs ?? 0,
                event.currentTarget.value as VideoAudioFadeCurve,
              )
            }
          >
            {AUDIO_FADE_CURVES.map((curve) => (
              <option key={curve} value={curve}>
                {labels.fadeCurveValues[curve]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-[11px]">
          <span>{labels.fadeOutCurve}</span>
          <select
            className="border-input bg-background rounded-md border px-2 py-1 text-xs"
            value={fadeOutCurve}
            onChange={(event) =>
              onFadeChange(
                'out',
                clip.fadeOutMs ?? 0,
                event.currentTarget.value as VideoAudioFadeCurve,
              )
            }
          >
            {AUDIO_FADE_CURVES.map((curve) => (
              <option key={curve} value={curve}>
                {labels.fadeCurveValues[curve]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="grid gap-1 text-[11px]">
        <span>{labels.transcript}</span>
        <textarea
          rows={3}
          defaultValue={clip.transcriptText ?? ''}
          className="border-input bg-background text-foreground rounded-md border px-2 py-1.5 text-xs"
          onBlur={(event) => updateTranscript(event.currentTarget.value)}
        />
      </label>
    </section>
  );
}
