import { Trash2 } from 'lucide-react';

import {
  normalizeVideoTransition,
  VIDEO_TRANSITION_REGISTRY,
  videoTransitionRegistryEntry,
  type VideoTimeline,
  type VideoTransitionDirection,
  type VideoTransitionKind,
  type VideoTransitionPresetGroup,
} from '@/shared/types/video';

import type { TimelineTransitionMutation } from '../timeline/useTimelineEditorStore';
import { TransitionTilePreview } from '../transitions/TransitionTilePreview';
import { findTimelineTransitionSeamContext } from './transitionInspectorModel';
import {
  clamp,
  clipLabel,
  transitionBlockedReasonLabel,
  transitionMutation,
  transitionPreviewSeekMs,
  transitionRenderNote,
} from './transitionInspectorUtils';
import { TransitionParamControls } from './TransitionParamControls';
import { formatMs, type ClipInspectorLabels } from './types';

interface TransitionInspectorPanelProps {
  timeline: VideoTimeline;
  seamId: string;
  labels: ClipInspectorLabels;
  transitionNames: Record<VideoTransitionKind, string>;
  renderLabels: {
    remotionOnly: string;
    ffmpegOnly: string;
  };
  onUpdate: (seamId: string, transition: TimelineTransitionMutation) => void;
  onRemove: (seamId: string) => void;
  onPreviewSeek?: (playheadMs: number) => void;
}

const GROUP_ORDER: VideoTransitionPresetGroup[] = [
  'subtle',
  'motion',
  'wipe',
  'stylized',
];

