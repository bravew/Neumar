import { normalizeClipPlayback } from './playback.js';
import { applyTimelineOp } from './timeline-ops.js';
import type {
  Timeline,
  TimelineClip,
  TimelineOp,
  TimelineTrack,
} from './timeline-types.js';

/**
 * Transcript-driven editing: a word range (source time) is compiled into
 * timeline ops, and a word's cut/kept state is derived from the timeline.
 * Pure functions, no I/O. See dev-doc/video-mode/21-10-12-transcript-layer.
 */

export interface TranscriptSourceMatch {
  /** Asset ids whose `asset` source refs belong to the transcribed source. */
  assetIds?: readonly string[];
  /** Source id matched against `linked` source refs. */
  sourceId?: string;
}

export interface TranscriptWordTiming {
  startMs: number;
  endMs: number;
}

export type TranscriptWordStatus = 'kept' | 'cut' | 'partial';

export interface TranscriptWordOccurrence {
  clipId: string;
  startMs: number;
  endMs: number;
}

export interface TranscriptWordState {
  index: number;
  status: TranscriptWordStatus;
  /** Timeline windows where the word plays; empty unless `kept`. */
  occurrences: TranscriptWordOccurrence[];
}

export interface CompileTranscriptCutInput {
  timeline: Timeline;
  match: TranscriptSourceMatch;
  words: readonly TranscriptWordTiming[];
  startIndex: number;
  endIndex: number;
  /** Close the gap on every touched track. Defaults to true. */
  magnetic?: boolean;
  idFactory?: () => string;
}

export type CompileTranscriptRestoreInput = Omit<
  CompileTranscriptCutInput,
  'idFactory'
>;

export type CompileTranscriptRestoreResult =
  | { ok: true; ops: TimelineOp[] }
  | { ok: false; reason: TranscriptRestoreFailure };

export type TranscriptRestoreFailure =
  | 'nothing-to-restore'
  | 'seam-not-found'
  | 'interior-gap'
  | 'no-room';

const ADJACENT_TOLERANCE_MS = 2;

export function clipMatchesTranscriptSource(
  clip: TimelineClip,
  match: TranscriptSourceMatch,
): boolean {
  if (clip.kind !== 'video' && clip.kind !== 'audio') return false;
  const ref = clip.sourceRef;
  if (ref.kind === 'asset')
    return match.assetIds?.includes(ref.assetId) ?? false;
  if (ref.kind === 'linked') return ref.sourceId === match.sourceId;
  return false;
}

/**
 * Map a source-time span to the timeline window it occupies inside `clip`,
 * honoring playback speed and reverse. Null when the clip never plays it.
 */
export function sourceSpanToTimelineWindow(
  clip: TimelineClip,
  sourceStartMs: number,
  sourceEndMs: number,
): { startMs: number; endMs: number } | null {
  const lo = Math.max(sourceStartMs, clip.trimStartMs);
  const hi = Math.min(sourceEndMs, clip.trimEndMs);
  if (hi <= lo) return null;
  const { speed, reverse } = normalizeClipPlayback(clip.playback);
  const at = (sourceMs: number) =>
    reverse
      ? clip.startMs + (clip.trimEndMs - sourceMs) / speed
      : clip.startMs + (sourceMs - clip.trimStartMs) / speed;
  const a = Math.round(at(reverse ? hi : lo));
  const b = Math.round(at(reverse ? lo : hi));
  return b > a ? { startMs: a, endMs: b } : null;
}

/**
 * Derive each word's state from the clips that play the source. Returns null
 * when no clip plays the source (the panel shows an empty state instead).
 */
