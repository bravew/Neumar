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

const MIN_CUE_MS = 200;

/**
 * Keeps STT caption cues aligned to their speech after the timeline changes.
 * Each generated cue carries a source anchor (which source + time range its
 * words came from); this recomputes the cue's timeline position from that
 * anchor against the current video clips. Cues whose speech was cut out of the
 * timeline are dropped; manually placed / capture cues are left untouched.
 */
export function retimeTimelineCaptions(timeline: VideoTimeline): VideoTimeline {
  const captionTrack = timeline.tracks.find(
    (track): track is CaptionTimelineTrack => track.kind === 'caption',
  );
  if (!captionTrack) return timeline;
  const clips = visualClips(timeline);
  const nextClips = sortByStart(
    captionTrack.clips
      .map((cue) => retimeCue(cue, clips))
      .filter((cue): cue is CaptionTimelineClip => cue !== null),
  );
  return replaceCaptionTrack(timeline, captionTrack.id, nextClips);
}

/**
 * Moves STT cues from a previous timeline onto a freshly rebuilt one (e.g. after
 * a storyboard edit regenerates the timeline), retimed against the new clips so
 * generated captions survive rebuilds instead of vanishing.
 */
export function carryForwardSttCaptions(
  previous: VideoTimeline | undefined,
  fresh: VideoTimeline,
): VideoTimeline {
  const previousCaptions = previous?.tracks.find(
    (track): track is CaptionTimelineTrack => track.kind === 'caption',
  );
  const sttCues = (previousCaptions?.clips ?? []).filter(
    (cue) => cue.params?.origin === STT_CAPTION_ORIGIN,
  );
  if (sttCues.length === 0) return fresh;

  const clips = visualClips(fresh);
  const retimed = sttCues
    .map((cue) => retimeCue(cue, clips))
    .filter((cue): cue is CaptionTimelineClip => cue !== null);

  const freshCaptions = fresh.tracks.find(
    (track): track is CaptionTimelineTrack => track.kind === 'caption',
  );
  const kept = (freshCaptions?.clips ?? []).filter(
    (cue) => cue.params?.origin !== STT_CAPTION_ORIGIN,
  );
  const merged = sortByStart([...kept, ...retimed]);

  if (freshCaptions) {
    return replaceCaptionTrack(fresh, freshCaptions.id, merged);
  }
  const track: CaptionTimelineTrack = {
    id: 'track-caption-main',
    kind: 'caption',
    name: 'Captions',
    muted: false,
    locked: false,
    order: 30,
    clips: merged,
  };
  return { ...fresh, tracks: [...fresh.tracks, track] };
}

function retimeCue(
  cue: CaptionTimelineClip,
  clips: VisualTimelineClip[],
): CaptionTimelineClip | null {
  if (cue.params?.origin !== STT_CAPTION_ORIGIN || !cue.sourceAnchor) {
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
