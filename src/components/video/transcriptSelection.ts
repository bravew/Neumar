import type {
  VideoProject,
  VideoSubtitleWord,
  VideoTimelineClip,
  VideoTranscriptSelectionContext,
} from '@/shared/types/video';

export interface TranscriptSelectionTimingContext {
  sceneId: string;
  clipId?: string;
  sourceId?: string;
  sceneStartMs: number;
  sceneDurationMs: number;
  clipStartMs?: number;
  trimStartMs?: number;
  wordIndexOffset?: number;
  words?: VideoSubtitleWord[];
}

export function buildTranscriptTimingContexts(input: {
  project: VideoProject;
  sceneStartByIdMs: ReadonlyMap<string, number>;
}): Map<string, TranscriptSelectionTimingContext> {
  const out = new Map<string, TranscriptSelectionTimingContext>();
  const sceneDurationById = new Map(
    (input.project.storyboard?.scenes ?? []).map((scene) => [
      scene.id,
      Math.max(1, scene.durationMs),
    ]),
  );
  for (const [sceneId, sceneStartMs] of input.sceneStartByIdMs) {
    out.set(sceneId, {
      sceneId,
      sceneStartMs,
      sceneDurationMs: sceneDurationById.get(sceneId) ?? 1,
    });
  }

  const sourceIdByAssetId = new Map(
    (input.project.sources ?? []).map((source) => [
      source.mediaItemId,
      source.id,
    ]),
  );
  const analysisBySourceId = new Map(
    (input.project.sourceAnalyses ?? []).map((analysis) => [
      analysis.sourceId,
      analysis,
    ]),
  );

  for (const track of input.project.timeline?.tracks ?? []) {
    for (const clip of track.clips) {
      const context = buildClipTimingContext({
        clip,
        sceneDurationById,
        sceneStartByIdMs: input.sceneStartByIdMs,
        sourceIdByAssetId,
        analysisBySourceId,
      });
      if (!context) continue;
      const existing = out.get(context.sceneId);
      if (
        !existing ||
        (!hasWordAnchors(existing) &&
          (hasWordAnchors(context) || !existing.clipId))
      ) {
        out.set(context.sceneId, context);
      }
    }
  }
  return out;
}

export function resolveTranscriptSelection(
  context: TranscriptSelectionTimingContext,
  value: string,
  selectionStart: number,
  selectionEnd: number,
): VideoTranscriptSelectionContext | null {
  const normalized = trimSelection(value, selectionStart, selectionEnd);
  if (!normalized) return null;
  const wordSelection = resolveWordSelection(context, normalized.text);
  if (wordSelection) return wordSelection;
  return resolveProportionalSelection(context, normalized);
}

export function hasWordAnchors(
  context: TranscriptSelectionTimingContext | undefined,
): boolean {
  return Boolean(context?.words?.length && context.clipStartMs !== undefined);
}

function resolveWordSelection(
  context: TranscriptSelectionTimingContext,
  text: string,
): VideoTranscriptSelectionContext | null {
  if (!context.words?.length || context.clipStartMs === undefined) return null;
  const selectedTokens = tokenize(text);
  if (selectedTokens.length === 0) return null;
  const wordTokens = context.words.map((word) => normalizeToken(word.text));
  const startIndex = findTokenSequence(wordTokens, selectedTokens);
  if (startIndex < 0) return null;
  const endIndex = startIndex + selectedTokens.length - 1;
  const firstWord = context.words[startIndex];
  const lastWord = context.words[endIndex];
  if (!firstWord || !lastWord) return null;
  const trimStartMs = context.trimStartMs ?? 0;
  const startMs = Math.max(
    0,
    Math.round(context.clipStartMs + firstWord.startMs - trimStartMs),
  );
  const endMs = Math.max(
    startMs + 1,
    Math.round(context.clipStartMs + lastWord.endMs - trimStartMs),
  );
  return {
    sceneId: context.sceneId,
    clipId: context.clipId,
    sourceId: context.sourceId,
    startMs,
    endMs,
    text,
    source: 'word',
    wordStartIndex: (context.wordIndexOffset ?? 0) + startIndex,
    wordEndIndex: (context.wordIndexOffset ?? 0) + endIndex,
  };
}