export function deriveTranscriptWordStates(
  timeline: Timeline,
  match: TranscriptSourceMatch,
  words: readonly TranscriptWordTiming[],
): TranscriptWordState[] | null {
  const clips = matchingClips(timeline, match);
  if (clips.length === 0) return null;
  const union = mergeSpans(
    clips.map((clip) => ({ startMs: clip.trimStartMs, endMs: clip.trimEndMs })),
  );
  return words.map((word, index) => {
    const length = Math.max(0, word.endMs - word.startMs);
    const covered = union.reduce(
      (sum, span) =>
        sum +
        Math.max(
          0,
          Math.min(span.endMs, word.endMs) -
            Math.max(span.startMs, word.startMs),
        ),
      0,
    );
    const status: TranscriptWordStatus =
      covered <= 0 && length > 0
        ? 'cut'
        : covered >= length - 1
          ? 'kept'
          : 'partial';
    const occurrences: TranscriptWordOccurrence[] = [];
    if (status === 'kept') {
      for (const clip of clips) {
        if (word.startMs < clip.trimStartMs || word.endMs > clip.trimEndMs) {
          continue;
        }
        const window = sourceSpanToTimelineWindow(
          clip,
          word.startMs,
          word.endMs,
        );
        if (window) occurrences.push({ clipId: clip.id, ...window });
      }
      occurrences.sort((l, r) => l.startMs - r.startMs);
    }
    return { index, status, occurrences };
  });
}

/**
 * Compile a word-range cut into `clip.removeTimeRange` ops with explicit
 * before/after clips (deterministic replay). Video, audio and link-group
 * siblings (e.g. captions) are cut over the same timeline window.
 */
export function compileTranscriptCut(
  input: CompileTranscriptCutInput,
): TimelineOp[] {
  const span = wordSpan(input);
  const idFactory = input.idFactory ?? (() => globalThis.crypto.randomUUID());
  const magnetic = input.magnetic ?? true;
  const windows = mergeSpans(
    matchingClips(input.timeline, input.match).flatMap((clip) => {
      const window = sourceSpanToTimelineWindow(clip, span.startMs, span.endMs);
      return window ? [window] : [];
    }),
  ).sort((left, right) => right.startMs - left.startMs);

  let timeline = input.timeline;
  const ops: TimelineOp[] = [];
  for (const window of windows) {
    const linkedGroups = linkGroupsOf(matchingClips(timeline, input.match));
    const splitGroups = new Map<string, { left: string; right: string }>();
    const resolveSplit = (id: string) => {
      let existing = splitGroups.get(id);
      if (!existing) {
        existing = { left: idFactory(), right: idFactory() };
        splitGroups.set(id, existing);
      }
      return existing;
    };
    for (const track of timeline.tracks) {
      const touches = track.clips.some(
        (clip) =>
          overlaps(clip, window.startMs, window.endMs) &&
          (clipMatchesTranscriptSource(clip, input.match) ||
            (clip.linkGroupId !== undefined &&
              linkedGroups.has(clip.linkGroupId))),
      );
      if (!touches) continue;
      const replacement = buildCutReplacement(
        track,
        window.startMs,
        window.endMs,
        magnetic,
        idFactory,
        resolveSplit,
      );
      if (replacement.before.length === 0) continue;
      const op: TimelineOp = {
        kind: 'clip.removeTimeRange',
        trackId: track.id,
        startMs: window.startMs,
        endMs: window.endMs,
        magnetic,
        before: replacement.before,
        after: replacement.after,
      };
      timeline = applyTimelineOp(timeline, op).timeline;
      ops.push(op);
    }
  }
  return ops;
}

/**
 * Restore a previously cut word range by extending the clip on one side of the
 * seam back over the removed source span. Only the whole gap, or the part of it
 * touching a seam edge, can be restored; an interior sub-range cannot.
 */
