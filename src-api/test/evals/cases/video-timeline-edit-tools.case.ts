import {
  applyVideoAgentTool,
  type VideoAgentToolCall,
} from '@/shared/video/agent-tools';
import {
  redoProjectTimelineOp,
  undoProjectTimelineOp,
} from '@/shared/video/timeline-ops';
import type {
  TimelineClip,
  VideoProject,
  VideoTimeline,
  VisualTimelineClip,
} from '@/shared/video/types';

import type { EvalCase } from '../types';

// Phase 7 gate — deterministic agent-tool coverage for frame-first timeline
// edits. No LLM/network: each user intent goes through the named Video agent
// tool, the shared edit builders, project history, and undo/redo.

type TimelineEditToolCall = Extract<
  VideoAgentToolCall,
  {
    name:
      | 'cutClip'
      | 'cutRange'
      | 'duplicateClips'
      | 'setClipSpeed'
      | 'reverseClip'
      | 'rotateClip'
      | 'flipClip';
  }
>;

interface AppliedTool {
  project: VideoProject;
  undoRedoOk: boolean;
}

const NOW = '2026-06-20T00:00:00.000Z';

const evalCase: EvalCase = {
  id: 'video-timeline-edit-tools',
  name: 'Named video timeline edit tools apply frame-first and undo cleanly',
  tier: 'gate',
  touchfiles: [
    'packages/video-ir/src/edit-builders.ts',
    'packages/video-ir/src/timeline-ops.ts',
    'src-api/src/shared/video/agent-tools.ts',
    'src-api/src/shared/video/timeline-ops.ts',
    'src-api/src/shared/mcp/video-edit-server.ts',
  ],
  budget: { maxUsd: 0, timeoutMs: 10_000 },
  run: () => {
    const checks = {
      splitAtPlayhead: checkSplitAtPlayhead(),
      duplicateSelectedClip: checkDuplicateSelectedClip(),
      rippleDeleteFillerRange: checkRippleDeleteFillerRange(),
      linkedSpeedChange: checkLinkedSpeedChange(),
      reverseShortClip: checkReverseShortClip(),
      rotateAndFlipOverlay: checkRotateAndFlipOverlay(),
    };
    const undoRedoOk = Object.values(checks).every((check) => check.undoRedoOk);
    const behaviorOk = Object.values(checks).every((check) => check.behaviorOk);
    const passed = behaviorOk && undoRedoOk;
    const totalChecks = Object.keys(checks).length * 2;
    const passedChecks =
      Object.values(checks).filter((check) => check.behaviorOk).length +
      Object.values(checks).filter((check) => check.undoRedoOk).length;

    return {
      passed,
      score: passedChecks / totalChecks,
      notes: passed
        ? 'named timeline edit tools preserve behavior and undo/redo'
        : failingNotes(checks),
      metrics: {
        schema: baseProject().timeline?.schema,
        behaviorOk,
        undoRedoOk,
        checks,
      },
    };
  },
};

export default evalCase;

function checkSplitAtPlayhead(): { behaviorOk: boolean; undoRedoOk: boolean } {
  const result = applyTimelineTool(
    baseProject({ linkedAudio: true, downstreamVideo: true }),
    {
      name: 'cutClip',
      args: {
        clipId: 'clip-video-a',
        atFrame: 60,
        retain: 'both',
        linkPolicy: 'linked',
        summary: 'Split at the current playhead',
      },
      reasoning: 'gate eval',
    },
    'eval-split',
  );
  const video = clipsOn(result.project, 'track-video');
  const audio = clipsOn(result.project, 'track-audio');
  const behaviorOk =
    video.some((clip) => clip.startMs === 0 && clip.durationMs === 2000) &&
    video.some((clip) => clip.startMs === 2000 && clip.durationMs === 1000) &&
    audio.some((clip) => clip.startMs === 0 && clip.durationMs === 2000) &&
    audio.some((clip) => clip.startMs === 2000 && clip.durationMs === 1000);
  return { behaviorOk, undoRedoOk: result.undoRedoOk };
}

