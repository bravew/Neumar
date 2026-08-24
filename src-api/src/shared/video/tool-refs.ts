import type { Timeline, TimelineClip, TimelineTrack } from '@neumar/video-ir';

import type { VideoProject } from './types';

/**
 * Ref resolution for every clip-taking Video tool (P2-2).
 *
 * The `$selection` / `$transcript_selection` resolvers used to live inside
 * `video_apply_timeline_ops`, which meant `video_cut_clip`, `video_move_clips`,
 * `video_delete_clips` and friends could not say "the selected clip". This
 * module owns the vocabulary; the MCP dispatcher applies it to every tool.
 *
 * Ref forms (all are plain strings, so no tool schema has to change):
 *   $selection                 the one clip the user has selected/inspected
 *   $transcript_selection      the clip the transcript selection points at
 *   clipIndex:<n>              nth clip on the resolved track (0-based)
 *   trackIndex:<n>:clipIndex:<m>
 *   atSec:<seconds>            the clip covering that project time
 *   trackIndex:<n>             (track fields only) nth track
 *   $key:<name>                (batch ops only) a clip minted earlier in the
 *                              same batch — see `allocateSymbolicKeys`
 */

export interface TimelineResolverRefs {
  selectionClipIds?: string[];
  transcriptSelection?: {
    clipId?: string;
    startMs: number;
    endMs: number;
    text?: string;
  };
  /** Symbolic keys minted by the current batch: key → clip id. */
  keyedClipIds?: Record<string, string>;
}

export class VideoRefResolutionError extends Error {
  constructor(
    public readonly ref: string,
    message: string,
  ) {
    super(message);
    this.name = 'VideoRefResolutionError';
  }
}

const CLIP_REF_PREFIXES = [
  '$selection',
  'selection',
  '$transcript_selection',
  'transcript_selection',
  'clipIndex:',
  'trackIndex:',
  'atSec:',
  '$key:',
];

export function isClipRef(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    CLIP_REF_PREFIXES.some((prefix) =>
      prefix.endsWith(':') ? value.startsWith(prefix) : value === prefix,
    )
  );
}

export function isTrackRef(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('trackIndex:');
}

/** Field names whose string value is a clip id. */
const CLIP_ID_FIELDS = new Set(['clipId', 'toClipId', 'targetClipId']);
/** Field names whose value is an array of clip ids. */
const CLIP_ID_LIST_FIELDS = new Set(['clipIds']);
/** Field names whose string value is a track id. */
const TRACK_ID_FIELDS = new Set(['trackId', 'toTrackId', 'duckUnderTrackId']);
/** Field names whose value is an array of track ids. */
const TRACK_ID_LIST_FIELDS = new Set(['trackIds']);

/**
 * True when a known ref-bearing field anywhere in `input` holds a ref. Only
 * inspects the field names `resolveVideoRefs` itself rewrites, so a
 * search/text field whose value happens to look like a ref (e.g. the literal
 * string "selection") does not trigger project loading.
 */
export function hasVideoRefs(input: unknown): boolean {
  if (Array.isArray(input)) return input.some((entry) => hasVideoRefs(entry));
  if (!input || typeof input !== 'object') return false;

  for (const [key, entry] of Object.entries(input as Record<string, unknown>)) {
    if (CLIP_ID_FIELDS.has(key) && isClipRef(entry)) return true;
    if (
      CLIP_ID_LIST_FIELDS.has(key) &&
      Array.isArray(entry) &&
      entry.some((item) => isClipRef(item))
    ) {
      return true;
    }
    if (TRACK_ID_FIELDS.has(key) && isTrackRef(entry)) return true;
    if (
      TRACK_ID_LIST_FIELDS.has(key) &&
      Array.isArray(entry) &&
      entry.some((item) => isTrackRef(item))
    ) {
      return true;
    }
    if (hasVideoRefs(entry)) return true;
  }
  return false;
}

export interface ResolveVideoRefsInput {
  value: unknown;
  project: VideoProject;
  refs: TimelineResolverRefs | undefined;
}

/**
 * Rewrite every ref-shaped clip/track field in `value` to a concrete id.
 * Non-ref values pass through untouched, so calling this on an already-literal
 * payload is a no-op.
 */
export function resolveVideoRefs(input: ResolveVideoRefsInput): unknown {
  return rewrite(input.value, input);
}

function rewrite(value: unknown, ctx: ResolveVideoRefsInput): unknown {
  if (Array.isArray(value)) return value.map((entry) => rewrite(entry, ctx));
  if (!value || typeof value !== 'object') return value;

  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(source)) {
    if (CLIP_ID_FIELDS.has(key) && isClipRef(entry)) {
      out[key] = resolveClipRef(entry, source, ctx);
      continue;
    }
    if (CLIP_ID_LIST_FIELDS.has(key) && Array.isArray(entry)) {
      out[key] = entry.map((item) =>
        isClipRef(item) ? resolveClipRef(item, source, ctx) : item,
      );
      continue;
    }
    if (TRACK_ID_FIELDS.has(key) && isTrackRef(entry)) {
      out[key] = resolveTrackRef(entry, ctx.project);
      continue;
    }
    if (TRACK_ID_LIST_FIELDS.has(key) && Array.isArray(entry)) {
      out[key] = entry.map((item) =>
        isTrackRef(item) ? resolveTrackRef(item, ctx.project) : item,
      );
      continue;
    }
    out[key] = rewrite(entry, ctx);
  }
  return out;
}