export function compileTranscriptRestore(
  input: CompileTranscriptRestoreInput,
): CompileTranscriptRestoreResult {
  const span = wordSpan(input);
  const magnetic = input.magnetic ?? true;
  const primaries = matchingClips(input.timeline, input.match);
  const ops: TimelineOp[] = [];
  const handledGroups = new Set<string>();
  let sawGap = false;
  let failure: TranscriptRestoreFailure = 'seam-not-found';

  const byTrack = new Map<string, TimelineClip[]>();
  for (const clip of primaries) {
    const trackId = trackIdOf(input.timeline, clip.id);
    byTrack.set(trackId, [...(byTrack.get(trackId) ?? []), clip]);
  }
  for (const [trackId, clips] of byTrack) {
    const ordered = [...clips].sort((l, r) => l.startMs - r.startMs);
    const trackClips =
      input.timeline.tracks.find((t) => t.id === trackId)?.clips ?? [];
    // i = -1 handles a leading cut (no clip before the gap); the last index
    // handles a trailing cut (no clip after it).
    for (let i = -1; i < ordered.length; i++) {
      const a = ordered[i];
      const b = ordered[i + 1];
      if (!a && !b) continue;
      if (a && normalizeClipPlayback(a.playback).reverse) continue;
      if (b && normalizeClipPlayback(b.playback).reverse) continue;
      const gapStart = a ? a.trimEndMs : 0;
      const gapEnd = b ? b.trimStartMs : span.endMs;
      if (gapEnd <= gapStart) continue;
      if (a && gapStart > span.startMs + ADJACENT_TOLERANCE_MS) continue;
      if (b && gapEnd < span.endMs - ADJACENT_TOLERANCE_MS) continue;
      if (!a && gapEnd > span.endMs + ADJACENT_TOLERANCE_MS) continue;
      sawGap = true;
      const touchesA =
        Boolean(a) && span.startMs <= gapStart + ADJACENT_TOLERANCE_MS;
      const touchesB =
        Boolean(b) && span.endMs >= gapEnd - ADJACENT_TOLERANCE_MS;
      if (!touchesA && !touchesB) {
        failure = 'interior-gap';
        continue;
      }
      const target = (touchesA ? a : b)!;
      if (target.linkGroupId && handledGroups.has(target.linkGroupId)) continue;
      const restoredSourceMs = touchesA
        ? Math.min(span.endMs, gapEnd) - gapStart
        : gapEnd - Math.max(span.startMs, gapStart);
      const speed = normalizeClipPlayback(target.playback).speed;
      const addMs = Math.round(restoredSourceMs / speed);
      if (addMs <= 0) continue;
      if (!magnetic) {
        const targetEnd = target.startMs + target.durationMs;
        const room = touchesA
          ? (b ? b.startMs : Number.POSITIVE_INFINITY) - targetEnd
          : target.startMs -
            trackClips
              .filter((c) => c.id !== target.id && c.startMs < target.startMs)
              .reduce((m, c) => Math.max(m, c.startMs + c.durationMs), 0);
        if (room < addMs) {
          failure = 'no-room';
          continue;
        }
      }
      const from = timing(target);
      const to = touchesA
        ? {
            ...from,
            durationMs: from.durationMs + addMs,
            trimEndMs: from.trimEndMs + Math.round(restoredSourceMs),
          }
        : {
            ...from,
            startMs: Math.max(0, from.startMs - addMs),
            durationMs: from.durationMs + addMs,
            trimStartMs: from.trimStartMs - Math.round(restoredSourceMs),
          };
      ops.push({
        kind: 'clip.trim',
        clipId: target.id,
        from,
        to,
        magnetic,
      });
      if (target.linkGroupId) handledGroups.add(target.linkGroupId);
    }
  }
  if (ops.length === 0) {
    return { ok: false, reason: sawGap ? failure : 'seam-not-found' };
  }
  return { ok: true, ops };
}

function wordSpan(input: {
  words: readonly TranscriptWordTiming[];
  startIndex: number;
  endIndex: number;
}): { startMs: number; endMs: number } {
  const first = input.words[input.startIndex];
  const last = input.words[input.endIndex];
  if (!first || !last || input.endIndex < input.startIndex) {
    throw new Error(
      `Invalid transcript word range ${input.startIndex}-${input.endIndex}`,
    );
  }
  return { startMs: first.startMs, endMs: last.endMs };
}

