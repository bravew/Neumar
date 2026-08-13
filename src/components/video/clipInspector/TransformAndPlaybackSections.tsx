import { normalizeClipPlayback } from '@neumar/video-ir';
import {
  FlipHorizontal,
  FlipVertical,
  RotateCcw,
  RotateCw,
} from 'lucide-react';

import type {
  VideoAspectRatio,
  VideoClipTransform,
  VideoVisualTimelineClip,
} from '@/shared/types/video';

import type { SourceFrameSize } from './frameControls';
import { FrameControlsSection } from './FrameControlsSection';
import type { ClipInspectorLabels } from './types';
import { percent } from './types';

type TransformScalarKey = Exclude<
  keyof VideoClipTransform,
  'background' | 'crop' | 'fit'
>;

interface TransformControl {
  key: TransformScalarKey;
  min: number;
  max: number;
  step: number;
  neutral: number;
  format: (value: number) => string;
}

const TRANSFORM_CONTROLS: TransformControl[] = [
  {
    key: 'positionX',
    min: -0.5,
    max: 1.5,
    step: 0.01,
    neutral: 0.5,
    format: percent,
  },
  {
    key: 'positionY',
    min: -0.5,
    max: 1.5,
    step: 0.01,
    neutral: 0.5,
    format: percent,
  },
  { key: 'scale', min: 0.1, max: 4, step: 0.01, neutral: 1, format: percent },
  { key: 'scaleX', min: 0.1, max: 4, step: 0.01, neutral: 1, format: percent },
  { key: 'scaleY', min: 0.1, max: 4, step: 0.01, neutral: 1, format: percent },
  {
    key: 'rotation',
    min: -180,
    max: 180,
    step: 1,
    neutral: 0,
    format: (v) => `${Math.round(v)}deg`,
  },
  { key: 'opacity', min: 0, max: 1, step: 0.01, neutral: 1, format: percent },
];

interface Props {
  clip: VideoVisualTimelineClip;
  aspectRatio: VideoAspectRatio;
  labels: ClipInspectorLabels;
  sourceFrame?: SourceFrameSize;
  updateClip: (patch: Partial<VideoVisualTimelineClip>) => void;
  setPlaybackSpeed: (speed: number) => void;
  setPlaybackReverse: (reverse: boolean) => void;
  rotateClips: (degrees: number, options?: { relative?: boolean }) => void;
  flipClips: (axis: 'horizontal' | 'vertical') => void;
  setTransform: (
    transform: VideoClipTransform,
    options?: { merge?: boolean },
  ) => void;
}

export function TransformAndPlaybackSections({
  clip,
  aspectRatio,
  labels,
  sourceFrame,
  updateClip,
  setPlaybackSpeed,
  setPlaybackReverse,
  rotateClips,
  flipClips,
  setTransform,
}: Props) {
  const transforms = clip.transforms ?? {};
  const playback = normalizeClipPlayback(clip.playback, clip.params);
  const patchTransforms = (next: Partial<VideoClipTransform>) =>
    setTransform(next);
  return (
    <>
      <FrameControlsSection
        aspectRatio={aspectRatio}
        labels={labels}
        sourceFrame={sourceFrame}
        transforms={transforms}
        patchTransforms={patchTransforms}
      />

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-foreground text-[11px] font-semibold uppercase">
            {labels.sections.transform}
          </h4>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[11px]"
            onClick={() => setTransform({}, { merge: false })}
          >
            <RotateCcw className="size-3" />
            {labels.resetTransform}
          </button>
        </div>
        <div className="grid grid-cols-4 gap-1">
          <IconActionButton
            label={labels.rotateLeft}
            onClick={() => rotateClips(-90, { relative: true })}
            icon={<RotateCcw className="size-3.5" />}
          />
          <IconActionButton
            label={labels.rotateRight}
            onClick={() => rotateClips(90, { relative: true })}
            icon={<RotateCw className="size-3.5" />}
          />
          <IconActionButton
            label={labels.flipHorizontal}
            onClick={() => flipClips('horizontal')}
            icon={<FlipHorizontal className="size-3.5" />}
          />
          <IconActionButton
            label={labels.flipVertical}
            onClick={() => flipClips('vertical')}
            icon={<FlipVertical className="size-3.5" />}
          />
        </div>
        <div className="space-y-2">
          {TRANSFORM_CONTROLS.map((control) => {
            const raw = transforms[control.key];
            const value = typeof raw === 'number' ? raw : control.neutral;
            return (
              <label key={control.key} className="grid gap-1 text-[11px]">
                <span className="flex items-center justify-between">
                  <span>{labels.transformControls[control.key]}</span>
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
                  aria-label={labels.transformControls[control.key]}
                  aria-valuetext={control.format(value)}
                  onChange={(event) =>
                    patchTransforms({
                      [control.key]: Number(event.currentTarget.value),
                    })
                  }
                />
              </label>
            );
          })}
        </div>
      </section>

      <section className="space-y-2">
        <h4 className="text-foreground text-[11px] font-semibold uppercase">
          {labels.sections.playback}
        </h4>
        <label className="grid gap-1 text-[11px]">
          <span className="flex items-center justify-between">
            <span>{labels.playbackSpeed}</span>
            <span className="text-muted-foreground tabular-nums">
              {playback.speed.toFixed(2)}x
            </span>
          </span>
          <input
            type="range"
            min={0.25}
            max={4}
            step={0.05}
            value={playback.speed}
            className="accent-primary w-full"
            onChange={(event) =>
              setPlaybackSpeed(Number(event.currentTarget.value))
            }
          />
        </label>
        <label className="text-foreground flex items-center justify-between text-[11px]">
          <span>{labels.reversePlayback}</span>
          <input
            type="checkbox"
            checked={playback.reverse}
            onChange={(event) => setPlaybackReverse(event.target.checked)}
          />
        </label>
        <label className="text-foreground flex items-center justify-between text-[11px]">
          <span>{labels.muted}</span>
          <input
            type="checkbox"
            checked={clip.muted ?? false}
            onChange={(event) => updateClip({ muted: event.target.checked })}
          />
        </label>
      </section>
    </>
  );
}

function IconActionButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="border-border text-muted-foreground hover:text-foreground hover:bg-muted/60 flex h-8 items-center justify-center rounded-md border"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}
