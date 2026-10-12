import { useMemo } from 'react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProject, VideoTimeline } from '@/shared/types/video';
import { useVideoFlags } from '@/shared/video/useVideoFlags';

import { TRACK_HEADER_WIDTH } from '../timeline/timelineLayout';
import { msToPixels } from '../timeline/timelineMath';
import { useTimelineUiStore } from '../timeline/useTimelineUiStore';
import { buildSourceTranscriptViews } from './sourceTranscriptView';
import { buildTranscriptLayer } from './transcriptLayerModel';
import { useTranscriptSelectionStore } from './useTranscriptSelectionStore';

const CUT_MARKER_WIDTH = 8;

/**
 * Derived timeline row mirroring the source transcript: sentence blocks over
 * the kept speech and a marker at every cut seam. It shares selection with the
 * transcript panel and hides itself when no analyzed source is on the timeline.
 * It is not a persisted track, so the timeline schema is unchanged.
 */
export function TimelineTranscriptRow({
  project,
  timeline,
  onSeek,
}: {
  project: VideoProject;
  /** The editor's live timeline; falls back to the saved project timeline. */
  timeline: VideoTimeline | null;
  onSeek: (ms: number) => void;
}) {
  const { flags } = useVideoFlags();
  const enabled = flags['video.transcriptLayer'] !== false;
  const layers = useMemo(
    () =>
      enabled
        ? buildSourceTranscriptViews({
            ...project,
            timeline: timeline ?? project.timeline,
          }).map(buildTranscriptLayer)
        : [],
    [enabled, project, timeline],
  );
  if (!layers.some((layer) => layer.blocks.length > 0)) return null;
  return <TranscriptRowBody layers={layers} onSeek={onSeek} />;
}

function TranscriptRowBody({
  layers,
  onSeek,
}: {
  layers: ReturnType<typeof buildTranscriptLayer>[];
  onSeek: (ms: number) => void;
}) {
  const { t } = useLanguage();
  const labels = t.video.editor.transcript;
  const pixelsPerSecond = useTimelineUiStore((s) => s.pixelsPerSecond);
  const scrollX = useTimelineUiStore((s) => s.scrollX);
  const playheadMs = useTimelineUiStore((s) => s.playheadMs);
  const selection = useTranscriptSelectionStore((s) => s.selection);
  const selectRange = useTranscriptSelectionStore((s) => s.selectRange);
  const isSelected = (sourceId: string, startIndex: number, endIndex: number) =>
    selection?.sourceId === sourceId &&
    startIndex <= selection.endIndex &&
    endIndex >= selection.startIndex;

  return (
    <div
      role="group"
      aria-label={labels.layerTitle}
      className="border-border bg-background flex h-7 shrink-0 border-b"
    >
      <div
        className="border-border text-muted-foreground flex shrink-0 items-center border-r px-3 text-[11px]"
        style={{ width: TRACK_HEADER_WIDTH }}
      >
        {labels.layerTitle}
      </div>
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <div
          className="absolute inset-y-0 left-0"
          style={{ transform: `translateX(${-scrollX}px)` }}
        >
          {layers.flatMap((layer) =>
            layer.blocks.map((block) => {
              const left = msToPixels(block.startMs, pixelsPerSecond);
              const width = Math.max(
                2,
                msToPixels(block.endMs, pixelsPerSecond) - left - 1,
              );
              const active =
                playheadMs >= block.startMs && playheadMs < block.endMs;
              return (
                <button
                  key={block.key}
                  type="button"
                  title={block.text}
                  aria-pressed={isSelected(
                    block.sourceId,
                    block.startIndex,
                    block.endIndex,
                  )}
                  onClick={() => {
                    selectRange({
                      sourceId: block.sourceId,
                      startIndex: block.startIndex,
                      endIndex: block.endIndex,
                    });
                    onSeek(block.startMs);
                  }}
                  className={cn(
                    'absolute top-1 bottom-1 truncate rounded-sm px-1 text-left text-[10px] leading-5',
                    active
                      ? 'bg-primary/30 text-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/70',
                    isSelected(
                      block.sourceId,
                      block.startIndex,
                      block.endIndex,
                    ) && 'ring-primary ring-1',
                  )}
                  style={{ left, width }}
                >
                  {block.text}
                </button>
              );
            }),
          )}
          {layers.flatMap((layer) =>
            layer.cuts.map((cut) => (
              <button
                key={cut.key}
                type="button"
                aria-label={labels.layerCutMarker}
                title={labels.layerCutMarker}
                aria-pressed={isSelected(
                  cut.sourceId,
                  cut.startIndex,
                  cut.endIndex,
                )}
                onClick={() => {
                  selectRange({
                    sourceId: cut.sourceId,
                    startIndex: cut.startIndex,
                    endIndex: cut.endIndex,
                  });
                  onSeek(cut.atMs);
                }}
                className={cn(
                  'bg-destructive/70 hover:bg-destructive absolute top-0 bottom-0 rounded-sm',
                  isSelected(cut.sourceId, cut.startIndex, cut.endIndex) &&
                    'ring-primary ring-1',
                )}
                style={{
                  left:
                    msToPixels(cut.atMs, pixelsPerSecond) -
                    CUT_MARKER_WIDTH / 2,
                  width: CUT_MARKER_WIDTH,
                }}
              />
            )),
          )}
        </div>
      </div>
    </div>
  );
}
