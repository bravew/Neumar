import { useRef, useState } from 'react';

import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';
import type { VideoReference } from '@/shared/types/video';

interface ReferenceRangeEditorProps {
  projectId: string;
  reference: VideoReference;
  disabled: boolean;
  onSetRange: (
    referenceId: string,
    range: { startMs: number; endMs: number },
  ) => Promise<VideoReference | null>;
}

// Mirrors REFERENCE_ANALYSIS_MAX_MS in
// src-api/src/shared/video/reference/media-trim.ts — the server is the
// source of truth and re-validates this; here it only lets the user catch
// an out-of-range pick before submitting.
const ANALYSIS_MAX_MS = 10 * 60 * 1000;

const PREVIEWABLE_EXTENSIONS = /\.(mp4|webm|ogv|ogg)$/i;

function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved' }
  | { status: 'error'; message: string };

/**
 * Lets the user pick which slice of a reference actually gets analyzed.
 *
 * A long source can always be downloaded/imported in full — this editor is
 * where "the first 10 minutes by default" becomes "minutes 4 through 9",
 * with a scrubbable preview of the full source when the format supports it.
 */
export function ReferenceRangeEditor({
  projectId,
  reference,
  disabled,
  onSetRange,
}: ReferenceRangeEditorProps) {
  const { t } = useLanguage();
  const copy = t.video.reference.range;
  const videoRef = useRef<HTMLVideoElement>(null);
  const sourceDurationMs = reference.sourceDurationMs ?? reference.durationMs;
  const initialRange = reference.analysisRange ?? {
    startMs: 0,
    endMs: Math.min(sourceDurationMs, ANALYSIS_MAX_MS),
  };
  const [startMs, setStartMs] = useState(initialRange.startMs);
  const [endMs, setEndMs] = useState(initialRange.endMs);
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });

  const sourcePath = reference.sourceMediaPath ?? reference.mediaPath;
  const previewable = PREVIEWABLE_EXTENSIONS.test(sourcePath);
  const sourceMediaUrl = `${API_BASE_URL}/video/projects/${encodeURIComponent(projectId)}/references/${encodeURIComponent(reference.id)}/media?variant=source`;

  const tooLong = endMs - startMs > ANALYSIS_MAX_MS;
  const outOfOrder = endMs <= startMs;
  const outOfBounds = endMs > sourceDurationMs || startMs < 0;
  const invalid = tooLong || outOfOrder || outOfBounds;

  const captureCurrentTimeFor = (which: 'start' | 'end') => {
    const video = videoRef.current;
    if (!video) return;
    const ms = Math.round(video.currentTime * 1000);
    if (which === 'start') setStartMs(ms);
    else setEndMs(ms);
  };

  return (
    <div className="border-border space-y-2 rounded border p-2 text-[11px]">
      {previewable ? (
        <video
          ref={videoRef}
          src={sourceMediaUrl}
          controls
          className="bg-background w-full rounded"
        />
      ) : (
        <p className="text-muted-foreground">{copy.previewUnavailable}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1">
          {copy.inLabel}
          <input
            type="number"
            min={0}
            step={1}
            value={Math.round(startMs / 1000)}
            disabled={disabled}
            onChange={(event) =>
              setStartMs(Math.max(0, Number(event.target.value) * 1000))
            }
            className="border-input bg-background w-16 rounded border px-1 py-0.5"
          />
          <span className="text-muted-foreground">{formatClock(startMs)}</span>
          {previewable ? (
            <button
              type="button"
              className="border-border hover:bg-accent rounded border px-1 py-0.5"
              disabled={disabled}
              onClick={() => captureCurrentTimeFor('start')}
            >
              {copy.useCurrentTime}
            </button>
          ) : null}
        </label>
        <label className="flex items-center gap-1">
          {copy.outLabel}
          <input
            type="number"
            min={0}
            step={1}
            value={Math.round(endMs / 1000)}
            disabled={disabled}
            onChange={(event) =>
              setEndMs(Math.max(0, Number(event.target.value) * 1000))
            }
            className="border-input bg-background w-16 rounded border px-1 py-0.5"
          />
          <span className="text-muted-foreground">{formatClock(endMs)}</span>
          {previewable ? (
            <button
              type="button"
              className="border-border hover:bg-accent rounded border px-1 py-0.5"
              disabled={disabled}
              onClick={() => captureCurrentTimeFor('end')}
            >
              {copy.useCurrentTime}
            </button>
          ) : null}
        </label>
      </div>
      <p className="text-muted-foreground">
        {copy.capNote.replace('{minutes}', String(ANALYSIS_MAX_MS / 60_000))}
      </p>
      {outOfOrder ? (
        <p className="text-destructive">{copy.invalidOrder}</p>
      ) : null}
      {outOfBounds && !outOfOrder ? (
        <p className="text-destructive">{copy.invalidBounds}</p>
      ) : null}
      {tooLong && !outOfOrder ? (
        <p className="text-destructive">{copy.tooLong}</p>
      ) : null}
      <button
        type="button"
        className="border-border hover:bg-accent rounded border px-2 py-1 disabled:opacity-40"
        disabled={disabled || invalid || saveState.status === 'saving'}
        onClick={() => {
          setSaveState({ status: 'saving' });
          void onSetRange(reference.id, { startMs, endMs })
            .then((updated) => {
              if (!updated) {
                setSaveState({ status: 'error', message: copy.noProject });
                return;
              }
              setSaveState({ status: 'saved' });
            })
            .catch((error: unknown) => {
              setSaveState({
                status: 'error',
                message: error instanceof Error ? error.message : String(error),
              });
            });
        }}
      >
        {saveState.status === 'saving' ? copy.saving : copy.save}
      </button>
      {saveState.status === 'saved' ? (
        <p className="text-emerald-700 dark:text-emerald-400">
          {copy.saveSuccess}
        </p>
      ) : null}
      {saveState.status === 'error' ? (
        <p className="text-destructive">
          {copy.saveError.replace('{error}', saveState.message)}
        </p>
      ) : null}
    </div>
  );
}
