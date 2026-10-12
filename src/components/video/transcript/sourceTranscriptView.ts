import {
  deriveTranscriptWordStates,
  type TranscriptSourceMatch,
  type TranscriptWordState,
} from '@neumar/video-ir';

import type { VideoProject, VideoSubtitleWord } from '@/shared/types/video';

export interface SourceTranscriptView {
  sourceId: string;
  match: TranscriptSourceMatch;
  words: readonly VideoSubtitleWord[];
  /** Null when no clip on the timeline plays this source. */
  states: readonly TranscriptWordState[] | null;
  /** Changes when the transcript is replaced; selections must reset on change. */
  transcriptKey: string;
}

/** One view per analyzed source that has a word-timed transcript. */
export function buildSourceTranscriptViews(
  project: VideoProject,
): SourceTranscriptView[] {
  const timeline = project.timeline;
  const sourcesById = new Map((project.sources ?? []).map((s) => [s.id, s]));
  const views: SourceTranscriptView[] = [];
  for (const analysis of project.sourceAnalyses ?? []) {
    const words = analysis.transcript?.words;
    const source = sourcesById.get(analysis.sourceId);
    if (!words?.length || !source) continue;
    const match: TranscriptSourceMatch = {
      assetIds: [source.mediaItemId],
      sourceId: source.id,
    };
    views.push({
      sourceId: source.id,
      match,
      words,
      states: timeline
        ? deriveTranscriptWordStates(timeline, match, words)
        : null,
      transcriptKey: transcriptKey(analysis.id, words),
    });
  }
  return views;
}

function transcriptKey(
  analysisId: string,
  words: readonly VideoSubtitleWord[],
): string {
  const last = words[words.length - 1];
  return `${analysisId}:${words.length}:${words[0]?.startMs ?? 0}:${last?.endMs ?? 0}`;
}

/** Index of the word playing at `playheadMs` (first occurrence), or null. */
export function findActiveWordIndex(
  view: Pick<SourceTranscriptView, 'states'>,
  playheadMs: number,
): number | null {
  if (!view.states) return null;
  for (const state of view.states) {
    for (const occurrence of state.occurrences) {
      if (playheadMs >= occurrence.startMs && playheadMs < occurrence.endMs) {
        return state.index;
      }
    }
  }
  return null;
}

/**
 * Timeline position to seek to for a word: the first occurrence at or after
 * `fromMs`, else the first occurrence. Null for cut/partial words.
 */
export function wordSeekMs(
  state: TranscriptWordState | undefined,
  fromMs: number,
): number | null {
  if (!state || state.occurrences.length === 0) return null;
  const next = state.occurrences.find((o) => o.startMs >= fromMs);
  return (next ?? state.occurrences[0]!).startMs;
}

/** Maximal run of contiguous `cut` words around `index`; null if not cut. */
export function cutRunAround(
  states: readonly TranscriptWordState[],
  index: number,
): { startIndex: number; endIndex: number } | null {
  if (states[index]?.status !== 'cut') return null;
  let startIndex = index;
  let endIndex = index;
  while (states[startIndex - 1]?.status === 'cut') startIndex -= 1;
  while (states[endIndex + 1]?.status === 'cut') endIndex += 1;
  return { startIndex, endIndex };
}
