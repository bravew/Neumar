import { describe, expect, it } from 'vitest';

import {
  applyProjectTimelineOp,
  applyProjectTimelineOps,
  proposeProjectTimelineOps,
  redoProjectTimelineOp,
  undoProjectTimelineOp,
} from '@/shared/video/timeline-ops';
import type { VideoProject } from '@/shared/video/types';

describe('video timeline op history', () => {
  it('applies timeline ops and replays undo/redo through the shared reducer', () => {
    const applied = applyProjectTimelineOp(projectFixture(), {
      now: '2026-05-30T12:00:00.000Z',
      source: 'user',
      summary: 'Move intro later',
      op: {
        kind: 'clip.move',
        clipId: 'clip-a',
        from: { trackId: 'track-video', startMs: 0 },
        to: { trackId: 'track-video', startMs: 250 },
      },
    });

    expect(applied.timeline.tracks[0]?.clips[0]).toMatchObject({
      id: 'clip-a',
      startMs: 250,
    });
    expect(applied.project.history).toMatchObject({
      head: 1,
      entries: [
        {
          id: expect.any(String),
          source: 'user',
          summary: 'Move intro later',
        },
      ],
    });

    const undone = undoProjectTimelineOp(
      applied.project,
      '2026-05-30T12:00:01.000Z',
    );

    expect(undone.timeline.tracks[0]?.clips[0]).toMatchObject({
      id: 'clip-a',
      startMs: 0,
    });
    expect(undone.project.history).toMatchObject({
      head: 0,
      entries: [{ undone: true }],
    });

    const redone = redoProjectTimelineOp(
      undone.project,
      '2026-05-30T12:00:02.000Z',
    );

    expect(redone.timeline.tracks[0]?.clips[0]).toMatchObject({
      id: 'clip-a',
      startMs: 250,
    });
    expect(redone.project.history).toMatchObject({
      head: 1,
      entries: [{ undone: false }],
    });
  });

  it('drops redo entries when a new op is applied after undo', () => {
    const first = applyProjectTimelineOp(projectFixture(), {
      op: {
        kind: 'clip.move',
        clipId: 'clip-a',
        from: { trackId: 'track-video', startMs: 0 },
        to: { trackId: 'track-video', startMs: 250 },
      },
    });
    const undone = undoProjectTimelineOp(first.project);
    const replacement = applyProjectTimelineOp(undone.project, {
      op: {
        kind: 'clip.trim',
        clipId: 'clip-a',
        from: {
          startMs: 0,
          durationMs: 1000,
          trimStartMs: 0,
          trimEndMs: 1000,
        },
        to: {
          startMs: 0,
          durationMs: 700,
          trimStartMs: 0,
          trimEndMs: 700,
        },
      },
    });

    expect(replacement.project.history?.head).toBe(1);
    expect(replacement.project.history?.entries).toHaveLength(1);
    expect(replacement.project.history?.entries[0]?.op.kind).toBe('clip.trim');
    expect(() => redoProjectTimelineOp(replacement.project)).toThrow(
      'No timeline operation to redo',
    );
  });

  it('applies a timeline op batch as one undoable history entry', () => {
    const applied = applyProjectTimelineOps(projectFixture(), {
      now: '2026-05-30T12:10:00.000Z',
      source: 'agent',
      summary: 'Move and tighten intro',
      journalId: 'batch-1',
      ops: [
        {
          kind: 'clip.move',
          clipId: 'clip-a',
          from: { trackId: 'track-video', startMs: 0 },
          to: { trackId: 'track-video', startMs: 200 },
        },
        {
          kind: 'clip.trim',
          clipId: 'clip-a',
          from: {
            startMs: 200,
            durationMs: 1000,
            trimStartMs: 0,
            trimEndMs: 1000,
          },
          to: {
            startMs: 200,
            durationMs: 700,
            trimStartMs: 0,
            trimEndMs: 700,
          },
        },
      ],
    });

    expect(applied.timeline.tracks[0]?.clips[0]).toMatchObject({
      startMs: 200,
      durationMs: 700,
    });
    const entry = applied.project.history?.entries[0];
    expect(applied.project.history?.head).toBe(1);
    expect(entry).toMatchObject({
      id: 'batch-1',
      op: { kind: 'timeline.batch' },
      inverse: { kind: 'timeline.batch' },
      summary: 'Move and tighten intro',
    });
    expect(
      entry?.op.kind === 'timeline.batch' ? entry.op.ops : [],
    ).toHaveLength(2);

    const undone = undoProjectTimelineOp(applied.project);
    expect(undone.timeline).toEqual(projectFixture().timeline);

    const redone = redoProjectTimelineOp(undone.project);
    expect(redone.timeline.tracks[0]?.clips[0]).toMatchObject({
      startMs: 200,
      durationMs: 700,
    });
  });

  it('returns proposal conflicts and rejects unsafe apply batches', () => {
    const project = projectFixture({
      syncLockedAudio: true,
      linked: true,
      extraAudioClip: {
        id: 'clip-bed',
        kind: 'audio',
        sourceRef: { kind: 'asset', assetId: 'asset-bed' },
        startMs: 1200,
        durationMs: 1000,
        trimStartMs: 0,
        trimEndMs: 1000,
      },
    });
    const ops = [
      {
        kind: 'clip.move' as const,
        clipId: 'clip-a',
        from: { trackId: 'track-video', startMs: 0 },
        to: { trackId: 'track-video', startMs: 500 },
      },
    ];

    const proposal = proposeProjectTimelineOps(project, { ops });

    expect(proposal.conflicts).toEqual([
      expect.objectContaining({
        clipId: 'clip-bed',
        reason: 'sync-lock',
      }),
    ]);
    expect(proposal.timeline).toEqual(project.timeline);
    expect(() => applyProjectTimelineOps(project, { ops })).toThrow(
      'Timeline operation has unresolved conflicts',
    );
  });
});

