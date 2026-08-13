import { randomUUID } from 'node:crypto';

import {
  TimelineOpError,
  applyTimelineOp,
  applyTimelineOps,
  collectTimelineOpConflicts,
} from '@neumar/video-ir';
export {
  buildApplyVividOverlayMotionTemplateOps,
  buildCrossfadeAudioClipsOps,
  buildCloseGapOps,
  buildCutClipOps,
  buildCutRangeOps,
  buildDeleteClipsOps,
  buildDuplicateClipsOps,
  buildDuckAudioOps,
  buildFlipClipOps,
  buildMoveClipOps,
  buildReplaceAudioClipSourceOps,
  buildReverseClipOps,
  buildRotateClipOps,
  buildSetAudioClipFadeOps,
  buildSetAudioClipGainOps,
  buildSetAudioClipMuteOps,
  buildSetAudioTrackMuteOps,
  buildSetAudioTrackVolumeOps,
  buildSetAudioTransitionOps,
  buildSetAudioVolumeKeyframesOps,
  buildSetClipParamsOps,
  buildSetClipSpeedOps,
  buildSetClipTransformOps,
  buildSetVividOverlayControlKeyframesOps,
  buildSetVividOverlayControlsOps,
  buildTrimClipOps,
  type BuildCrossfadeAudioClipsInput,
  type BuildCloseGapInput,
  type BuildCutClipInput,
  type BuildCutRangeInput,
  type BuildDeleteClipsInput,
  type BuildDuplicateClipsInput,
  type BuildDuckAudioInput,
  type BuildFlipClipInput,
  type BuildMoveClipInput,
  type BuildReplaceAudioClipSourceInput,
  type BuildReverseClipInput,
  type BuildRotateClipInput,
  type BuildSetAudioClipFadeInput,
  type BuildSetAudioClipGainInput,
  type BuildSetAudioClipMuteInput,
  type BuildSetAudioTrackMuteInput,
  type BuildSetAudioTrackVolumeInput,
  type BuildSetAudioTransitionInput,
  type BuildSetAudioVolumeKeyframesInput,
  type BuildSetClipParamsInput,
  type BuildSetClipSpeedInput,
  type BuildSetClipTransformInput,
  type BuildSetVividOverlayControlKeyframesInput,
  type BuildSetVividOverlayControlsInput,
  type BuildTrimClipInput,
  type EditBuildConflict,
  type EditBuildMetadata,
  type EditBuildResult,
  EditBuilderError,
  type BuildApplyVividOverlayMotionTemplateInput,
} from '@neumar/video-ir';
import type {
  RippleConflict,
  Timeline,
  TimelineHistoryEntry,
  TimelineHistoryOperation,
  TimelineHistorySource,
  TimelineOp,
} from '@neumar/video-ir';

import { rebuildTimelineFromStoryboard } from './timeline';
import type {
  VideoProject,
  VideoTimeline,
  VideoTimelineHistory,
} from './types';

const MAX_TIMELINE_HISTORY_ENTRIES = 500;

export interface ApplyProjectTimelineOpInput {
  op: TimelineOp;
  source?: TimelineHistorySource;
  summary?: string;
  now?: string;
  journalId?: string;
}

export interface ApplyProjectTimelineOpsInput {
  ops: TimelineOp[];
  source?: TimelineHistorySource;
  summary?: string;
  now?: string;
  journalId?: string;
}

export interface ProjectTimelineOpExecution {
  project: VideoProject;
  timeline: VideoTimeline;
  entry: TimelineHistoryEntry;
  inverse: TimelineHistoryOperation;
}

export interface ProposeProjectTimelineOpsInput {
  ops: TimelineOp[];
}

export interface ProjectTimelineOpsProposal {
  timeline: VideoTimeline;
  inverses: TimelineOp[];
  conflicts: RippleConflict[];
}

export function proposeProjectTimelineOps(
  project: VideoProject,
  input: ProposeProjectTimelineOpsInput,
): ProjectTimelineOpsProposal {
  if (input.ops.length === 0) {
    throw new Error('At least one timeline operation is required');
  }
  let timeline = editableTimeline(project);
  const conflicts = collectTimelineOpConflicts(timeline, input.ops);
  if (conflicts.length > 0) {
    return {
      timeline: timeline as VideoTimeline,
      inverses: [],
      conflicts,
    };
  }
  const inverses: TimelineOp[] = [];
  for (const op of input.ops) {
    const result = applyTimelineOp(timeline, op);
    timeline = result.timeline;
    inverses.push(...flattenInverse(result.inverse));
  }
  return {
    timeline: timeline as VideoTimeline,
    inverses,
    conflicts: [],
  };
}

export function applyProjectTimelineOp(
  project: VideoProject,
  input: ApplyProjectTimelineOpInput,
): ProjectTimelineOpExecution {
  const timeline = editableTimeline(project);
  assertNoTimelineConflicts(timeline, [input.op]);
  const result = applyTimelineOp(timeline, input.op);
  const now = input.now ?? new Date().toISOString();
  const entry: TimelineHistoryEntry = {
    id: input.journalId ?? randomUUID(),
    ts: now,
    op: input.op,
    inverse: result.inverse,
    source: input.source ?? 'agent',
    summary: input.summary,
  };
  const history = appendHistoryEntry(project.history, entry);
  const nextTimeline = result.timeline as VideoTimeline;

  return {
    project: {
      ...project,
      timeline: nextTimeline,
      history,
      updatedAt: now,
    },
    timeline: nextTimeline,
    entry,
    inverse: result.inverse,
  };
}

