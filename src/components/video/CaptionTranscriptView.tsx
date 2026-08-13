import { useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoCaptionTimelineClip,
  VideoSubtitleWord,
  VideoTimeline,
} from '@/shared/types/video';

import { useTimelineEditorStore } from './timeline/useTimelineEditorStore';
import { useTimelineUiStore } from './timeline/useTimelineUiStore';

/**
 * Reads the generated caption cues off the timeline's caption track, sorted by
 * time. This is the single source of truth — the same cues the timeline and
 * preview render — so the transcript panel always matches the captions.
 */
export function captionCuesFromTimeline(
  timeline: VideoTimeline | null | undefined,
): VideoCaptionTimelineClip[] {
  const track = timeline?.tracks.find((entry) => entry.kind === 'caption');
  if (!track) return [];
  return [...(track.clips as VideoCaptionTimelineClip[])].sort(
    (a, b) => a.startMs - b.startMs,
  );
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Re-tokenizes edited cue text and spreads the cue's timeline span across the
 * new words proportionally to word length, so per-word animation keeps working
 * after an inline edit (the caption tool pattern). Returns undefined when the
 * cue had no per-word timings to preserve.
 */
export function redistributeCaptionWords(
  cue: Pick<VideoCaptionTimelineClip, 'startMs' | 'durationMs' | 'words'>,
  text: string,
): VideoSubtitleWord[] | undefined {
  if (!cue.words?.length) return undefined;
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const totalChars = tokens.reduce((sum, token) => sum + token.length, 0) || 1;
  const span = Math.max(0, cue.durationMs);
  let charsSoFar = 0;
  return tokens.map((token) => {
    const startMs = Math.round(cue.startMs + (charsSoFar / totalChars) * span);
    charsSoFar += token.length;
    const endMs = Math.round(cue.startMs + (charsSoFar / totalChars) * span);
    return { text: token, startMs, endMs };
  });
}

/**
 * A transcript of the generated caption cues. Clicking a word (or the cue
 * timestamp) jumps the playhead to that moment; the currently-playing cue and
 * word highlight and auto-scroll into view as playback advances — the
 * transcript-editor pattern used by dedicated caption tools.
 */
export function CaptionTranscriptView({
  cues,
}: {
  cues: VideoCaptionTimelineClip[];
}) {
  const { t } = useLanguage();
  const playheadMs = useTimelineUiStore((state) => state.playheadMs);
  const setPlayheadMs = useTimelineUiStore((state) => state.setPlayheadMs);
  const selectClip = useTimelineEditorStore((state) => state.selectClip);
  const updateClip = useTimelineEditorStore((state) => state.updateClip);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const startEditing = (cue: VideoCaptionTimelineClip) => {
    setEditingId(cue.id);
    setDraft(cue.text);
  };
  const commitEdit = (cue: VideoCaptionTimelineClip) => {
    const text = draft.trim();
    setEditingId(null);
    if (!text || text === cue.text) return;
    updateClip(cue.id, {
      text,
      words: redistributeCaptionWords(cue, text),
    });
  };

  const activeCueId = useMemo(() => {
    const active = cues.find(
      (cue) =>
        playheadMs >= cue.startMs && playheadMs < cue.startMs + cue.durationMs,
    );
    return active?.id ?? null;
  }, [cues, playheadMs]);

  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());
  useEffect(() => {
    if (!activeCueId) return;
    rowRefs.current
      .get(activeCueId)
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [activeCueId]);

  const seek = (ms: number, clipId: string) => {
    setPlayheadMs(ms);
    selectClip(clipId);
  };

  return (
    <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
      {cues.map((cue) => {
        const active = cue.id === activeCueId;
        return (
          <div
            key={cue.id}
            ref={(node) => {
              if (node) rowRefs.current.set(cue.id, node);
              else rowRefs.current.delete(cue.id);
            }}
            aria-current={active ? 'true' : undefined}
            className={cn(
              'flex gap-2 rounded-md border px-2 py-1.5 transition-colors',
              active ? 'border-primary bg-primary/10' : 'border-transparent',
            )}
          >
            <button
              type="button"
              onClick={() => seek(cue.startMs, cue.id)}
              className="text-muted-foreground hover:text-foreground shrink-0 pt-0.5 text-[10px] tabular-nums"
              title={t.video.editor.transcript.jumpTo.replace(
                '{time}',
                formatTimestamp(cue.startMs),
              )}
            >
              {formatTimestamp(cue.startMs)}
            </button>
            {editingId === cue.id ? (
              <textarea
                autoFocus
                rows={1}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => commitEdit(cue)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    commitEdit(cue);
                  } else if (event.key === 'Escape') {
                    setEditingId(null);
                  }
                }}
                className="border-input bg-background text-foreground field-sizing-content w-full resize-none rounded-md border px-1.5 py-0.5 text-xs leading-snug"
              />
            ) : (
              <p
                className="text-foreground text-xs leading-snug"
                onDoubleClick={() => startEditing(cue)}
                title={t.video.editor.transcript.editHint}
              >
                {cue.words?.length ? (
                  cue.words.map((word, index) => {
                    const wordActive =
                      playheadMs >= word.startMs && playheadMs < word.endMs;
                    return (
                      <button
                        // Words within a cue are stable and never reorder.
                        key={index}
                        type="button"
                        onClick={() => seek(word.startMs, cue.id)}
                        className={cn(
                          'hover:bg-muted rounded px-0.5',
                          wordActive && 'bg-primary/30 font-medium',
                        )}
                      >
                        {word.text}
                      </button>
                    );
                  })
                ) : (
                  <button
                    type="button"
                    onClick={() => seek(cue.startMs, cue.id)}
                    className="hover:bg-muted rounded text-left"
                  >
                    {cue.text}
                  </button>
                )}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
