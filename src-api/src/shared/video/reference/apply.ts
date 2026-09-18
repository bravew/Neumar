import type { Timeline, TimelineOp, TimelineTrack } from '@neumar/video-ir';

import {
  enforceVideoCostApproval,
  type VideoCostApproval,
} from '@/shared/video/cost-approval';
import { getReferenceFramework } from '@/shared/video/reference/framework-extract';
import { getProject, updateProjectDocument } from '@/shared/video/store';
import {
  applyProjectTimelineOps,
  proposeProjectTimelineOps,
} from '@/shared/video/timeline-ops';
import type {
  FrameworkSection,
  TranscriptData,
  VideoFramework,
  VideoProject,
} from '@/shared/video/types';

import { bindFrameworkSlots, wantedAssetKind, type BoundSlot } from './bind';
import { reportFrameworkGaps, type FrameworkGap } from './gap-report';

const AUDIO_FADE_MS = 30;
const WORD_PAD_MIN_MS = 30;
const WORD_PAD_MAX_MS = 200;
const WORD_PAD_MS = 80;

export class FrameworkApplyError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'missing-framework'
      | 'stale'
      | 'blocked-gaps'
      | 'revision-conflict'
      | 'cost-approval' = 'missing-framework',
  ) {
    super(message);
    this.name = 'FrameworkApplyError';
  }
}

export interface ApplyFrameworkInput {
  targetMs?: number;
  bindings?: BoundSlot[];
  waivedSlotIds?: string[];
  transcripts?: Record<string, TranscriptData>;
  expectedProjectRevision?: number;
  costApproval?: VideoCostApproval;
}

export function allocateSectionDurations(
  sections: FrameworkSection[],
  targetMs: number,
): number[] {
  const specs = sections.map((section) => ({
    desired: Math.max(500, Math.round(section.timing.proportion * targetMs)),
    min: Math.max(500, section.timing.minMs),
    max: Math.max(section.timing.minMs, section.timing.maxMs),
  }));
  const allocated = specs.map((spec) =>
    Math.min(spec.max, Math.max(spec.min, spec.desired)),
  );
  let remainder = targetMs - allocated.reduce((sum, value) => sum + value, 0);
  const slack = allocated.map((value, index) =>
    remainder >= 0 ? specs[index]!.max - value : value - specs[index]!.min,
  );
  while (remainder !== 0 && slack.some((value) => value > 0)) {
    for (let index = 0; index < allocated.length && remainder !== 0; index++) {
      if (slack[index]! <= 0) continue;
      const step = remainder > 0 ? 1 : -1;
      allocated[index]! += step;
      slack[index]! -= 1;
      remainder -= step;
    }
  }
  return allocated;
}

