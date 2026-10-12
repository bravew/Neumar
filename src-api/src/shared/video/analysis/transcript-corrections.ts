import { deriveTranscriptWordStates } from '@neumar/video-ir';

import { STT_CAPTION_ORIGIN } from '../caption-retime';
import type { CaptionTimelineClip, SubtitleWord, VideoProject } from '../types';

export interface TranscriptWordCorrection {
  index: number;
  text: string;
  /** Consistency check: must equal the stored word's `startMs`. */
  startMs: number;
  /** Compare-and-swap guard independent of unrelated project autosaves. */
  expectedText: string;
}

export type TranscriptCorrectionErrorCode =
  | 'source-not-found'
  | 'no-transcript'
  | 'stale-word';

export class TranscriptCorrectionError extends Error {
  constructor(
    readonly code: TranscriptCorrectionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TranscriptCorrectionError';
  }
}

export interface TranscriptCorrectionResult {
  project: VideoProject;
  /** Caption cues whose words were re-derived from the corrected transcript. */
  captionsUpdated: number;
}

/** A caption word lines up with a source word if both edges are within this. */
const CAPTION_MATCH_TOLERANCE_MS = 2;

/**
 * Apply sparse text corrections to a source's cached transcript. Timings never
 * change. Captions generated from the transcript carry their own copy of each
 * word, so the corrected words are mirrored into any cue that still plays them.
 */
export function applyTranscriptCorrections(
  project: VideoProject,
  sourceId: string,
  corrections: readonly TranscriptWordCorrection[],
): TranscriptCorrectionResult {
  const source = (project.sources ?? []).find((item) => item.id === sourceId);
  if (!source) {
    throw new TranscriptCorrectionError('source-not-found', 'Source not found');
  }
  const analysis = (project.sourceAnalyses ?? []).find(
    (item) => item.sourceId === sourceId,
  );
  const words = analysis?.transcript?.words;
  if (!analysis || !words?.length) {
    throw new TranscriptCorrectionError(
      'no-transcript',
      'Source has no word-timed transcript',
    );
  }

  const nextWords: SubtitleWord[] = [...words];
  const changed: Array<{ index: number; from: string; to: string }> = [];
  for (const correction of corrections) {
    const current = nextWords[correction.index];
    if (
      !current ||
      current.startMs !== correction.startMs ||
      current.text !== correction.expectedText
    ) {
      throw new TranscriptCorrectionError(
        'stale-word',
        `Transcript word ${correction.index} changed since it was loaded`,
      );
    }
    if (current.text === correction.text) continue;
    changed.push({
      index: correction.index,
      from: current.text,
      to: correction.text,
    });
    nextWords[correction.index] = { ...current, text: correction.text };
  }
  if (changed.length === 0) return { project, captionsUpdated: 0 };

  const transcript = {
    ...analysis.transcript!,
    words: nextWords,
    segments: analysis.transcript!.segments?.map((segment) => ({
      ...segment,
      text: segmentText(segment, nextWords, segment.text),
    })),
  };
  const sourceAnalyses = (project.sourceAnalyses ?? []).map((item) =>
    item === analysis ? { ...item, transcript } : item,
  );

  const { timeline, captionsUpdated } = mirrorIntoCaptions(
    project,
    source.mediaItemId,
    source.id,
    words,
    changed,
  );
  return {
    project: {
      ...project,
      sourceAnalyses,
      ...(timeline ? { timeline } : {}),
      updatedAt: new Date().toISOString(),
    },
    captionsUpdated,
  };
}

function captionBelongsToSource(
  clip: CaptionTimelineClip,
  sourceId: string,
  mediaItemId: string,
): boolean {
  if (clip.params?.origin !== STT_CAPTION_ORIGIN) return false;
  const anchor = clip.sourceAnchor;
  const ref = clip.sourceRef;
  // All provenance supplied by the generated cue must agree. Timings and
  // text alone are never enough to establish which source produced a cue.
  return (
    clip.params.sourceId === sourceId &&
    anchor?.sourceMediaId === mediaItemId &&
    anchor.sourceElementId === sourceId &&
    ((ref.kind === 'asset' && ref.assetId === mediaItemId) ||
      (ref.kind === 'linked' && ref.sourceId === sourceId))
  );
}

/** Rebuild a segment's text from its words; keep the original if none fall in. */
function segmentText(
  segment: { startMs: number; endMs: number },
  words: readonly SubtitleWord[],
  fallback: string,
): string {
  const inside = words.filter(
    (word) => word.startMs >= segment.startMs && word.endMs <= segment.endMs,
  );
  return inside.length > 0
    ? inside
        .map((word) => word.text)
        .filter(Boolean)
        .join(' ')
    : fallback;
}

function mirrorIntoCaptions(
  project: VideoProject,
  mediaItemId: string,
  sourceId: string,
  originalWords: readonly SubtitleWord[],
  changed: ReadonlyArray<{ index: number; from: string; to: string }>,
): {
  timeline: NonNullable<VideoProject['timeline']> | undefined;
  captionsUpdated: number;
} {
  const timeline = project.timeline;
  if (!timeline) return { timeline, captionsUpdated: 0 };
  const states = deriveTranscriptWordStates(
    timeline,
    { assetIds: [mediaItemId], sourceId },
    originalWords,
  );
  if (!states) return { timeline, captionsUpdated: 0 };

  const touched = new Set<string>();
  const tracks = timeline.tracks.map((track) => ({
    ...track,
    clips: track.clips.map((clip) => {
      if (
        clip.kind !== 'caption' ||
        !clip.words?.length ||
        !captionBelongsToSource(clip, sourceId, mediaItemId)
      )
        return clip;
      const originalText = clip.words
        .map((word) => word.text)
        .filter(Boolean)
        .join(' ');
      const words = clip.words.map((word) => {
        for (const change of changed) {
          const hit = states[change.index]?.occurrences.some(
            (occurrence) =>
              Math.abs(occurrence.startMs - word.startMs) <=
                CAPTION_MATCH_TOLERANCE_MS &&
              Math.abs(occurrence.endMs - word.endMs) <=
                CAPTION_MATCH_TOLERANCE_MS,
          );
          if (hit && word.text === change.from) {
            return { ...word, text: change.to };
          }
        }
        return word;
      });
      if (words.every((word, i) => word === clip.words![i])) return clip;
      touched.add(clip.id);
      // Only rewrite the cue text when it is the plain join of its words;
      // otherwise the cue was hand-edited and we leave its text alone.
      const text =
        clip.text === originalText
          ? words
              .map((word) => word.text)
              .filter(Boolean)
              .join(' ')
          : clip.text;
      return { ...clip, words, text };
    }),
  }));
  return {
    timeline: { ...timeline, tracks } as NonNullable<VideoProject['timeline']>,
    captionsUpdated: touched.size,
  };
}