export function applyProjectTimelineOps(
  project: VideoProject,
  input: ApplyProjectTimelineOpsInput,
): ProjectTimelineOpExecution {
  if (input.ops.length === 0) {
    throw new Error('At least one timeline operation is required');
  }
  const timeline = editableTimeline(project);
  assertNoTimelineConflicts(timeline, input.ops);
  const result = applyTimelineOps(timeline, input.ops);
  const now = input.now ?? new Date().toISOString();
  const entry: TimelineHistoryEntry = {
    id: input.journalId ?? randomUUID(),
    ts: now,
    op: { kind: 'timeline.batch', ops: input.ops },
    inverse: { kind: 'timeline.batch', ops: result.inverses },
    source: input.source ?? 'agent',
    summary: input.summary,
  };
  const history = appendHistoryEntry(project.history, entry);
  const nextTimeline = result.timeline as VideoTimeline;

  return {
    project: {
      ...project,
      timeline: nextTimeline,
      history,
      updatedAt: now,
    },
    timeline: nextTimeline,
    entry,
    inverse: entry.inverse,
  };
}

function assertNoTimelineConflicts(
  timeline: Timeline,
  ops: readonly TimelineOp[],
): void {
  const conflicts = collectTimelineOpConflicts(timeline, ops);
  if (conflicts.length === 0) return;
  throw new TimelineOpError(
    `Timeline operation has unresolved conflicts: ${conflicts
      .map((conflict) => `${conflict.reason}:${conflict.clipId}`)
      .join(', ')}`,
    'timeline_conflict',
  );
}

function flattenInverse(inverse: TimelineHistoryOperation): TimelineOp[] {
  return inverse.kind === 'timeline.batch' ? inverse.ops : [inverse];
}

export function undoProjectTimelineOp(
  project: VideoProject,
  now = new Date().toISOString(),
): ProjectTimelineOpExecution {
  const history = normalizedHistory(project.history);
  if (history.head <= 0) {
    throw new Error('No timeline operation to undo');
  }
  const entryIndex = history.head - 1;
  const entry = history.entries[entryIndex];
  if (!entry) throw new Error('No timeline operation to undo');
  const timeline = editableTimeline(project);
  const result = applyTimelineHistoryOperation(timeline, entry.inverse);
  const nextEntry: TimelineHistoryEntry = { ...entry, undone: true };
  const entries = history.entries.map((item, index) =>
    index === entryIndex ? nextEntry : item,
  );
  const nextTimeline = result.timeline as VideoTimeline;

  return {
    project: {
      ...project,
      timeline: nextTimeline,
      history: { head: entryIndex, entries },
      updatedAt: now,
    },
    timeline: nextTimeline,
    entry: nextEntry,
    inverse: entry.op,
  };
}

export function redoProjectTimelineOp(
  project: VideoProject,
  now = new Date().toISOString(),
): ProjectTimelineOpExecution {
  const history = normalizedHistory(project.history);
  const entry = history.entries[history.head];
  if (!entry) {
    throw new Error('No timeline operation to redo');
  }
  const timeline = editableTimeline(project);
  const result = applyTimelineHistoryOperation(timeline, entry.op);
  const nextEntry: TimelineHistoryEntry = { ...entry, undone: false };
  const entries = history.entries.map((item, index) =>
    index === history.head ? nextEntry : item,
  );
  const nextTimeline = result.timeline as VideoTimeline;

  return {
    project: {
      ...project,
      timeline: nextTimeline,
      history: { head: history.head + 1, entries },
      updatedAt: now,
    },
    timeline: nextTimeline,
    entry: nextEntry,
    inverse: entry.inverse,
  };
}

function applyTimelineHistoryOperation(
  timeline: Timeline,
  operation: TimelineHistoryOperation,
): { timeline: Timeline } {
  if (operation.kind === 'timeline.batch') {
    return applyTimelineOps(timeline, operation.ops);
  }
  return applyTimelineOp(timeline, operation);
}

function editableTimeline(project: VideoProject): Timeline {
  const timeline =
    project.timeline ?? rebuildTimelineFromStoryboard(project).timeline;
  if (!timeline) throw new Error('Timeline required');
  return timeline as Timeline;
}

function appendHistoryEntry(
  history: VideoTimelineHistory | undefined,
  entry: TimelineHistoryEntry,
): VideoTimelineHistory {
  const current = normalizedHistory(history);
  const entries = [...current.entries.slice(0, current.head), entry];
  const trimmedEntries = entries.slice(-MAX_TIMELINE_HISTORY_ENTRIES);
  return {
    entries: trimmedEntries,
    head: trimmedEntries.length,
  };
}

function normalizedHistory(
  history: VideoTimelineHistory | undefined,
): VideoTimelineHistory {
  const entries = history?.entries ?? [];
  const head =
    typeof history?.head === 'number'
      ? Math.max(0, Math.min(history.head, entries.length))
      : entries.filter((entry) => !entry.undone).length;
  return { entries, head };
}