function buildClipTimingContext(input: {
  clip: VideoTimelineClip;
  sceneDurationById: ReadonlyMap<string, number>;
  sceneStartByIdMs: ReadonlyMap<string, number>;
  sourceIdByAssetId: ReadonlyMap<string, string>;
  analysisBySourceId: ReadonlyMap<
    string,
    { transcript?: { words: VideoSubtitleWord[] } }
  >;
}): TranscriptSelectionTimingContext | null {
  const sceneId = input.clip.sceneId;
  if (!sceneId) return null;
  const sourceId = sourceIdForClip(input.clip, input.sourceIdByAssetId);
  const words = sourceId
    ? input.analysisBySourceId.get(sourceId)?.transcript?.words
    : undefined;
  const clipWords = words ? wordsForClip(input.clip, words) : undefined;
  return {
    sceneId,
    clipId: input.clip.id,
    sourceId,
    sceneStartMs: input.sceneStartByIdMs.get(sceneId) ?? input.clip.startMs,
    sceneDurationMs:
      input.sceneDurationById.get(sceneId) ??
      Math.max(1, input.clip.durationMs),
    clipStartMs: input.clip.startMs,
    trimStartMs: input.clip.trimStartMs,
    wordIndexOffset: clipWords?.offset,
    words: clipWords?.words,
  };
}

function sourceIdForClip(
  clip: VideoTimelineClip,
  sourceIdByAssetId: ReadonlyMap<string, string>,
): string | undefined {
  if (clip.sourceRef.kind === 'linked') return clip.sourceRef.sourceId;
  if (clip.sourceRef.kind === 'asset') {
    return sourceIdByAssetId.get(clip.sourceRef.assetId);
  }
  return undefined;
}

function wordsForClip(
  clip: VideoTimelineClip,
  words: readonly VideoSubtitleWord[],
): { words: VideoSubtitleWord[]; offset: number } {
  const startIndex = words.findIndex(
    (word) => word.endMs > clip.trimStartMs && word.startMs < clip.trimEndMs,
  );
  if (startIndex < 0) return { words: [], offset: 0 };
  const selected = words
    .slice(startIndex)
    .filter(
      (word) => word.endMs > clip.trimStartMs && word.startMs < clip.trimEndMs,
    );
  return { words: selected, offset: startIndex };
}

function resolveProportionalSelection(
  context: TranscriptSelectionTimingContext,
  selection: {
    startOffset: number;
    endOffset: number;
    text: string;
    valueLength: number;
  },
): VideoTranscriptSelectionContext {
  const sceneDurationMs = Math.max(1, context.sceneDurationMs);
  const textLength = Math.max(1, selection.valueLength);
  const startMs =
    context.sceneStartMs +
    Math.floor((selection.startOffset / textLength) * sceneDurationMs);
  const endMs = Math.min(
    context.sceneStartMs + sceneDurationMs,
    Math.max(
      startMs + 1,
      context.sceneStartMs +
        Math.ceil((selection.endOffset / textLength) * sceneDurationMs),
    ),
  );
  return {
    sceneId: context.sceneId,
    clipId: context.clipId,
    sourceId: context.sourceId,
    startMs,
    endMs,
    text: selection.text,
    source: 'proportional',
    degraded: true,
  };
}

function trimSelection(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): {
  startOffset: number;
  endOffset: number;
  text: string;
  valueLength: number;
} | null {
  let startOffset = Math.min(selectionStart, selectionEnd);
  let endOffset = Math.max(selectionStart, selectionEnd);

  while (startOffset < endOffset && value[startOffset]?.trim().length === 0) {
    startOffset += 1;
  }
  while (endOffset > startOffset && value[endOffset - 1]?.trim().length === 0) {
    endOffset -= 1;
  }
  if (startOffset >= endOffset) return null;
  return {
    startOffset,
    endOffset,
    text: value.slice(startOffset, endOffset),
    valueLength: value.length,
  };
}

function findTokenSequence(
  tokens: readonly string[],
  selected: readonly string[],
): number {
  if (selected.length > tokens.length) return -1;
  for (let index = 0; index <= tokens.length - selected.length; index++) {
    const matches = selected.every(
      (token, offset) => tokens[index + offset] === token,
    );
    if (matches) return index;
  }
  return -1;
}

function tokenize(value: string): string[] {
  return value.split(/\s+/).map(normalizeToken).filter(Boolean);
}

function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}