function checkDuplicateSelectedClip(): {
  behaviorOk: boolean;
  undoRedoOk: boolean;
} {
  const result = applyTimelineTool(
    baseProject({ linkedAudio: true }),
    {
      name: 'duplicateClips',
      args: {
        clipIds: ['clip-video-a'],
        placement: { kind: 'after-originals' },
        linkPolicy: 'linked',
        summary: 'Duplicate the selected linked clip',
      },
      reasoning: 'gate eval',
    },
    'eval-duplicate',
  );
  const duplicatedVideo = clipsOn(result.project, 'track-video').find(
    (clip) => clip.id !== 'clip-video-a' && clip.startMs === 3000,
  );
  const duplicatedAudio = clipsOn(result.project, 'track-audio').find(
    (clip) => clip.id !== 'clip-audio-a' && clip.startMs === 3000,
  );
  const behaviorOk =
    Boolean(duplicatedVideo) &&
    Boolean(duplicatedAudio) &&
    duplicatedVideo?.linkGroupId === duplicatedAudio?.linkGroupId &&
    duplicatedVideo?.linkGroupId !== 'link-av-a';
  return { behaviorOk, undoRedoOk: result.undoRedoOk };
}

function checkRippleDeleteFillerRange(): {
  behaviorOk: boolean;
  undoRedoOk: boolean;
} {
  const result = applyTimelineTool(
    baseProject({ downstreamVideo: true }),
    {
      name: 'cutRange',
      args: {
        trackId: 'track-video',
        startFrame: 0,
        endFrame: 15,
        ripple: true,
        summary: 'Remove the selected filler word range',
      },
      reasoning: 'gate eval',
    },
    'eval-cut-range',
  );
  const primary = clipById(result.project, 'clip-video-a');
  const downstream = clipById(result.project, 'clip-video-b');
  const behaviorOk =
    primary?.startMs === 0 &&
    primary.durationMs === 2500 &&
    primary.trimStartMs === 500 &&
    downstream?.startMs === 3000;
  return { behaviorOk, undoRedoOk: result.undoRedoOk };
}

function checkLinkedSpeedChange(): {
  behaviorOk: boolean;
  undoRedoOk: boolean;
} {
  const result = applyTimelineTool(
    baseProject({ linkedAudio: true }),
    {
      name: 'setClipSpeed',
      args: {
        clipIds: ['clip-video-a'],
        speed: 2,
        timingPolicy: 'preserve-source-span',
        linkPolicy: 'linked',
        ripple: true,
        summary: 'Play the linked clip at 2x',
      },
      reasoning: 'gate eval',
    },
    'eval-speed',
  );
  const video = clipById(result.project, 'clip-video-a');
  const audio = clipById(result.project, 'clip-audio-a');
  const behaviorOk =
    video?.playback?.speed === 2 &&
    audio?.playback?.speed === 2 &&
    video.durationMs === 1500 &&
    audio.durationMs === 1500;
  return { behaviorOk, undoRedoOk: result.undoRedoOk };
}

function checkReverseShortClip(): { behaviorOk: boolean; undoRedoOk: boolean } {
  const result = applyTimelineTool(
    baseProject({ videoDurationMs: 1000 }),
    {
      name: 'reverseClip',
      args: {
        clipIds: ['clip-video-a'],
        reverse: true,
        linkPolicy: 'primary-only',
        summary: 'Reverse the short clip',
      },
      reasoning: 'gate eval',
    },
    'eval-reverse',
  );
  const clip = clipById(result.project, 'clip-video-a');
  const behaviorOk =
    Boolean(clip) &&
    clip?.playback?.reverse === true &&
    clip.durationMs === 1000;
  return { behaviorOk, undoRedoOk: result.undoRedoOk };
}

function checkRotateAndFlipOverlay(): {
  behaviorOk: boolean;
  undoRedoOk: boolean;
} {
  const rotated = applyTimelineTool(
    baseProject({ overlay: true }),
    {
      name: 'rotateClip',
      args: {
        clipIds: ['clip-overlay-a'],
        degrees: 90,
        relative: true,
        summary: 'Rotate the overlay right',
      },
      reasoning: 'gate eval',
    },
    'eval-rotate',
  );
  const flipped = applyTimelineTool(
    rotated.project,
    {
      name: 'flipClip',
      args: {
        clipIds: ['clip-overlay-a'],
        horizontal: true,
        vertical: true,
        mode: 'toggle',
        summary: 'Flip the overlay',
      },
      reasoning: 'gate eval',
    },
    'eval-flip',
  );
  const overlay = clipById(flipped.project, 'clip-overlay-a') as
    | VisualTimelineClip
    | undefined;
  const behaviorOk =
    Boolean(overlay?.transforms) &&
    overlay?.transforms?.rotation === 90 &&
    overlay.transforms.scaleX === -1 &&
    overlay.transforms.scaleY === -1;
  return {
    behaviorOk,
    undoRedoOk: rotated.undoRedoOk && flipped.undoRedoOk,
  };
}

