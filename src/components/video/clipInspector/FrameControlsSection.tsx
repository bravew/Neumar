import type { ReactNode } from 'react';

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Crosshair,
  Maximize2,
  Minimize2,
} from 'lucide-react';

import type {
  VideoAspectRatio,
  VideoClipTransform,
} from '@/shared/types/video';

import {
  containFrameTransform,
  centeredFrameTransform,
  fillFrameTransform,
  FRAME_FOCUS_POINTS,
  nudgeFrameTransform,
  type SourceFrameSize,
} from './frameControls';
import type { ClipInspectorLabels } from './types';

interface FrameControlsSectionProps {
  aspectRatio: VideoAspectRatio;
  labels: ClipInspectorLabels;
  sourceFrame?: SourceFrameSize;
  transforms: VideoClipTransform;
  patchTransforms: (next: Partial<VideoClipTransform>) => void;
}

export function FrameControlsSection({
  aspectRatio,
  labels,
  sourceFrame,
  transforms,
  patchTransforms,
}: FrameControlsSectionProps) {
  const hasSourceDimensions = Boolean(sourceFrame?.width && sourceFrame.height);
  return (
    <section className="space-y-2">
      <h4 className="text-foreground text-[11px] font-semibold uppercase">
        {labels.sections.frame}
      </h4>
      <div className="grid grid-cols-3 gap-1">
        <FrameButton
          label={labels.frameFill}
          icon={<Maximize2 className="size-3" />}
          onClick={() =>
            patchTransforms(fillFrameTransform(sourceFrame, aspectRatio))
          }
        />
        <FrameButton
          label={labels.frameContain}
          icon={<Minimize2 className="size-3" />}
          onClick={() => patchTransforms(containFrameTransform())}
        />
        <FrameButton
          label={labels.frameCenter}
          icon={<Crosshair className="size-3" />}
          onClick={() => patchTransforms(centeredFrameTransform())}
        />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
        <FocusGrid
          aspectRatio={aspectRatio}
          labels={labels}
          sourceFrame={sourceFrame}
          transforms={transforms}
          hasSourceDimensions={hasSourceDimensions}
          patchTransforms={patchTransforms}
        />
        <NudgeGrid
          aspectRatio={aspectRatio}
          labels={labels}
          sourceFrame={sourceFrame}
          transforms={transforms}
          patchTransforms={patchTransforms}
        />
      </div>
    </section>
  );
}

function FocusGrid({
  aspectRatio,
  labels,
  sourceFrame,
  transforms,
  hasSourceDimensions,
  patchTransforms,
}: FrameControlsSectionProps & { hasSourceDimensions: boolean }) {
  return (
    <div className="space-y-1">
      <span className="text-muted-foreground text-[10px]">
        {labels.frameFocus}
      </span>
      <div className="border-border grid aspect-[16/10] grid-cols-3 gap-1 rounded-md border p-1">
        {FRAME_FOCUS_POINTS.map((point) => {
          const target = fillFrameTransform(sourceFrame, aspectRatio, point);
          const active =
            hasSourceDimensions &&
            Math.abs((transforms.scale ?? 1) - (target.scale ?? 1)) < 0.015 &&
            Math.abs(
              (transforms.positionX ?? 0.5) - (target.positionX ?? 0.5),
            ) < 0.015 &&
            Math.abs(
              (transforms.positionY ?? 0.5) - (target.positionY ?? 0.5),
            ) < 0.015;
          return (
            <button
              key={point.label}
              type="button"
              className={
                active
                  ? 'bg-primary/15 border-primary text-primary flex items-center justify-center rounded border'
                  : 'border-border hover:bg-accent flex items-center justify-center rounded border'
              }
              aria-label={labels.frameFocusLabels[point.label]}
              title={labels.frameFocusLabels[point.label]}
              onClick={() =>
                patchTransforms(
                  fillFrameTransform(sourceFrame, aspectRatio, point),
                )
              }
            >
              <span
                className={
                  active
                    ? 'bg-primary size-1.5 rounded-full'
                    : 'bg-muted-foreground size-1.5 rounded-full'
                }
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NudgeGrid({
  aspectRatio,
  labels,
  sourceFrame,
  transforms,
  patchTransforms,
}: FrameControlsSectionProps) {
  return (
    <div className="space-y-1">
      <span className="text-muted-foreground text-[10px]">
        {labels.frameNudge}
      </span>
      <div className="grid grid-cols-3 gap-1">
        <span />
        <IconButton
          label={labels.frameFocusLabels.n}
          icon={<ArrowUp className="size-3" />}
          onClick={() =>
            patchTransforms(
              nudgeFrameTransform(
                transforms,
                { y: 0.03 },
                sourceFrame,
                aspectRatio,
              ),
            )
          }
        />
        <span />
        <IconButton
          label={labels.frameFocusLabels.w}
          icon={<ArrowLeft className="size-3" />}
          onClick={() =>
            patchTransforms(
              nudgeFrameTransform(
                transforms,
                { x: 0.03 },
                sourceFrame,
                aspectRatio,
              ),
            )
          }
        />
        <IconButton
          label={labels.frameCenter}
          icon={<Crosshair className="size-3" />}
          onClick={() => patchTransforms(centeredFrameTransform())}
        />
        <IconButton
          label={labels.frameFocusLabels.e}
          icon={<ArrowRight className="size-3" />}
          onClick={() =>
            patchTransforms(
              nudgeFrameTransform(
                transforms,
                { x: -0.03 },
                sourceFrame,
                aspectRatio,
              ),
            )
          }
        />
        <span />
        <IconButton
          label={labels.frameFocusLabels.s}
          icon={<ArrowDown className="size-3" />}
          onClick={() =>
            patchTransforms(
              nudgeFrameTransform(
                transforms,
                { y: -0.03 },
                sourceFrame,
                aspectRatio,
              ),
            )
          }
        />
        <span />
      </div>
    </div>
  );
}

function FrameButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="border-border hover:bg-accent text-foreground flex min-h-8 items-center justify-center gap-1 rounded-md border px-2 text-[11px]"
      onClick={onClick}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

function IconButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="border-border hover:bg-accent flex size-7 items-center justify-center rounded-md border"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}
