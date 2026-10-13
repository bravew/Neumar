import type { TranscriptWordOccurrence } from '@neumar/video-ir';

import type { SourceTranscriptView } from './sourceTranscriptView';
import { cutRunAround, groupWordsIntoLines } from './sourceTranscriptView';

export interface TranscriptLayerBlock {
  key: string;
  sourceId: string;
  clipId: string;
  startIndex: number;
  endIndex: number;
  startMs: number;
  endMs: number;
  text: string;
}

export interface TranscriptLayerCut {
  key: string;
  sourceId: string;
  startIndex: number;
  endIndex: number;
  atMs: number;
}

export interface TranscriptLayer {
  blocks: TranscriptLayerBlock[];
  cuts: TranscriptLayerCut[];
}

/** Build sentence blocks per clip occurrence; never bridge other media or gaps. */
export function buildTranscriptLayer(
  view: SourceTranscriptView,
): TranscriptLayer {
  const states = view.states;
  if (!states) return { blocks: [], cuts: [] };
  const blocks: TranscriptLayerBlock[] = [];
  for (const line of groupWordsIntoLines(view.words)) {
    const byClip = new Map<
      string,
      Array<TranscriptWordOccurrence & { index: number }>
    >();
    for (let i = line.startIndex; i <= line.endIndex; i++) {
      for (const occurrence of states[i]?.occurrences ?? []) {
        const items = byClip.get(occurrence.clipId) ?? [];
        items.push({ ...occurrence, index: i });
        byClip.set(occurrence.clipId, items);
      }
    }
    for (const [clipId, items] of byClip) {
      items.sort((a, b) => a.startMs - b.startMs);
      let block: TranscriptLayerBlock | null = null;
      let lastIndex: number | null = null;
      for (const item of items) {
        if (
          block &&
          lastIndex !== null &&
          Math.abs(item.index - lastIndex) === 1 &&
          item.startMs - block.endMs < 700
        ) {
          block.startIndex = Math.min(block.startIndex, item.index);
          block.endIndex = Math.max(block.endIndex, item.index);
          block.endMs = item.endMs;
          block.text += ` ${view.words[item.index]!.text}`;
        } else {
          block = {
            key: `${view.sourceId}:${clipId}:${item.index}`,
            sourceId: view.sourceId,
            clipId,
            startIndex: item.index,
            endIndex: item.index,
            startMs: item.startMs,
            endMs: item.endMs,
            text: view.words[item.index]!.text,
          };
          blocks.push(block);
        }
        lastIndex = item.index;
      }
    }
  }
  const cuts: TranscriptLayerCut[] = [];
  for (let i = 0; i < states.length; i++) {
    const run = cutRunAround(states, i);
    if (!run || run.startIndex !== i) continue;
    let before: readonly TranscriptWordOccurrence[] = [];
    let after: readonly TranscriptWordOccurrence[] = [];
    for (let j = run.startIndex - 1; j >= 0 && !before.length; j--)
      before = states[j]?.occurrences ?? [];
    for (let j = run.endIndex + 1; j < states.length && !after.length; j++)
      after = states[j]?.occurrences ?? [];
    const positions = before.length
      ? before.map((o) => o.endMs)
      : after.map((o) => o.startMs);
    for (const atMs of new Set(positions))
      cuts.push({
        key: `${view.sourceId}:cut:${i}:${atMs}`,
        sourceId: view.sourceId,
        ...run,
        atMs,
      });
    i = run.endIndex;
  }
  return { blocks: blocks.sort((a, b) => a.startMs - b.startMs), cuts };
}
