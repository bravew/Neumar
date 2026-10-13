import {
  compileTranscriptCut,
  compileTranscriptRestore,
  EditBuilderError,
  type EditBuildResult,
  type TimelineOp,
} from '@neumar/video-ir';
import type { Timeline } from '@neumar/video-ir';

import { getVideoFeatureFlag } from '../flags';
import type { VideoProject } from '../types';

export interface BuildTranscriptWordsInput {
  sourceId: string;
  startIndex: number;
  endIndex: number;
  ripple?: boolean;
}

/**
 * Agent parity with the transcript panel: a word range becomes the same
 * `clip.removeTimeRange` / `clip.trim` ops the UI would apply, so approvals,
 * diffs and history behave like any other timeline edit.
 */
export function buildTranscriptWordOps(
  project: VideoProject,
  timeline: Timeline,
  action: 'cut' | 'restore',
  input: BuildTranscriptWordsInput,
): EditBuildResult {
  if (!getVideoFeatureFlag('video.transcriptLayer')) {
    throw new EditBuilderError(
      'Transcript layer is disabled',
      'feature_disabled',
    );
  }
  const source = (project.sources ?? []).find(
    (item) => item.id === input.sourceId,
  );
  if (!source) {
    throw new EditBuilderError('Source not found', 'source_not_found', {
      sourceId: input.sourceId,
    });
  }
  const words = (project.sourceAnalyses ?? []).find(
    (item) => item.sourceId === input.sourceId,
  )?.transcript?.words;
  if (!words?.length) {
    throw new EditBuilderError(
      'Source has no word-timed transcript; analyze it first',
      'transcript_missing',
      { sourceId: input.sourceId },
    );
  }
  if (
    input.endIndex < input.startIndex ||
    input.endIndex >= words.length ||
    input.startIndex < 0
  ) {
    throw new EditBuilderError(
      `Word range ${input.startIndex}-${input.endIndex} is outside the transcript (0-${words.length - 1})`,
      'range_invalid',
      { wordCount: words.length },
    );
  }
  const compile = {
    timeline,
    match: { assetIds: [source.mediaItemId], sourceId: source.id },
    words,
    startIndex: input.startIndex,
    endIndex: input.endIndex,
    magnetic: input.ripple,
  };
  let ops: TimelineOp[];
  if (action === 'cut') {
    ops = compileTranscriptCut(compile);
  } else {
    const restored = compileTranscriptRestore(compile);
    if (!restored.ok) {
      throw new EditBuilderError(
        `These words cannot be restored automatically (${restored.reason})`,
        `restore_${restored.reason.replaceAll('-', '_')}`,
        { sourceId: input.sourceId },
      );
    }
    ops = restored.ops;
  }
  if (ops.length === 0) {
    throw new EditBuilderError(
      'No clip plays those words; nothing to change',
      'nothing_to_change',
      { sourceId: input.sourceId },
    );
  }
  const locked = lockedTrackIds(timeline, ops);
  if (locked.length > 0) {
    throw new EditBuilderError('Track is locked', 'track_locked', {
      trackIds: locked,
    });
  }
  return {
    ops,
    conflicts: [],
    metadata: {
      affectedTrackIds: [
        ...new Set(
          ops.flatMap((op) =>
            op.kind === 'clip.removeTimeRange' && op.trackId
              ? [op.trackId]
              : [],
          ),
        ),
      ],
      changedClipIds: ops.flatMap((op) =>
        op.kind === 'clip.trim' ? [op.clipId] : [],
      ),
      createdClipIds: [],
      removedClipIds: [],
      shiftedClipIds: [],
      inspectClipIds: [],
    },
  };
}

function lockedTrackIds(timeline: Timeline, ops: TimelineOp[]): string[] {
  const touched = new Set<string>();
  for (const op of ops) {
    if (op.kind === 'clip.removeTimeRange' && op.trackId) {
      touched.add(op.trackId);
    } else if (op.kind === 'clip.trim') {
      const track = timeline.tracks.find((t) =>
        t.clips.some((c) => c.id === op.clipId),
      );
      if (track) touched.add(track.id);
    }
  }
  return timeline.tracks
    .filter((track) => track.locked && touched.has(track.id))
    .map((track) => track.id);
}
