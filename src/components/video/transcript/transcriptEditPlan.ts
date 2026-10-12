import {
  applyTimelineOps,
  compileTranscriptCut,
  compileTranscriptRestore,
  type TimelineOp,
  type TranscriptRestoreFailure,
} from '@neumar/video-ir';

import type { VideoTimeline } from '@/shared/types/video';

import {
  cutRunAround,
  type SourceTranscriptView,
} from './sourceTranscriptView';
import type { TranscriptWordSelection } from './useTranscriptSelectionStore';

export type TranscriptEditPlan =
  | { ok: true; ops: TimelineOp[] }
  | { ok: false; reason: 'nothing-to-do' | TranscriptRestoreFailure };

/** Cut the selected words from the media. Already-cut words are skipped. */
export function planTranscriptCut(
  timeline: VideoTimeline,
  view: SourceTranscriptView,
  selection: TranscriptWordSelection,
): TranscriptEditPlan {
  const ops = compileTranscriptCut({
    timeline,
    match: view.match,
    words: view.words,
    startIndex: selection.startIndex,
    endIndex: selection.endIndex,
  });
  return ops.length > 0
    ? { ok: true, ops }
    : { ok: false, reason: 'nothing-to-do' };
}

/**
 * Restore every contiguous cut run the selection touches. Restoring a partial
 * run is not possible once the gap has closed, so each run is restored whole.
 */
export function planTranscriptRestore(
  timeline: VideoTimeline,
  view: SourceTranscriptView,
  selection: TranscriptWordSelection,
): TranscriptEditPlan {
  const states = view.states;
  if (!states) return { ok: false, reason: 'nothing-to-do' };
  const runs: Array<{ startIndex: number; endIndex: number }> = [];
  for (let i = selection.startIndex; i <= selection.endIndex; i++) {
    const run = cutRunAround(states, i);
    if (!run) continue;
    runs.push(run);
    i = Math.max(i, run.endIndex);
  }
  if (runs.length === 0) return { ok: false, reason: 'nothing-to-do' };

  // Later runs first so earlier word windows stay valid while rippling.
  let working = timeline;
  const ops: TimelineOp[] = [];
  for (const run of runs.reverse()) {
    const result = compileTranscriptRestore({
      timeline: working,
      match: view.match,
      words: view.words,
      startIndex: run.startIndex,
      endIndex: run.endIndex,
    });
    if (!result.ok) return result;
    working = applyTimelineOps(working, result.ops).timeline;
    ops.push(...result.ops);
  }
  return { ok: true, ops };
}
