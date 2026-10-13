import { useEffect, useRef, useState } from 'react';

import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  VideoCaptionTimelineClip,
  VideoCaptionTimelineTrack,
  VideoSubtitleWord,
  VideoTimeline,
} from '@/shared/types/video';

import { useTimelineEditorStore } from './timeline/useTimelineEditorStore';
import { useTimelineUiStore } from './timeline/useTimelineUiStore';

export function captionTracksFromTimeline(
  timeline: VideoTimeline | null | undefined,
): VideoCaptionTimelineTrack[] {
  return (
    timeline?.tracks.filter(
      (track): track is VideoCaptionTimelineTrack => track.kind === 'caption',
    ) ?? []
  );
}

/** Reads one caption track, including hidden translations, in timeline order. */
export function captionCuesFromTimeline(
  timeline: VideoTimeline | null | undefined,
  trackId?: string,
): VideoCaptionTimelineClip[] {
  const tracks = captionTracksFromTimeline(timeline);
  const track = trackId
    ? tracks.find((entry) => entry.id === trackId)
    : tracks.find((entry) => entry.clips.length > 0);
  if (!track) return [];
  return [...track.clips].sort((a, b) => a.startMs - b.startMs);
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
  cues: fallbackCues,
  timeline: fallbackTimeline,
}: {
  cues: VideoCaptionTimelineClip[];
  timeline?: VideoTimeline | null;
}) {
  const { t } = useLanguage();
  const timeline = useTimelineEditorStore((state) => state.timeline);
  const tracks = captionTracksFromTimeline(timeline ?? fallbackTimeline);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const selectedTrack =
    tracks.find((track) => track.id === selectedTrackId) ??
    tracks.find((track) => track.clips.length > 0) ??
    tracks[0];
  const cues = selectedTrack
    ? [...selectedTrack.clips].sort((a, b) => a.startMs - b.startMs)
    : fallbackCues;
  const playheadMs = useTimelineUiStore((state) => state.playheadMs);
  const setPlayheadMs = useTimelineUiStore((state) => state.setPlayheadMs);
  const selectClip = useTimelineEditorStore((state) => state.selectClip);
  const updateClip = useTimelineEditorStore((state) => state.updateClip);

  const [editing, setEditing] = useState<{
    cueId: string;
    trackId?: string;
  } | null>(null);
  const [draft, setDraft] = useState('');
  const editRef = useRef<{ cueId: string; trackId?: string } | null>(null);

  const cancelEdit = () => {
    editRef.current = null;
    setEditing(null);
  };
  const startEditing = (cue: VideoCaptionTimelineClip) => {
    if (selectedTrack?.locked) return;
    editRef.current = { cueId: cue.id, trackId: selectedTrack?.id };
    setEditing({ cueId: cue.id, trackId: selectedTrack?.id });
    setDraft(cue.text);
  };
  const commitEdit = (cue: VideoCaptionTimelineClip) => {
    const edit = editRef.current;
    cancelEdit();
    if (edit?.cueId !== cue.id || edit.trackId !== selectedTrack?.id) return;
    const currentTimeline = useTimelineEditorStore.getState().timeline;
    const currentTrack = captionTracksFromTimeline(currentTimeline).find(
      (track) =>
        (edit.trackId ? track.id === edit.trackId : true) &&
        track.clips.some((clip) => clip.id === cue.id),
    );
    // Clip updates address globally unique IDs. Refuse ambiguous legacy cues
    // rather than applying a translation edit to its source track as well.
    const matches = currentTimeline?.tracks.flatMap((track) =>
      track.clips.filter((clip) => clip.id === cue.id),
    );
    if (!currentTrack || currentTrack.locked || matches?.length !== 1) return;
    const currentCue = currentTrack.clips.find((clip) => clip.id === cue.id);
    const text = draft.trim();
    if (!currentCue || !text || text === currentCue.text) return;
    updateClip(cue.id, {
      text,
      words: redistributeCaptionWords(currentCue, text),
    });
  };

  const activeCueId =
    cues.find(
      (cue) =>
        playheadMs >= cue.startMs && playheadMs < cue.startMs + cue.durationMs,
    )?.id ?? null;

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
      {tracks.length > 1 ? (
        <label className="text-muted-foreground mb-3 flex items-center gap-2 text-xs">
          {t.video.editor.transcript.captionTrackLabel}
          <select
            value={selectedTrack?.id}
            onChange={(event) => {
              cancelEdit();
              setSelectedTrackId(event.target.value);
            }}
            className="border-input bg-background text-foreground min-w-0 flex-1 rounded-md border px-2 py-1"
          >
            {tracks.map((track) => (
              <option key={track.id} value={track.id}>
                {track.name}
                {track.language ? ` · ${track.language}` : ''}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {cues.length === 0 ? (
        <p className="text-muted-foreground p-3 text-center text-xs">
          {t.video.editor.transcript.empty}
        </p>
      ) : null}
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
            {editing?.cueId === cue.id &&
            editing.trackId === selectedTrack?.id ? (
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
                    cancelEdit();
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
