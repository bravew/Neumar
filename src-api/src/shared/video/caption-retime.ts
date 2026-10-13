import type {
  CaptionTimelineClip,
  CaptionTimelineTrack,
  CaptionTokenAnchor,
  VideoTimeline,
  VisualTimelineClip,
  VisualTimelineTrack,
} from './types';

/** Marks a caption clip as generated from speech-to-text (vs. capture/manual). */
export const STT_CAPTION_ORIGIN = 'stt';

/**
 * Marks a caption clip as machine-translated from another caption track. Like
 * STT cues it carries a source anchor, so it retimes with the speech it covers.
 */
export const TRANSLATED_CAPTION_ORIGIN = 'translated';

/**
 * True for cues whose timeline position is derived from a source anchor: STT
 * cues and the translated cues generated from them. Capture/manual cues are
 * positioned by hand and must be left alone.
 */
function isAnchoredCue(cue: CaptionTimelineClip): boolean {
  return (
    cue.params?.origin === STT_CAPTION_ORIGIN ||
    cue.params?.origin === TRANSLATED_CAPTION_ORIGIN
  );
}

const MIN_CUE_MS = 200;

/** Id of the original (non-translated) caption track. */
export const PRIMARY_CAPTION_TRACK_ID = 'track-caption-main';

/**
 * The original caption track — the one generated from speech, as opposed to a
 * translated track alongside it. Generation and capture-cue insertion target
 * this track so they never overwrite a translation.
 */
export function findPrimaryCaptionTrack(
  timeline: VideoTimeline,
): CaptionTimelineTrack | undefined {
  const tracks = timeline.tracks.filter(
    (track): track is CaptionTimelineTrack => track.kind === 'caption',
  );
  return (
    tracks.find((track) => track.id === PRIMARY_CAPTION_TRACK_ID) ??
    tracks.find(
      (track) =>
        !track.language &&
        !track.clips.some(
          (cue) => cue.params?.origin === TRANSLATED_CAPTION_ORIGIN,
        ),
    ) ??
    tracks.find(
      (track) =>
        !track.clips.some(
          (cue) => cue.params?.origin === TRANSLATED_CAPTION_ORIGIN,
        ),
    )
  );
}

/**
 * Keeps anchored caption cues aligned to their speech after the timeline
 * changes. Each generated cue carries a source anchor (which source + time range
 * its words came from); this recomputes the cue's timeline position from that
 * anchor against the current video clips. Cues whose speech was cut out of the
 * timeline are dropped; manually placed / capture cues are left untouched.
 *
 * Every caption track is retimed, so a translated track follows the same edits
 * as the source track it was generated from.
 */
export function retimeTimelineCaptions(timeline: VideoTimeline): VideoTimeline {
  const captionTracks = timeline.tracks.filter(
    (track): track is CaptionTimelineTrack => track.kind === 'caption',
  );
  if (captionTracks.length === 0) return timeline;
  const clips = visualClips(timeline);
  return captionTracks.reduce((next, track) => {
    const nextClips = sortByStart(
      track.clips
        .map((cue) => retimeCue(cue, clips))
        .filter((cue): cue is CaptionTimelineClip => cue !== null),
    );
    return replaceCaptionTrack(next, track.id, nextClips);
  }, timeline);
}

/**
 * Moves generated cues from a previous timeline onto a freshly rebuilt one (e.g.
 * after a storyboard edit regenerates the timeline), retimed against the new
 * clips so generated captions survive rebuilds instead of vanishing.
 *
 * A rebuilt timeline only ever produces the primary caption track, so:
 * - the previous primary track merges into its fresh counterpart, keeping that
 *   counterpart's own (storyboard-authored) cues;
 * - every other caption track — a translation — has no counterpart and is
 *   recreated from its previous definition, so `hidden` and `language` survive.
 *   Recreating without `hidden` would silently un-hide a track and flip which
 *   language renders.
 */