export function frameworkToTimelineOps(
  project: VideoProject,
  framework: VideoFramework,
  input: ApplyFrameworkInput,
): { ops: TimelineOp[]; gaps: FrameworkGap[]; blocked: FrameworkGap[] } {
  const bindings =
    input.bindings ??
    bindFrameworkSlots(project, framework, { transcripts: input.transcripts });
  const gaps = reportFrameworkGaps(bindings);
  const waived = new Set(input.waivedSlotIds ?? []);
  const blocked = gaps.filter((gap) => gap.required && !waived.has(gap.slotId));
  if (blocked.length > 0) {
    return { ops: [], gaps, blocked };
  }
  const targetMs = Math.max(
    1000,
    input.targetMs ?? framework.totalDuration.typicalMs,
  );
  const durations = allocateSectionDurations(framework.sections, targetMs);
  const timeline =
    project.timeline ??
    ({
      schema: 'neuma.video.timeline.v1',
      fps: 30,
      durationMs: 0,
      tracks: [],
    } satisfies Timeline);
  const ops: TimelineOp[] = [];
  const trackIds = ensureTracks(timeline, framework, ops);
  let cursor = 0;
  framework.sections.forEach((section, index) => {
    const durationMs = durations[index] ?? section.timing.minMs;
    for (const slot of section.slots) {
      const binding = bindings.find(
        (item) => item.sectionId === section.id && item.slot.id === slot.id,
      );
      const chosen = binding?.chosen;
      if (!chosen) continue;
      const asset = project.assets.find((item) => item.id === chosen.assetId);
      if (!asset) continue;
      const clipKind =
        wantedAssetKind(slot.kind) === 'audio'
          ? 'audio'
          : wantedAssetKind(slot.kind) === 'image'
            ? 'image'
            : 'video';
      const trackId =
        trackIds[
          clipKind === 'audio'
            ? slotTrack(slot.kind)
            : clipKind === 'image'
              ? 'video'
              : slotTrack(slot.kind)
        ];
      const trim = trimWindow(
        asset.metadata.durationMs,
        durationMs,
        slot.constraints.requiresSpeech
          ? input.transcripts?.[asset.id]
          : undefined,
      );
      const clipId = sanitizeClipId(`fw-${framework.id}-${slot.id}`);
      ops.push({
        kind: 'clip.insert',
        trackId,
        at: cursor,
        clip: {
          id: clipId,
          kind: clipKind,
          sourceRef: { kind: 'asset', assetId: asset.id },
          startMs: cursor,
          durationMs: trim[1] - trim[0],
          trimStartMs: trim[0],
          trimEndMs: trim[1],
          ...(clipKind === 'audio'
            ? { fadeInMs: AUDIO_FADE_MS, fadeOutMs: AUDIO_FADE_MS }
            : {}),
          params: {
            frameworkId: framework.id,
            frameworkSlotId: slot.id,
            frameworkSectionId: section.id,
            bindReason: chosen.reason,
          },
        },
      });
    }
    cursor += durationMs;
  });
  return { ops, gaps, blocked };
}

export function assertRevisionMatch(
  project: VideoProject,
  expectedProjectRevision?: number,
): void {
  if (
    expectedProjectRevision !== undefined &&
    project.revision !== expectedProjectRevision
  ) {
    throw new FrameworkApplyError(
      `Project revision conflict: plan expects ${expectedProjectRevision}, current ${project.revision}`,
      'revision-conflict',
    );
  }
}

export async function findProjectFramework(
  projectId: string,
  frameworkId: string,
): Promise<{
  framework: VideoFramework;
  stale: boolean;
  referenceId: string;
}> {
  const project = await getProject(projectId);
  for (const reference of project.videoReferences ?? []) {
    const loaded = await getReferenceFramework(projectId, reference.id);
    if (loaded?.framework.id === frameworkId) {
      return {
        framework: loaded.framework,
        stale: loaded.stale,
        referenceId: reference.id,
      };
    }
  }
  throw new FrameworkApplyError('Framework not found.', 'missing-framework');
}

export async function previewFrameworkApply(
  projectId: string,
  frameworkId: string,
  input: ApplyFrameworkInput,
) {
  const project = await getProject(projectId);
  const loaded = await findProjectFramework(projectId, frameworkId);
  if (loaded.stale) {
    throw new FrameworkApplyError(
      'Framework is stale. Re-extract before applying.',
      'stale',
    );
  }
  const built = frameworkToTimelineOps(project, loaded.framework, input);
  if (built.blocked.length > 0 || built.ops.length === 0) {
    return { ...built, proposal: null, projectId };
  }
  const proposal = proposeProjectTimelineOps(project, { ops: built.ops });
  return { ...built, proposal, projectId };
}

export async function applyFrameworkToProject(
  projectId: string,
  frameworkId: string,
  input: ApplyFrameworkInput,
): Promise<VideoProject> {
  return updateProjectDocument(projectId, async (project) => {
    assertRevisionMatch(project, input.expectedProjectRevision);
    const loaded = await findProjectFramework(projectId, frameworkId);
    if (loaded.stale) {
      throw new FrameworkApplyError(
        'Framework is stale. Re-extract before applying.',
        'stale',
      );
    }
    const built = frameworkToTimelineOps(project, loaded.framework, input);
    if (built.blocked.length > 0) {
      const costCents = built.blocked.reduce(
        (sum, gap) => sum + gap.estimatedCents,
        0,
      );
      if (costCents > 0) {
        enforceVideoCostApproval(project, {
          estimatedCents: costCents,
          approval: input.costApproval,
          scopeId: `framework-apply:${frameworkId}`,
        });
      }
      throw new FrameworkApplyError(
        'Unfilled required slots block apply until each is bound or waived.',
        'blocked-gaps',
      );
    }
    if (built.ops.length === 0) {
      throw new FrameworkApplyError(
        'Unfilled required slots block apply until each is bound or waived.',
        'blocked-gaps',
      );
    }
    const execution = applyProjectTimelineOps(project, {
      ops: built.ops,
      source: 'agent',
      summary: `Apply framework ${loaded.framework.displayName}`,
    });
    return execution.project;
  });
}

