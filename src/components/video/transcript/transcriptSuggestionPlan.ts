import {
  clipMatchesTranscriptSource,
  compileTranscriptCut,
  sourceSpanToTimelineWindow,
} from '@neumar/video-ir';

import type { VideoCutCandidate, VideoTimeline } from '@/shared/types/video';

import type { SourceTranscriptView } from './sourceTranscriptView';

/** Suggestions stay in source time, including silence gaps containing no words. */
export function suggestionWindows(
  timeline: VideoTimeline,
  view: SourceTranscriptView,
  candidate: VideoCutCandidate,
) {
  if (
    candidate.sourceId !== view.sourceId ||
    candidate.endMs <= candidate.startMs
  )
    return [];
  return timeline.tracks
    .flatMap((track) =>
      track.clips.flatMap((clip) => {
        if (!clipMatchesTranscriptSource(clip, view.match)) return [];
        const window = sourceSpanToTimelineWindow(
          clip,
          candidate.startMs,
          candidate.endMs,
        );
        return window ? [window] : [];
      }),
    )
    .sort((a, b) => a.startMs - b.startMs);
}

export function compileSuggestionCut(
  timeline: VideoTimeline,
  view: SourceTranscriptView,
  candidate: VideoCutCandidate,
) {
  if (candidate.sourceId !== view.sourceId) return [];
  // Silence has no word indices; the compiler consumes source spans directly.
  return compileTranscriptCut({
    timeline,
    match: view.match,
    words: [{ startMs: candidate.startMs, endMs: candidate.endMs }],
    startIndex: 0,
    endIndex: 0,
  });
}
