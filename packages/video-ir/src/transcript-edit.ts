import { EditBuilderError } from './edit-builders.js';
import { normalizeClipPlayback } from './playback.js';
import { applyTimelineOp } from './timeline-ops.js';
import type {
  CaptionTimelineClip,
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
  /** Text is needed to rebuild generated captions when restoring speech. */
  text?: string;
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
  | 'no-room'
  | 'track-locked'
  | 'caption-unavailable';

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
    const sourceClips = matchingClips(timeline, input.match);
    const linkedGroups = linkGroupsOf(sourceClips);
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
              linkedGroups.has(clip.linkGroupId)) ||
            captionMatchesSource(clip, input.match)),
      );
      if (!touches) continue;
      if (track.locked) {
        throw new EditBuilderError('Track is locked', 'track_locked', {
          trackId: track.id,
        });
      }
      const replacement = buildCutReplacement(
        track,
        window.startMs,
        window.endMs,
        magnetic,
        idFactory,
        resolveSplit,
        sourceClips,
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
  let timeline = input.timeline;
  const ops: TimelineOp[] = [];
  const handled = new Set<string>();
  const primaries = matchingClips(timeline, input.match);
  let failure: TranscriptRestoreFailure = 'seam-not-found';
  for (const track of timeline.tracks) {
    const ordered = primaries
      .filter((clip) => track.clips.some((item) => item.id === clip.id))
      .sort((l, r) => l.startMs - r.startMs);
    for (let i = -1; i < ordered.length; i++) {
      const a = ordered[i];
      const b = ordered[i + 1];
      const host = a ?? b;
      if (!host) continue;
      const { speed, reverse } = normalizeClipPlayback(host.playback);
      const gapStart = reverse ? (b?.trimEndMs ?? 0) : (a?.trimEndMs ?? 0);
      const gapEnd = reverse
        ? (a?.trimStartMs ?? span.endMs)
        : (b?.trimStartMs ?? span.endMs);
      if (
        gapEnd <= gapStart ||
        span.startMs < gapStart - ADJACENT_TOLERANCE_MS ||
        span.endMs > gapEnd + ADJACENT_TOLERANCE_MS
      )
        continue;
      if (a && b) {
        const other = normalizeClipPlayback(b.playback);
        if (other.speed !== speed || other.reverse !== reverse)
          return { ok: false, reason: 'seam-not-found' };
        // Source neighbors must also still form a timeline seam. A moved or
        // occupied seam cannot be restored by guessing where content belongs.
        if (
          magnetic &&
          Math.abs(b.startMs - a.startMs - a.durationMs) > ADJACENT_TOLERANCE_MS
        )
          return { ok: false, reason: 'seam-not-found' };
        if (
          track.clips.some(
            (clip) =>
              clip.id !== a.id &&
              clip.id !== b.id &&
              overlaps(
                clip,
                a.startMs + a.durationMs - ADJACENT_TOLERANCE_MS,
                b.startMs + ADJACENT_TOLERANCE_MS,
              ),
          )
        )
          return { ok: false, reason: 'seam-not-found' };
      }
      if (
        a &&
        b &&
        !magnetic &&
        Math.abs(
          b.startMs - a.startMs - a.durationMs - (gapEnd - gapStart) / speed,
        ) > ADJACENT_TOLERANCE_MS
      )
        return { ok: false, reason: 'seam-not-found' };
      const touchesA =
        Boolean(a) &&
        (reverse
          ? span.endMs >= gapEnd - ADJACENT_TOLERANCE_MS
          : span.startMs <= gapStart + ADJACENT_TOLERANCE_MS);
      const touchesB =
        Boolean(b) &&
        (reverse
          ? span.startMs <= gapStart + ADJACENT_TOLERANCE_MS
          : span.endMs >= gapEnd - ADJACENT_TOLERANCE_MS);
      if (!touchesA && !touchesB) {
        failure = 'interior-gap';
        continue;
      }
      const target = (touchesA ? a : b)!;
      const group = target.linkGroupId ?? target.id;
      if (handled.has(group)) continue;
      const restoredStart = reverse
        ? touchesA
          ? span.startMs
          : gapStart
        : touchesA
          ? gapStart
          : span.startMs;
      const restoredEnd = reverse
        ? touchesA
          ? gapEnd
          : span.endMs
        : touchesA
          ? span.endMs
          : gapEnd;
      const addMs = Math.round((restoredEnd - restoredStart) / speed);
      if (addMs <= 0) continue;
      const fromEnd = target.startMs + target.durationMs;
      const targets = timeline.tracks.flatMap((t) =>
        t.clips.filter(
          (c) =>
            c.id === target.id ||
            (target.linkGroupId && c.linkGroupId === target.linkGroupId),
        ),
      );
      // Generated STT cues carry source anchors and params even when they hold
      // no link group, and a cut can split one cue into several fragments along
      // the same seam. Extend every cue sitting at this seam's source and
      // timeline edge, and fail when the source once had a cue on that seam but
      // no longer does — a restore that leaves the captions out of sync with
      // the restored speech must not report success.
      for (const captions of timeline.tracks) {
        if (captions.kind !== 'caption') continue;
        const sourced = captions.clips.filter((cue) =>
          captionMatchesSource(cue, input.match),
        );
        if (!sourced.length && captions.clips.length) continue;
        const seam = sourced.filter((cue) => {
          const sourceEdge = touchesA
            ? reverse
              ? cue.trimStartMs
              : cue.trimEndMs
            : reverse
              ? cue.trimEndMs
              : cue.trimStartMs;
          const targetEdge = touchesA
            ? reverse
              ? target.trimStartMs
              : target.trimEndMs
            : reverse
              ? target.trimEndMs
              : target.trimStartMs;
          const timelineEdge = touchesA
            ? cue.startMs + cue.durationMs
            : cue.startMs;
          const targetTimelineEdge = touchesA ? fromEnd : target.startMs;
          return (
            Math.abs(sourceEdge - targetEdge) <= ADJACENT_TOLERANCE_MS &&
            Math.abs(timelineEdge - targetTimelineEdge) <= ADJACENT_TOLERANCE_MS
          );
        });
        if (!seam.length) return { ok: false, reason: 'caption-unavailable' };
        for (const cue of seam)
          if (!targets.some((item) => item.id === cue.id)) targets.push(cue);
      }
      const targetIds = new Set(targets.map((c) => c.id));
      const replacements: TimelineOp[] = [];
      for (const affected of timeline.tracks) {
        if (!affected.clips.some((c) => targetIds.has(c.id))) continue;
        if (affected.locked) return { ok: false, reason: 'track-locked' };
        const before: TimelineClip[] = [];
        const after: TimelineClip[] = [];
        for (const clip of affected.clips) {
          if (targetIds.has(clip.id)) {
            const extendingAtEnd = touchesA;
            const nextStart =
              extendingAtEnd || magnetic ? clip.startMs : clip.startMs - addMs;
            const nextEnd = nextStart + clip.durationMs + addMs;
            if (
              nextStart < 0 ||
              (!magnetic &&
                affected.clips.some(
                  (other) =>
                    !targetIds.has(other.id) &&
                    overlaps(other, nextStart, nextEnd),
                ))
            )
              return { ok: false, reason: 'no-room' };
            const next = {
              ...clip,
              startMs: nextStart,
              durationMs: clip.durationMs + addMs,
              trimStartMs: reverse
                ? extendingAtEnd
                  ? restoredStart
                  : clip.trimStartMs
                : extendingAtEnd
                  ? clip.trimStartMs
                  : restoredStart,
              trimEndMs: reverse
                ? extendingAtEnd
                  ? clip.trimEndMs
                  : restoredEnd
                : extendingAtEnd
                  ? restoredEnd
                  : clip.trimEndMs,
            };
            before.push(clip);
            after.push(rebuildCaption(next, input.words, speed, reverse));
          } else if (
            magnetic &&
            clip.startMs >= fromEnd - ADJACENT_TOLERANCE_MS
          ) {
            before.push(clip);
            after.push(shiftCaption(clip, addMs));
          }
        }
        replacements.push({
          kind: 'clip.removeTimeRange',
          trackId: affected.id,
          startMs: target.startMs,
          endMs: target.startMs + addMs,
          magnetic: false,
          before,
          after,
        });
      }
      // Explicit snapshots ripple each linked track exactly once, unlike
      // linked clip.trim, which extends siblings without moving their tails.
      for (const op of replacements)
        timeline = applyTimelineOp(timeline, op).timeline;
      ops.push(...replacements);
      handled.add(group);
    }
  }
  return ops.length ? { ok: true, ops } : { ok: false, reason: failure };
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

function buildCutReplacement(
  track: TimelineTrack,
  startMs: number,
  endMs: number,
  magnetic: boolean,
  idFactory: () => string,
  resolveSplit: (linkGroupId: string) => { left: string; right: string },
  sourceClips: readonly TimelineClip[],
): { before: TimelineClip[]; after: TimelineClip[] } {
  const removedMs = endMs - startMs;
  const before: TimelineClip[] = [];
  const after: TimelineClip[] = [];
  const originals = new Map<string, TimelineClip>();
  for (const clip of track.clips) {
    const clipEnd = clip.startMs + clip.durationMs;
    const intersects = overlaps(clip, startMs, endMs);
    if (!intersects && !(magnetic && clip.startMs >= endMs)) continue;
    before.push(clip);
    if (!intersects) {
      after.push(shiftCaption(clip, -removedMs));
      continue;
    }
    if (startMs <= clip.startMs && endMs >= clipEnd) continue;

    const primary = clip.linkGroupId
      ? sourceClips.find((source) => source.linkGroupId === clip.linkGroupId)
      : clip.kind === 'caption'
        ? sourceClips.find(
            (source) =>
              captionMatchesSource(clip, sourceMatch(source)) &&
              overlaps(source, clip.startMs, clip.startMs + clip.durationMs),
          )
        : undefined;
    const { reverse } = normalizeClipPlayback(
      primary?.playback ?? clip.playback,
    );
    const speed =
      clip.kind === 'caption' && clip.durationMs > 0
        ? (clip.trimEndMs - clip.trimStartMs) / clip.durationMs
        : normalizeClipPlayback(clip.playback).speed;
    const append = (next: TimelineClip) => {
      originals.set(next.id, clip);
      after.push(next);
    };
    const split =
      clip.startMs < startMs && clipEnd > endMs && clip.linkGroupId
        ? resolveSplit(clip.linkGroupId)
        : null;

    if (clip.startMs < startMs) {
      const durationMs = startMs - clip.startMs;
      const sourceMs = Math.round(durationMs * speed);
      append(
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
      append(
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
  return {
    before,
    after: after.map((next) => {
      const original = originals.get(next.id);
      const primary = original?.linkGroupId
        ? sourceClips.find(
            (source) => source.linkGroupId === original.linkGroupId,
          )
        : original?.kind === 'caption'
          ? sourceClips.find(
              (source) =>
                captionMatchesSource(original, sourceMatch(source)) &&
                overlaps(
                  source,
                  original.startMs,
                  original.startMs + original.durationMs,
                ),
            )
          : undefined;
      return original ? cutCaption(original, next, primary) : next;
    }),
  };
}

function withLinkGroup<T extends TimelineClip>(
  clip: T,
  linkGroupId: string | undefined,
): T {
  if (linkGroupId) return { ...clip, linkGroupId };
  const { linkGroupId: _omit, ...rest } = clip;
  return rest as T;
}

/** Shift both caption representations, whose timings are timeline-absolute. */
function shiftCaption(clip: TimelineClip, deltaMs: number): TimelineClip {
  if (clip.kind !== 'caption')
    return { ...clip, startMs: clip.startMs + deltaMs };
  return {
    ...clip,
    startMs: clip.startMs + deltaMs,
    words: clip.words?.map((w) => ({
      ...w,
      startMs: w.startMs + deltaMs,
      endMs: w.endMs + deltaMs,
    })),
    tokens: clip.tokens?.map((w) => ({
      ...w,
      startMs: w.startMs + deltaMs,
      endMs: w.endMs + deltaMs,
    })),
  };
}

function cutCaption(
  original: TimelineClip,
  next: TimelineClip,
  primary?: TimelineClip,
): TimelineClip {
  if (original.kind !== 'caption' || next.kind !== 'caption') return next;
  const { reverse } = normalizeClipPlayback(
    primary?.playback ?? original.playback,
  );
  const speed =
    (original.trimEndMs - original.trimStartMs) / original.durationMs;
  const lo = reverse
    ? original.startMs + (original.trimEndMs - next.trimEndMs) / speed
    : original.startMs + (next.trimStartMs - original.trimStartMs) / speed;
  const hi = lo + next.durationMs;
  const delta = next.startMs - lo;
  const keep = <T extends { startMs: number; endMs: number }>(items: T[]) =>
    items
      .filter(
        (w) =>
          w.startMs >= lo - ADJACENT_TOLERANCE_MS &&
          w.endMs <= hi + ADJACENT_TOLERANCE_MS,
      )
      .map((w) => ({
        ...w,
        startMs: w.startMs + delta,
        endMs: w.endMs + delta,
      }));
  const words = original.words ? keep(original.words) : undefined;
  const tokens = original.tokens ? keep(original.tokens) : undefined;
  return {
    ...next,
    ...(words ? { words } : {}),
    ...(tokens ? { tokens } : {}),
    text: (words ?? tokens)?.map((w) => w.text).join(' ') ?? next.text,
    ...(next.sourceAnchor
      ? {
          sourceAnchor: {
            ...next.sourceAnchor,
            sourceStartMs: next.trimStartMs,
            sourceEndMs: next.trimEndMs,
          },
        }
      : {}),
  };
}

function rebuildCaption(
  clip: TimelineClip,
  words: readonly TranscriptWordTiming[],
  speed: number,
  reverse: boolean,
): TimelineClip {
  if (clip.kind !== 'caption') return clip;
  // Only word-timed cues can be rebuilt from transcript words. Authored cues
  // (capture/manual) carry their own text and nothing to map it onto, so they
  // keep it — rewriting it from transcript words would be a false restore.
  if (!clip.words && !clip.tokens) return clip;
  const inside = words.filter(
    (w) => w.startMs >= clip.trimStartMs && w.endMs <= clip.trimEndMs,
  );
  if (!inside.length || inside.some((w) => w.text === undefined)) {
    throw new EditBuilderError(
      'Transcript text is required to restore captions',
      'transcript_text_required',
    );
  }
  const mapped = inside
    .map((w) => ({
      text: w.text!,
      startMs: Math.round(
        clip.startMs +
          (reverse ? clip.trimEndMs - w.endMs : w.startMs - clip.trimStartMs) /
            speed,
      ),
      endMs: Math.round(
        clip.startMs +
          (reverse ? clip.trimEndMs - w.startMs : w.endMs - clip.trimStartMs) /
            speed,
      ),
    }))
    .sort((a, b) => a.startMs - b.startMs);
  const next: CaptionTimelineClip = {
    ...clip,
    text: mapped.map((w) => w.text).join(' '),
    ...(clip.words ? { words: mapped } : {}),
    ...(clip.tokens
      ? {
          tokens: mapped.map((w, index) => ({
            ...w,
            id: `${clip.id}:restored:${index}`,
          })),
        }
      : {}),
    ...(clip.sourceAnchor
      ? {
          sourceAnchor: {
            ...clip.sourceAnchor,
            sourceStartMs: clip.trimStartMs,
            sourceEndMs: clip.trimEndMs,
          },
        }
      : {}),
  };
  return next;
}

function captionMatchesSource(
  clip: TimelineClip,
  match: TranscriptSourceMatch,
): boolean {
  if (clip.kind !== 'caption') return false;
  return (
    (clip.sourceAnchor !== undefined &&
      match.assetIds?.includes(clip.sourceAnchor.sourceMediaId) === true) ||
    (clip.sourceRef.kind === 'asset' &&
      match.assetIds?.includes(clip.sourceRef.assetId) === true) ||
    (clip.sourceRef.kind === 'linked' &&
      clip.sourceRef.sourceId === match.sourceId) ||
    (match.sourceId !== undefined && clip.params?.sourceId === match.sourceId)
  );
}

function sourceMatch(clip: TimelineClip): TranscriptSourceMatch {
  return clip.sourceRef.kind === 'asset'
    ? { assetIds: [clip.sourceRef.assetId] }
    : clip.sourceRef.kind === 'linked'
      ? { sourceId: clip.sourceRef.sourceId }
      : {};
}