function slotTrack(
  slotKind: string,
): 'video' | 'broll' | 'audio-vo' | 'audio-music' {
  const kind = slotKind.toLowerCase();
  if (/music/.test(kind)) return 'audio-music';
  if (/(audio|narration|voice|sfx)/.test(kind)) return 'audio-vo';
  if (/(b-roll|broll)/.test(kind)) return 'broll';
  return 'video';
}

function ensureTracks(
  timeline: Timeline,
  framework: VideoFramework,
  ops: TimelineOp[],
): Record<string, string> {
  const ids: Record<string, string> = {
    video: findTrack(timeline, 'video') ?? 'track-video-main',
    broll: findTrack(timeline, 'broll') ?? 'track-broll',
    'audio-vo': findTrack(timeline, 'audio-vo') ?? 'track-audio-vo',
    'audio-music': findTrack(timeline, 'audio-music') ?? 'track-audio-music',
  };
  const needed = new Set(
    framework.sections.flatMap((section) =>
      section.slots.map((slot) => slotTrack(slot.kind)),
    ),
  );
  needed.add('video');
  const specs: Array<{
    key: string;
    id: string;
    kind: TimelineTrack['kind'];
    name: string;
    order: number;
  }> = [
    { key: 'video', id: ids.video!, kind: 'video', name: 'Video 1', order: 0 },
    { key: 'broll', id: ids.broll!, kind: 'broll', name: 'B-roll', order: 5 },
    {
      key: 'audio-vo',
      id: ids['audio-vo']!,
      kind: 'audio-vo',
      name: 'Voiceover',
      order: 10,
    },
    {
      key: 'audio-music',
      id: ids['audio-music']!,
      kind: 'audio-music',
      name: 'Music',
      order: 20,
    },
  ];
  for (const spec of specs) {
    if (!needed.has(spec.key as 'video')) continue;
    if (timeline.tracks.some((track) => track.id === spec.id)) continue;
    ops.push({
      kind: 'track.insert',
      index:
        timeline.tracks.length +
        ops.filter((op) => op.kind === 'track.insert').length,
      track: {
        id: spec.id,
        kind: spec.kind,
        name: spec.name,
        muted: false,
        locked: false,
        hidden:
          spec.kind === 'video' || spec.kind === 'broll' ? false : undefined,
        order: spec.order,
        clips: [],
      } as TimelineTrack,
    });
  }
  return ids;
}

function findTrack(
  timeline: Timeline,
  kind: TimelineTrack['kind'],
): string | undefined {
  return timeline.tracks.find((track) => track.kind === kind)?.id;
}

function trimWindow(
  sourceDurationMs: number,
  durationMs: number,
  transcript?: TranscriptData,
): [number, number] {
  const wanted = Math.min(sourceDurationMs, Math.max(500, durationMs));
  let start = 0;
  let end = wanted;
  if (transcript?.words.length) {
    const pad = Math.min(
      WORD_PAD_MAX_MS,
      Math.max(WORD_PAD_MIN_MS, WORD_PAD_MS),
    );
    const first = transcript.words[0]!;
    const last =
      transcript.words.find((word) => word.endMs >= wanted) ??
      transcript.words.at(-1)!;
    start = Math.max(0, first.startMs - pad);
    end = Math.min(
      sourceDurationMs,
      Math.max(start + wanted, last.endMs + pad),
    );
    if (end - start < wanted) {
      end = Math.min(sourceDurationMs, start + wanted);
    }
  }
  return [start, end];
}

function sanitizeClipId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_@-]/g, '-').slice(0, 80);
}