function projectFixture(
  options: {
    linked?: boolean;
    syncLockedAudio?: boolean;
    extraAudioClip?: NonNullable<
      VideoProject['timeline']
    >['tracks'][number]['clips'][number];
  } = {},
): VideoProject {
  const linkedFields = options.linked ? { linkGroupId: 'av-1' } : {};
  return {
    id: 'project-1',
    name: 'Project',
    template: 'custom',
    prompt: 'Make a video',
    assets: [],
    timeline: {
      schema: 'neuma.video.timeline.v1',
      fps: 30,
      durationMs: 1000,
      tracks: [
        {
          id: 'track-video',
          kind: 'video',
          name: 'Video',
          muted: false,
          locked: false,
          order: 0,
          clips: [
            {
              id: 'clip-a',
              kind: 'video',
              sourceRef: { kind: 'asset', assetId: 'asset-a' },
              ...linkedFields,
              startMs: 0,
              durationMs: 1000,
              trimStartMs: 0,
              trimEndMs: 1000,
            },
          ],
        },
        ...(options.linked
          ? [
              {
                id: 'track-audio',
                kind: 'audio-vo' as const,
                name: 'Voice',
                muted: false,
                locked: false,
                syncLocked: options.syncLockedAudio,
                order: 1,
                clips: [
                  {
                    id: 'clip-audio',
                    kind: 'audio' as const,
                    sourceRef: {
                      kind: 'asset' as const,
                      assetId: 'asset-audio',
                    },
                    ...linkedFields,
                    startMs: 0,
                    durationMs: 1000,
                    trimStartMs: 0,
                    trimEndMs: 1000,
                  },
                  ...(options.extraAudioClip ? [options.extraAudioClip] : []),
                ],
              },
            ]
          : []),
      ],
    },
    createdAt: '2026-05-30T00:00:00.000Z',
    updatedAt: '2026-05-30T00:00:00.000Z',
  };
}
