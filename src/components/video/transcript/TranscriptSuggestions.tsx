import { useEffect, useMemo, useState } from 'react';

import { toast } from 'sonner';

import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoCutCandidate, VideoTimeline } from '@/shared/types/video';

import { useTimelineEditorStore } from '../timeline/useTimelineEditorStore';
import { useTimelineUiStore } from '../timeline/useTimelineUiStore';
import type { SourceTranscriptView } from './sourceTranscriptView';
import {
  compileSuggestionCut,
  suggestionWindows,
} from './transcriptSuggestionPlan';

export function TranscriptSuggestions({
  view,
  candidates,
}: {
  view: SourceTranscriptView;
  candidates: readonly VideoCutCandidate[];
}) {
  const { t } = useLanguage();
  const labels = t.video.editor.transcript;
  const timeline = useTimelineEditorStore((s) => s.timeline);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{
    startMs: number;
    endMs: number;
  } | null>(null);
  const available = useMemo(
    () =>
      timeline
        ? candidates.filter(
            (candidate) =>
              !dismissed.has(candidate.id) &&
              candidate.recommendation === 'cut' &&
              ['filler', 'silence'].includes(candidate.reason) &&
              suggestionWindows(timeline as VideoTimeline, view, candidate)
                .length > 0,
          )
        : [],
    [candidates, dismissed, timeline, view],
  );

  useEffect(() => {
    if (!preview) return;
    const ui = useTimelineUiStore.getState();
    ui.setPlayheadMs(preview.startMs);
    ui.setPlaybackState('playing');
    const unsubscribe = useTimelineUiStore.subscribe((state) => {
      if (
        state.playbackState === 'playing' &&
        state.playheadMs >= preview.endMs
      ) {
        state.setPlayheadMs(preview.startMs);
      }
    });
    return () => {
      unsubscribe();
      useTimelineUiStore.getState().setPlaybackState('paused');
    };
  }, [preview]);

  if (!available.length) return null;
  return (
    <div
      className="border-border space-y-1 rounded border p-2"
      aria-label={labels.suggestionsTitle}
      role="group"
    >
      <div className="flex items-center justify-between text-xs">
        <span>{labels.suggestionsTitle}</span>
        {preview ? (
          <button type="button" onClick={() => setPreview(null)}>
            {labels.stopPreview}
          </button>
        ) : null}
      </div>
      {available.map((candidate) => (
        <div key={candidate.id} className="flex items-center gap-2 text-[11px]">
          <span className="mr-auto">
            {candidate.reason === 'silence'
              ? labels.suggestionSilence
              : labels.suggestionFiller}
          </span>
          <button
            type="button"
            onClick={() => {
              if (!timeline) return;
              const window = suggestionWindows(
                timeline as VideoTimeline,
                view,
                candidate,
              )[0];
              if (window) setPreview(window);
            }}
          >
            {labels.previewSuggestion}
          </button>
          <button
            type="button"
            onClick={() => {
              setPreview(null);
              const store = useTimelineEditorStore.getState();
              if (!store.timeline) return;
              try {
                const ops = compileSuggestionCut(
                  store.timeline as VideoTimeline,
                  view,
                  candidate,
                );
                if (!ops.length || !store.applyTimelineOpBatch(ops))
                  toast.error(labels.nothingToDo);
              } catch {
                toast.error(labels.cutFailed);
              }
            }}
          >
            {labels.acceptSuggestion}
          </button>
          <button
            type="button"
            onClick={() => {
              setPreview(null);
              setDismissed((current) => new Set([...current, candidate.id]));
            }}
          >
            {labels.dismissSuggestion}
          </button>
        </div>
      ))}
    </div>
  );
}
