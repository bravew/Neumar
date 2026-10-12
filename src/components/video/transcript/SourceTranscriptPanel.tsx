import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { toast } from 'sonner';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoProject } from '@/shared/types/video';

import { useTimelineUiStore } from '../timeline/useTimelineUiStore';
import {
  buildSourceTranscriptViews,
  findActiveWordIndex,
  groupWordsIntoLines,
  wordSeekMs,
  type SourceTranscriptView,
} from './sourceTranscriptView';
import { runTranscriptAction, TranscriptEditBar } from './TranscriptEditBar';
import { TranscriptWordEditor } from './TranscriptWordEditor';
import { useTranscriptSelectionStore } from './useTranscriptSelectionStore';

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

/**
 * Word-level view of the analyzed source speech. Cut words stay visible
 * (struck through); words only partly on the timeline are dimmed. Clicking a
 * word seeks, shift-click or drag selects a range, and the active word follows
 * the playhead.
 */
export function SourceTranscriptPanel({
  project,
  onCorrectWord,
  className,
}: {
  project: VideoProject;
  /** Saves a text correction; timing never changes. Omit to disable editing. */
  onCorrectWord?: WordCorrectionHandler;
  className?: string;
}) {
  const views = useMemo(() => buildSourceTranscriptViews(project), [project]);
  const followPlayback = useTranscriptSelectionStore((s) => s.followPlayback);
  const setFollowPlayback = useTranscriptSelectionStore(
    (s) => s.setFollowPlayback,
  );
  const { t } = useLanguage();
  const labels = t.video.editor.transcript;

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <div className="border-border flex items-center justify-between border-b px-3 py-1.5">
        <span className="text-muted-foreground text-[11px]">
          {labels.sourceDescription}
        </span>
        <label className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
          <input
            type="checkbox"
            checked={followPlayback}
            onChange={(event) => setFollowPlayback(event.target.checked)}
          />
          {labels.followPlayback}
        </label>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        {views.map((view) => (
          <SourceWords
            key={view.sourceId}
            view={view}
            onCorrectWord={onCorrectWord}
          />
        ))}
      </div>
    </div>
  );
}

export type WordCorrectionHandler = (
  sourceId: string,
  corrections: Array<{ index: number; text: string; startMs: number }>,
) => Promise<unknown>;

function SourceWords({
  view,
  onCorrectWord,
}: {
  view: SourceTranscriptView;
  onCorrectWord?: WordCorrectionHandler;
}) {
  const { t } = useLanguage();
  const labels = t.video.editor.transcript;
  const playheadMs = useTimelineUiStore((s) => s.playheadMs);
  const setPlayheadMs = useTimelineUiStore((s) => s.setPlayheadMs);
  const selection = useTranscriptSelectionStore((s) => s.selection);
  const followPlayback = useTranscriptSelectionStore((s) => s.followPlayback);
  const selectWord = useTranscriptSelectionStore((s) => s.selectWord);
  const clearSelection = useTranscriptSelectionStore((s) => s.clearSelection);
  const mode = useTranscriptSelectionStore((s) => s.mode);
  const lines = useMemo(() => groupWordsIntoLines(view.words), [view.words]);
  const activeIndex = findActiveWordIndex(view, playheadMs);
  const dragging = useRef(false);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  // A new transcript invalidates any word-index selection.
  useEffect(() => {
    clearSelection();
    setEditingIndex(null);
  }, [view.transcriptKey, clearSelection]);

  useEffect(() => {
    const stop = () => {
      dragging.current = false;
    };
    window.addEventListener('mouseup', stop);
    return () => window.removeEventListener('mouseup', stop);
  }, []);

  useEffect(() => {
    if (!followPlayback || activeIndex === null) return;
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, followPlayback]);

  const seek = useCallback(
    (index: number) => {
      const target = wordSeekMs(view.states?.[index], playheadMs);
      if (target !== null) setPlayheadMs(target);
    },
    [playheadMs, setPlayheadMs, view.states],
  );

  if (!view.states) {
    return (
      <p className="text-muted-foreground text-center text-xs">
        {labels.notOnTimeline}
      </p>
    );
  }
  const selected = (index: number) =>
    selection?.sourceId === view.sourceId &&
    index >= selection.startIndex &&
    index <= selection.endIndex;

  return (
    <div
      className="space-y-2 outline-none"
      role="group"
      aria-label={labels.sourceTitle}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          clearSelection();
          return;
        }
        if (event.key !== 'Delete' && event.key !== 'Backspace') return;
        // Text mode never touches media (AT-09); cutting needs Cut media mode.
        if (mode !== 'cut' || selection?.sourceId !== view.sourceId) return;
        event.preventDefault();
        runTranscriptAction('cut', view, selection, {
          restoreFailed: labels.restoreFailed,
          nothingToDo: labels.nothingToDo,
        });
      }}
    >
      <TranscriptEditBar view={view} />
      {lines.map((line) => (
        <div
          key={line.startIndex}
          className="flex gap-2 [contain-intrinsic-size:auto_24px] [content-visibility:auto]"
        >
          <span className="text-muted-foreground w-9 shrink-0 pt-0.5 text-right text-[10px] tabular-nums">
            {formatTimestamp(line.startMs)}
          </span>
          <p className="text-foreground min-w-0 flex-1 text-xs leading-6">
            {view.words
              .slice(line.startIndex, line.endIndex + 1)
              .map((word, offset) => {
                const index = line.startIndex + offset;
                const status = view.states![index]!.status;
                const active = index === activeIndex;
                if (editingIndex === index) {
                  return (
                    <TranscriptWordEditor
                      key={index}
                      word={word.text}
                      ariaLabel={labels.editWordLabel}
                      onCancel={() => setEditingIndex(null)}
                      onCommit={(text) => {
                        setEditingIndex(null);
                        void onCorrectWord?.(view.sourceId, [
                          { index, text, startMs: word.startMs },
                        ]).catch(() => toast.error(labels.correctFailed));
                      }}
                    />
                  );
                }
                return (
                  <button
                    key={index}
                    ref={active ? activeRef : undefined}
                    type="button"
                    data-word-index={index}
                    data-status={status}
                    aria-current={active ? 'true' : undefined}
                    aria-pressed={selected(index)}
                    title={
                      status === 'cut'
                        ? labels.cutWord
                        : status === 'partial'
                          ? labels.partialWord
                          : labels.jumpTo.replace(
                              '{time}',
                              formatTimestamp(word.startMs),
                            )
                    }
                    onMouseDown={(event) => {
                      dragging.current = true;
                      selectWord(view.sourceId, index, event.shiftKey);
                    }}
                    onMouseEnter={() => {
                      if (dragging.current)
                        selectWord(view.sourceId, index, true);
                    }}
                    onClick={(event) => {
                      if (!event.shiftKey) seek(index);
                    }}
                    onDoubleClick={() => {
                      // Text mode only: fixing a word never edits the media.
                      if (
                        mode === 'text' &&
                        onCorrectWord &&
                        status !== 'cut'
                      ) {
                        setEditingIndex(index);
                      }
                    }}
                    className={cn(
                      'hover:bg-muted mr-0.5 inline rounded px-0.5',
                      status === 'cut' && 'text-muted-foreground line-through',
                      status === 'partial' && 'text-muted-foreground/70',
                      selected(index) && 'bg-primary/20',
                      active && 'bg-primary text-primary-foreground',
                    )}
                  >
                    {word.text}
                  </button>
                );
              })}
          </p>
        </div>
      ))}
    </div>
  );
}