function matchingClips(
  timeline: Timeline,
  match: TranscriptSourceMatch,
): TimelineClip[] {
  return timeline.tracks.flatMap((track) =>
    track.clips.filter((clip) => clipMatchesTranscriptSource(clip, match)),
  );
}

function linkGroupsOf(clips: readonly TimelineClip[]): Set<string> {
  const groups = new Set<string>();
  for (const clip of clips) {
    if (clip.linkGroupId) groups.add(clip.linkGroupId);
  }
  return groups;
}

function trackIdOf(timeline: Timeline, clipId: string): string {
  return (
    timeline.tracks.find((track) => track.clips.some((c) => c.id === clipId))
      ?.id ?? ''
  );
}

function mergeSpans(
  spans: readonly { startMs: number; endMs: number }[],
): { startMs: number; endMs: number }[] {
  const sorted = [...spans].sort((l, r) => l.startMs - r.startMs);
  const out: { startMs: number; endMs: number }[] = [];
  for (const span of sorted) {
    const last = out[out.length - 1];
    if (last && span.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, span.endMs);
    } else {
      out.push({ ...span });
    }
  }
  return out;
}

function overlaps(clip: TimelineClip, startMs: number, endMs: number): boolean {
  return clip.startMs < endMs && clip.startMs + clip.durationMs > startMs;
}

function timing(clip: TimelineClip) {
  return {
    startMs: clip.startMs,
    durationMs: clip.durationMs,
    trimStartMs: clip.trimStartMs,
    trimEndMs: clip.trimEndMs,
  };
}

function buildCutReplacement(
  track: TimelineTrack,
  startMs: number,
  endMs: number,
  magnetic: boolean,
  idFactory: () => string,
  resolveSplit: (linkGroupId: string) => { left: string; right: string },
): { before: TimelineClip[]; after: TimelineClip[] } {
  const removedMs = endMs - startMs;
  const before: TimelineClip[] = [];
  const after: TimelineClip[] = [];
  for (const clip of track.clips) {
    const clipEnd = clip.startMs + clip.durationMs;
    const intersects = overlaps(clip, startMs, endMs);
    if (!intersects && !(magnetic && clip.startMs >= endMs)) continue;
    before.push(clip);
    if (!intersects) {
      after.push({ ...clip, startMs: Math.max(0, clip.startMs - removedMs) });
      continue;
    }
    if (startMs <= clip.startMs && endMs >= clipEnd) continue;

    const { speed, reverse } = normalizeClipPlayback(clip.playback);
    const split =
      clip.startMs < startMs && clipEnd > endMs && clip.linkGroupId
        ? resolveSplit(clip.linkGroupId)
        : null;

    if (clip.startMs < startMs) {
      const durationMs = startMs - clip.startMs;
      const sourceMs = Math.round(durationMs * speed);
      after.push(
        withLinkGroup(
          {
            ...clip,
            durationMs,
            ...(reverse
              ? { trimStartMs: clip.trimEndMs - sourceMs }
              : { trimEndMs: clip.trimStartMs + sourceMs }),
          },
          split?.left ?? clip.linkGroupId,
        ),
      );
    }
    if (clipEnd > endMs) {
      const skippedMs = Math.max(0, endMs - clip.startMs);
      const sourceMs = Math.round(skippedMs * speed);
      after.push(
        withLinkGroup(
          {
            ...clip,
            id: clip.startMs < startMs ? idFactory() : clip.id,
            startMs: magnetic ? startMs : endMs,
            durationMs: clipEnd - endMs,
            ...(reverse
              ? { trimEndMs: clip.trimEndMs - sourceMs }
              : { trimStartMs: clip.trimStartMs + sourceMs }),
          },
          split?.right ?? clip.linkGroupId,
        ),
      );
    }
  }
  return { before, after };
}

function withLinkGroup<T extends TimelineClip>(
  clip: T,
  linkGroupId: string | undefined,
): T {
  if (linkGroupId) return { ...clip, linkGroupId };
  const { linkGroupId: _omit, ...rest } = clip;
  return rest as T;
}
