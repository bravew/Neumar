import type { SourceTranscriptView } from './sourceTranscriptView';
import { cutRunAround, groupWordsIntoLines } from './sourceTranscriptView';

/** A sentence-sized span of kept words, positioned on the timeline. */
export interface TranscriptLayerBlock {
  key: string;
  sourceId: string;
  startIndex: number;
  endIndex: number;
  startMs: number;
  endMs: number;
  text: string;
}

/** A seam where a run of words was cut out of the media. */
export interface TranscriptLayerCut {
  key: string;
  sourceId: string;
  startIndex: number;
  endIndex: number;
  /** Timeline position of the seam. */
  atMs: number;
}

export interface TranscriptLayer {
  blocks: TranscriptLayerBlock[];
  cuts: TranscriptLayerCut[];
}

/**
 * Project a source transcript onto the timeline: kept words become sentence
 * blocks, each run of cut words becomes a marker at the seam it left behind.
 * Empty when no clip plays the source.
 */
export function buildTranscriptLayer(
  view: SourceTranscriptView,
): TranscriptLayer {
  const states = view.states;
  if (!states) return { blocks: [], cuts: [] };

  const blocks: TranscriptLayerBlock[] = [];
  for (const line of groupWordsIntoLines(view.words)) {
    // A cut inside a line splits it so a block never spans a seam.
    let current: TranscriptLayerBlock | null = null;
    const flush = () => {
      if (current) blocks.push(current);
      current = null;
    };
    for (let i = line.startIndex; i <= line.endIndex; i++) {
      const state = states[i];
      if (state?.status === 'cut') {
        flush();
        continue;
      }
      const occurrence = state?.occurrences[0];
      if (!occurrence) continue;
      const text = view.words[i]!.text;
      if (current) {
        current.endIndex = i;
        current.startMs = Math.min(current.startMs, occurrence.startMs);
        current.endMs = Math.max(current.endMs, occurrence.endMs);
        current.text = `${current.text} ${text}`;
      } else {
        current = {
          key: `${view.sourceId}:${i}`,
          sourceId: view.sourceId,
          startIndex: i,
          endIndex: i,
          startMs: occurrence.startMs,
          endMs: occurrence.endMs,
          text,
        };
      }
    }
    flush();
  }

  const cuts: TranscriptLayerCut[] = [];
  for (let i = 0; i < states.length; i++) {
    const run = cutRunAround(states, i);
    if (!run || run.startIndex !== i) continue;
    const atMs = seamPosition(view, run.startIndex, run.endIndex);
    if (atMs !== null) {
      cuts.push({
        key: `${view.sourceId}:cut:${run.startIndex}`,
        sourceId: view.sourceId,
        ...run,
        atMs,
      });
    }
    i = run.endIndex;
  }
  return { blocks, cuts };
}

/** End of the nearest kept word before the run, else start of the one after. */
function seamPosition(
  view: SourceTranscriptView,
  startIndex: number,
  endIndex: number,
): number | null {
  const states = view.states!;
  for (let i = startIndex - 1; i >= 0; i--) {
    const occurrence = states[i]?.occurrences[0];
    if (occurrence) return occurrence.endMs;
  }
  for (let i = endIndex + 1; i < states.length; i++) {
    const occurrence = states[i]?.occurrences[0];
    if (occurrence) return occurrence.startMs;
  }
  return null;
}