export function carryForwardSttCaptions(
  previous: VideoTimeline | undefined,
  fresh: VideoTimeline,
): VideoTimeline {
  const previousTracks = (previous?.tracks ?? []).filter(isCaptionTrack);
  if (previousTracks.length === 0) return fresh;
  // Nothing generated to carry: leave the rebuilt timeline untouched.
  if (!previousTracks.some((track) => track.clips.some(isAnchoredCue)))
    return fresh;

  const clips = visualClips(fresh);
  const freshTracks = fresh.tracks.filter(isCaptionTrack);
  let next = fresh;

  for (const prevTrack of previousTracks) {
    const retimed = sortByStart(
      prevTrack.clips
        .filter(isAnchoredCue)
        .map((cue) => retimeCue(cue, clips))
        .filter((cue): cue is CaptionTimelineClip => cue !== null),
    );
    const counterpart = freshTracks.find((track) => track.id === prevTrack.id);
    if (counterpart) {
      // Keep the rebuilt track's own cues; replace only the generated ones.
      const kept = counterpart.clips.filter((cue) => !isAnchoredCue(cue));
      next = replaceCaptionTrack(
        next,
        counterpart.id,
        sortByStart([...kept, ...retimed]),
      );
      if (prevTrack.hidden) next = setCaptionTrackHidden(next, counterpart.id);
    } else if (retimed.length > 0) {
      next = {
        ...next,
        tracks: [...next.tracks, { ...prevTrack, clips: retimed }],
      };
    }
  }
  return next;
}

function setCaptionTrackHidden(
  timeline: VideoTimeline,
  trackId: string,
): VideoTimeline {
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) =>
      track.id === trackId && track.kind === 'caption'
        ? { ...track, hidden: true }
        : track,
    ),
  };
}

function retimeCue(
  cue: CaptionTimelineClip,
  clips: VisualTimelineClip[],
): CaptionTimelineClip | null {
  if (!isAnchoredCue(cue) || !cue.sourceAnchor) {
    return cue;
  }
  const host = hostClipForAnchor(clips, cue.sourceAnchor, cue.startMs);
  if (!host) return null;
  const speed = host.playback?.speed || 1;
  const toTimeline = (sourceMs: number): number => {
    const clamped = Math.min(
      Math.max(sourceMs, host.trimStartMs),
      host.trimEndMs,
    );
    return host.startMs + (clamped - host.trimStartMs) / speed;
  };
  const startMs = Math.round(toTimeline(cue.sourceAnchor.sourceStartMs));
  const endMs = Math.round(toTimeline(cue.sourceAnchor.sourceEndMs));
  // Rescale word timings into the new cue span (not a flat shift) so a speed
  // change on the host clip keeps the per-word animation aligned.
  const oldSpanMs = cue.durationMs || 1;
  const scale = (endMs - startMs) / oldSpanMs;
  return {
    ...cue,
    startMs,
    durationMs: Math.max(MIN_CUE_MS, endMs - startMs),
    words: cue.words?.map((word) => ({
      ...word,
      startMs: Math.round(startMs + (word.startMs - cue.startMs) * scale),
      endMs: Math.round(startMs + (word.endMs - cue.startMs) * scale),
    })),
  };
}

/**
 * The video clip that still shows the anchor's source range. When several clips
 * do (e.g. a duplicated clip), the one whose projected position is closest to
 * where the cue already sits wins, so a cue stays with its own copy.
 */
function hostClipForAnchor(
  clips: VisualTimelineClip[],
  anchor: CaptionTokenAnchor,
  nearTimelineMs: number,
): VisualTimelineClip | undefined {
  const matches = clips.filter(
    (clip) =>
      clip.sourceRef.kind === 'asset' &&
      clip.sourceRef.assetId === anchor.sourceMediaId &&
      anchor.sourceStartMs >= clip.trimStartMs &&
      anchor.sourceStartMs < clip.trimEndMs,
  );
  if (matches.length <= 1) return matches[0];
  const projected = (clip: VisualTimelineClip): number =>
    clip.startMs +
    (anchor.sourceStartMs - clip.trimStartMs) / (clip.playback?.speed || 1);
  return matches.reduce((best, clip) =>
    Math.abs(projected(clip) - nearTimelineMs) <
    Math.abs(projected(best) - nearTimelineMs)
      ? clip
      : best,
  );
}

function isCaptionTrack(track: {
  kind: string;
}): track is CaptionTimelineTrack {
  return track.kind === 'caption';
}

function visualClips(timeline: VideoTimeline): VisualTimelineClip[] {
  return timeline.tracks
    .filter(
      (track): track is VisualTimelineTrack =>
        track.kind === 'video' && !track.hidden,
    )
    .flatMap((track) => track.clips)
    .filter((clip): clip is VisualTimelineClip => clip.kind === 'video');
}

function sortByStart(clips: CaptionTimelineClip[]): CaptionTimelineClip[] {
  return [...clips].sort((a, b) => a.startMs - b.startMs);
}

function replaceCaptionTrack(
  timeline: VideoTimeline,
  trackId: string,
  clips: CaptionTimelineClip[],
): VideoTimeline {
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) =>
      track.id === trackId && track.kind === 'caption'
        ? ({ ...track, clips } satisfies CaptionTimelineTrack)
        : track,
    ),
  };
}