export function resolveClipRef(
  ref: string,
  siblingFields: Record<string, unknown>,
  ctx: ResolveVideoRefsInput,
): string {
  if (ref === 'selection' || ref === '$selection') {
    const selected = ctx.refs?.selectionClipIds ?? [];
    if (selected.length !== 1) {
      throw new VideoRefResolutionError(
        ref,
        'selection resolver requires exactly one selected clip',
      );
    }
    return selected[0]!;
  }
  if (ref === 'transcript_selection' || ref === '$transcript_selection') {
    const clipId = ctx.refs?.transcriptSelection?.clipId;
    if (!clipId) {
      throw new VideoRefResolutionError(
        ref,
        'transcript_selection clip resolver was not provided',
      );
    }
    return clipId;
  }
  if (ref.startsWith('$key:')) {
    const key = ref.slice('$key:'.length);
    const clipId = ctx.refs?.keyedClipIds?.[key];
    if (!clipId) {
      throw new VideoRefResolutionError(
        ref,
        `no clip has been created for symbolic key "${key}" earlier in this batch`,
      );
    }
    return clipId;
  }

  const timeline = ctx.project.timeline;
  if (!timeline) {
    throw new VideoRefResolutionError(ref, 'project has no timeline');
  }

  if (ref.startsWith('atSec:')) {
    const seconds = Number(ref.slice('atSec:'.length));
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new VideoRefResolutionError(
        ref,
        'atSec: expects a positive number',
      );
    }
    const track = resolveTrackForRef(timeline, siblingFields, ref);
    const atMs = Math.round(seconds * 1000);
    const clip = track.clips.find(
      (candidate) =>
        atMs >= candidate.startMs &&
        atMs < candidate.startMs + candidate.durationMs,
    );
    if (!clip) {
      throw new VideoRefResolutionError(
        ref,
        `no clip covers ${seconds}s on track "${track.id}"`,
      );
    }
    return clip.id;
  }

  // `clipIndex:<n>` and `trackIndex:<n>:clipIndex:<m>`
  const clipIndexMatch = ref.match(/^(?:trackIndex:(\d+):)?clipIndex:(-?\d+)$/);
  if (clipIndexMatch) {
    const track = clipIndexMatch[1]
      ? trackByIndex(timeline, Number(clipIndexMatch[1]), ref)
      : resolveTrackForRef(timeline, siblingFields, ref);
    const clips = orderedClips(track);
    const index = Number(clipIndexMatch[2]);
    const clip = index < 0 ? clips[clips.length + index] : clips[index];
    if (!clip) {
      throw new VideoRefResolutionError(
        ref,
        `track "${track.id}" has no clip at index ${index} (${clips.length} clips)`,
      );
    }
    return clip.id;
  }

  throw new VideoRefResolutionError(ref, `unrecognized clip ref "${ref}"`);
}

export function resolveTrackRef(ref: string, project: VideoProject): string {
  const timeline = project.timeline;
  if (!timeline) {
    throw new VideoRefResolutionError(ref, 'project has no timeline');
  }
  const match = ref.match(/^trackIndex:(-?\d+)$/);
  if (!match) {
    throw new VideoRefResolutionError(ref, `unrecognized track ref "${ref}"`);
  }
  return trackByIndex(timeline, Number(match[1]), ref).id;
}

function trackByIndex(
  timeline: Timeline,
  index: number,
  ref: string,
): TimelineTrack {
  const tracks = timeline.tracks;
  const track = index < 0 ? tracks[tracks.length + index] : tracks[index];
  if (!track) {
    throw new VideoRefResolutionError(
      ref,
      `timeline has no track at index ${index} (${tracks.length} tracks)`,
    );
  }
  return track;
}

/**
 * Which track a bare `clipIndex:`/`atSec:` ref means: an explicit sibling
 * `trackId` wins, then the track holding the current selection, then the first
 * video track, then the first track.
 */
function resolveTrackForRef(
  timeline: Timeline,
  siblingFields: Record<string, unknown>,
  ref: string,
): TimelineTrack {
  const explicit = siblingFields.trackId;
  if (typeof explicit === 'string' && !isTrackRef(explicit)) {
    const track = timeline.tracks.find(
      (candidate) => candidate.id === explicit,
    );
    if (track) return track;
  }
  if (isTrackRef(explicit)) {
    const match = String(explicit).match(/^trackIndex:(-?\d+)$/);
    if (match) return trackByIndex(timeline, Number(match[1]), ref);
  }
  const video = timeline.tracks.find((track) => track.kind === 'video');
  const fallback = video ?? timeline.tracks[0];
  if (!fallback) {
    throw new VideoRefResolutionError(ref, 'timeline has no tracks');
  }
  return fallback;
}

function orderedClips(track: TimelineTrack): TimelineClip[] {
  return [...track.clips].sort((left, right) => left.startMs - right.startMs);
}