function applyTimelineTool(
  project: VideoProject,
  call: TimelineEditToolCall,
  journalId: string,
): AppliedTool {
  const beforeTimeline = project.timeline;
  const execution = applyVideoAgentTool(project, call, {
    now: NOW,
    journalId,
  });
  const afterTimeline = execution.project.timeline;
  const undone = undoProjectTimelineOp(
    execution.project,
    '2026-06-20T00:00:01.000Z',
  );
  const redone = redoProjectTimelineOp(
    undone.project,
    '2026-06-20T00:00:02.000Z',
  );
  return {
    project: execution.project,
    undoRedoOk:
      timelineEqual(undone.timeline, beforeTimeline) &&
      timelineEqual(redone.timeline, afterTimeline),
  };
}

function baseProject(
  options: {
    linkedAudio?: boolean;
    downstreamVideo?: boolean;
    overlay?: boolean;
    videoDurationMs?: number;
  } = {},
): VideoProject {
  const videoDurationMs = options.videoDurationMs ?? 3000;
  const tracks: VideoTimeline['tracks'] = [
    {
      id: 'track-video',
      kind: 'video',
      name: 'Video',
      muted: false,
      locked: false,
      order: 0,
      clips: [
        videoClip({
          id: 'clip-video-a',
          durationMs: videoDurationMs,
          linkGroupId: options.linkedAudio ? 'link-av-a' : undefined,
        }),
        ...(options.downstreamVideo
          ? [
              videoClip({
                id: 'clip-video-b',
                startMs: videoDurationMs + 500,
                durationMs: 1000,
              }),
            ]
          : []),
      ],
    },
    ...(options.linkedAudio
      ? [
          {
            id: 'track-audio',
            kind: 'audio-vo' as const,
            name: 'Voice',
            muted: false,
            locked: false,
            order: 1,
            clips: [
              {
                id: 'clip-audio-a',
                kind: 'audio' as const,
                sourceRef: { kind: 'asset' as const, assetId: 'asset-audio' },
                linkGroupId: 'link-av-a',
                startMs: 0,
                durationMs: videoDurationMs,
                trimStartMs: 0,
                trimEndMs: videoDurationMs,
                sourceDurationMs: videoDurationMs,
              },
            ],
          },
        ]
      : []),
    ...(options.overlay
      ? [
          {
            id: 'track-overlay',
            kind: 'overlay' as const,
            name: 'Overlay',
            muted: false,
            locked: false,
            hidden: false,
            order: 2,
            clips: [
              {
                id: 'clip-overlay-a',
                kind: 'image' as const,
                sourceRef: { kind: 'asset' as const, assetId: 'asset-overlay' },
                startMs: 500,
                durationMs: 1000,
                trimStartMs: 0,
                trimEndMs: 1000,
                sourceDurationMs: 1000,
                transforms: { scale: 1 },
              },
            ],
          },
        ]
      : []),
  ];

  return {
    id: 'eval-video-edit-tools',
    name: 'Timeline edit tools eval',
    template: 'custom',
    prompt: 'Exercise frame-first timeline edits',
    assets: [],
    timeline: {
      schema: 'neuma.video.timeline.v1',
      fps: 30,
      durationMs: Math.max(
        ...tracks.flatMap((track) =>
          track.clips.map((clip) => clip.startMs + clip.durationMs),
        ),
      ),
      tracks,
    },
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function videoClip(input: {
  id: string;
  startMs?: number;
  durationMs: number;
  linkGroupId?: string;
}): VisualTimelineClip {
  return {
    id: input.id,
    kind: 'video',
    sourceRef: { kind: 'asset', assetId: `asset-${input.id}` },
    ...(input.linkGroupId ? { linkGroupId: input.linkGroupId } : {}),
    startMs: input.startMs ?? 0,
    durationMs: input.durationMs,
    trimStartMs: 0,
    trimEndMs: input.durationMs,
    sourceDurationMs: input.durationMs,
  };
}

function clipsOn(project: VideoProject, trackId: string): TimelineClip[] {
  return (
    project.timeline?.tracks.find((track) => track.id === trackId)?.clips ?? []
  );
}

function clipById(
  project: VideoProject,
  clipId: string,
): TimelineClip | undefined {
  return project.timeline?.tracks
    .flatMap((track) => track.clips)
    .find((clip) => clip.id === clipId);
}

function timelineEqual(
  left: VideoTimeline | undefined,
  right: VideoTimeline | undefined,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function failingNotes(
  checks: Record<string, { behaviorOk: boolean; undoRedoOk: boolean }>,
): string {
  return Object.entries(checks)
    .filter(([, check]) => !check.behaviorOk || !check.undoRedoOk)
    .map(
      ([name, check]) =>
        `${name}: behavior=${check.behaviorOk} undoRedo=${check.undoRedoOk}`,
    )
    .join('; ');
}