export function TransitionInspectorPanel({
  timeline,
  seamId,
  labels,
  transitionNames,
  renderLabels,
  onUpdate,
  onRemove,
  onPreviewSeek,
}: TransitionInspectorPanelProps) {
  const context = findTimelineTransitionSeamContext(timeline, seamId);
  if (!context) {
    return (
      <p className="text-muted-foreground text-xs">
        {labels.transitionNoAdjacent}
      </p>
    );
  }
  const { seam, fromClip, toClip } = context;
  const transition = normalizeVideoTransition(seam.transition ?? 'cut');
  const entry = videoTransitionRegistryEntry(transition.kind);
  const maxDurationMs = Math.max(
    entry.minDurationMs,
    Math.min(entry.maxDurationMs, seam.neighborMaxDurationMs),
  );
  const durationMs = clamp(
    transition.durationMs ?? entry.defaultDurationMs,
    entry.minDurationMs,
    maxDurationMs,
  );
  const rendererNote = transitionRenderNote(
    entry.native,
    renderLabels.remotionOnly,
    renderLabels.ffmpegOnly,
  );
  const disabled = !seam.canAcceptTransition;
  const seekPreview = () => {
    onPreviewSeek?.(transitionPreviewSeekMs(seam.startMs));
  };

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <p className="text-muted-foreground text-[11px] font-semibold tracking-normal uppercase">
          {labels.transitionInspectorTitle}
        </p>
        <h3 className="text-foreground text-sm font-semibold">
          {labels.transitionFromInto
            .replace('{from}', clipLabel(fromClip))
            .replace('{to}', clipLabel(toClip))}
        </h3>
        <p className="text-muted-foreground text-xs">
          {formatMs(seam.startMs)}
          {rendererNote ? ` · ${rendererNote}` : ''}
        </p>
      </header>

      {!seam.canAcceptTransition ? (
        <p className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-2 py-1.5 text-xs">
          {transitionBlockedReasonLabel(seam.blockedReason, labels)}
        </p>
      ) : null}

      <TransitionTilePreview
        active={!disabled}
        className="h-28"
        params={transition.params}
        previewDirection={transition.direction ?? entry.directions[0]}
        timing={transition.timing}
        transition={entry}
      />

      <label className="grid gap-1 text-[11px] font-medium">
        <span>{labels.transitionType}</span>
        <select
          className="border-input bg-background h-8 rounded-md border px-2 text-xs"
          value={transition.kind}
          disabled={disabled}
          onChange={(event) => {
            const kind = event.currentTarget.value as VideoTransitionKind;
            const nextEntry = videoTransitionRegistryEntry(kind);
            const baseDurationMs =
              transition.kind === 'cut'
                ? nextEntry.defaultDurationMs
                : durationMs;
            const nextDurationMs =
              kind === 'cut'
                ? undefined
                : clamp(
                    baseDurationMs,
                    nextEntry.minDurationMs,
                    Math.min(
                      nextEntry.maxDurationMs,
                      seam.neighborMaxDurationMs,
                    ),
                  );
            onUpdate(
              seam.seamId,
              transitionMutation(
                kind,
                nextDurationMs,
                nextEntry.directions.includes(
                  transition.direction as VideoTransitionDirection,
                )
                  ? transition.direction
                  : nextEntry.directions[0],
              ),
            );
            seekPreview();
          }}
        >
          {GROUP_ORDER.map((group) => (
            <optgroup key={group} label={labels.transitionGroups[group]}>
              {VIDEO_TRANSITION_REGISTRY.filter(
                (candidate) => candidate.group === group,
              ).map((candidate) => (
                <option key={candidate.kind} value={candidate.kind}>
                  {transitionNames[candidate.kind]}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      {transition.kind !== 'cut' ? (
        <label className="grid gap-1 text-[11px] font-medium">
          <span className="flex items-center justify-between">
            <span>{labels.transitionDuration}</span>
            <span className="text-muted-foreground tabular-nums">
              {durationMs} ms
            </span>
          </span>
          <input
            type="range"
            min={entry.minDurationMs}
            max={maxDurationMs}
            step={1}
            value={durationMs}
            disabled={disabled}
            className="accent-primary w-full"
            aria-label={labels.transitionDuration}
            onChange={(event) => {
              const nextDurationMs = clamp(
                Number(event.currentTarget.value),
                entry.minDurationMs,
                maxDurationMs,
              );
              onUpdate(
                seam.seamId,
                transitionMutation(
                  transition.kind,
                  nextDurationMs,
                  transition.direction,
                  transition.params,
                  transition.timing,
                ),
              );
              seekPreview();
            }}
          />
          <input
            type="number"
            min={entry.minDurationMs}
            max={maxDurationMs}
            value={durationMs}
            disabled={disabled}
            className="border-input bg-background h-8 rounded-md border px-2 text-xs"
            aria-label={labels.transitionDuration}
            onChange={(event) => {
              const nextDurationMs = clamp(
                Number(event.currentTarget.value),
                entry.minDurationMs,
                maxDurationMs,
              );
              onUpdate(
                seam.seamId,
                transitionMutation(
                  transition.kind,
                  nextDurationMs,
                  transition.direction,
                  transition.params,
                  transition.timing,
                ),
              );
              seekPreview();
            }}
          />
          <span className="text-muted-foreground text-[10px]">
            {labels.transitionDurationRange
              .replace('{min}', String(entry.minDurationMs))
              .replace('{max}', String(maxDurationMs))}
          </span>
        </label>
      ) : null}

      {entry.directions.length > 0 && transition.kind !== 'cut' ? (
        <label className="grid gap-1 text-[11px] font-medium">
          <span>{labels.transitionDirection}</span>
          <select
            className="border-input bg-background h-8 rounded-md border px-2 text-xs"
            value={transition.direction ?? entry.directions[0]}
            disabled={disabled}
            onChange={(event) => {
              onUpdate(
                seam.seamId,
                transitionMutation(
                  transition.kind,
                  durationMs,
                  event.currentTarget.value as VideoTransitionDirection,
                  transition.params,
                  transition.timing,
                ),
              );
              seekPreview();
            }}
          >
            {entry.directions.map((direction) => (
              <option key={direction} value={direction}>
                {labels.transitionDirections[direction]}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {entry.paramDefs &&
      entry.paramDefs.length > 0 &&
      transition.kind !== 'cut' ? (
        <TransitionParamControls
          disabled={disabled}
          labels={labels}
          paramDefs={entry.paramDefs}
          params={transition.params}
          onChange={(params) => {
            onUpdate(
              seam.seamId,
              transitionMutation(
                transition.kind,
                durationMs,
                transition.direction,
                params,
                transition.timing,
              ),
            );
            seekPreview();
          }}
        />
      ) : null}

      {entry.webglPreview !== 'native' ? (
        <p className="text-muted-foreground text-xs">
          {entry.webglPreview === 'fallback'
            ? labels.transitionPreviewApproximate
            : labels.transitionPreviewUnavailable}
        </p>
      ) : null}

      <button
        type="button"
        className="border-border text-muted-foreground hover:text-destructive hover:border-destructive/60 inline-flex h-8 items-center gap-2 rounded-md border px-2 text-xs"
        onClick={() => onRemove(seam.seamId)}
      >
        <Trash2 className="size-3.5" />
        {labels.transitionRemove}
      </button>
    </section>
  );
}
