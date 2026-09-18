import { TimelineOpSchema, applyTimelineOps } from '@neumar/video-ir';
import { describe, expect, it } from 'vitest';

import {
  allocateSectionDurations,
  assertRevisionMatch,
  FrameworkApplyError,
  frameworkToTimelineOps,
} from '@/shared/video/reference/apply';
import { bindFrameworkSlots } from '@/shared/video/reference/bind';
import type {
  FrameworkSection,
  MediaItem,
  VideoFramework,
  VideoProject,
} from '@/shared/video/types';

const SECTIONS: FrameworkSection[] = [
  {
    id: 'sec-hook',
    role: 'hook',
    purpose: 'Open',
    timing: { proportion: 0.25, minMs: 1000, maxMs: 1500, observedMs: 1000 },
    slots: [
      {
        id: 'slot-aroll',
        kind: 'a-roll',
        constraints: {},
        fallback: { kind: 'ask-user' },
        required: true,
      },
    ],
    systemIds: [],
    pacing: { cutsPerMinute: 0, shortestHoldMs: 1000, longestHoldMs: 1000 },
    confidence: 0.8,
    derivedFromSectionIds: ['sec-1'],
  },
  {
    id: 'sec-demo',
    role: 'demonstration',
    purpose: 'Show',
    timing: { proportion: 0.75, minMs: 1000, maxMs: 10000, observedMs: 3000 },
    slots: [
      {
        id: 'slot-broll',
        kind: 'b-roll',
        constraints: {},
        fallback: { kind: 'ask-user' },
        required: true,
      },
    ],
    systemIds: [],
    pacing: { cutsPerMinute: 4, shortestHoldMs: 400, longestHoldMs: 1200 },
    confidence: 0.7,
    derivedFromSectionIds: ['sec-2'],
  },
];

const FRAMEWORK: VideoFramework = {
  id: 'fw-apply',
  version: 1,
  displayName: 'Apply spine',
  category: 'explainer',
  hook: 'cold-open',
  pace: 'medium',
  aspectRatios: ['16:9'],
  totalDuration: { typicalMs: 4000, minMs: 2000, maxMs: 8000 },
  sections: SECTIONS,
  systems: [],
  provenance: {
    referenceId: 'ref-1',
    derivedFromArtifacts: ['analysis'],
    extractedBy: 'test',
    extractedAt: '2026-09-15T00:00:00.000Z',
  },
  confidence: 0.7,
};

function videoAsset(id: string): MediaItem {
  return {
    id,
    kind: 'video',
    source: 'user',
    path: `assets/${id}.mp4`,
    metadata: { durationMs: 8000, width: 1920, height: 1080 },
  };
}

function projectFixture(): VideoProject {
  return {
    id: 'project-apply',
    name: 'Apply',
    template: 'explainer',
    prompt: '',
    revision: 2,
    assets: [videoAsset('asset-one'), videoAsset('asset-two')],
    timeline: {
      schema: 'neuma.video.timeline.v1',
      fps: 30,
      durationMs: 0,
      tracks: [
        {
          id: 'track-video-main',
          kind: 'video',
          name: 'Video 1',
          muted: false,
          locked: false,
          hidden: false,
          order: 0,
          clips: [],
        },
        {
          id: 'track-broll',
          kind: 'broll',
          name: 'B-roll',
          muted: false,
          locked: false,
          hidden: false,
          order: 5,
          clips: [],
        },
      ],
    },
    createdAt: '2026-09-15T00:00:00.000Z',
    updatedAt: '2026-09-15T00:00:00.000Z',
  };
}

describe('framework apply', () => {
  it('distributes clamped remainder across sections with slack', () => {
    expect(allocateSectionDurations(SECTIONS, 8000)).toEqual([1500, 6500]);
  });

  it('builds invertible clip.insert ops from bound slots', () => {
    const project = projectFixture();
    const bindings = bindFrameworkSlots(project, FRAMEWORK);
    const built = frameworkToTimelineOps(project, FRAMEWORK, {
      targetMs: 8000,
      bindings,
    });
    expect(built.blocked).toEqual([]);
    expect(built.ops.length).toBeGreaterThan(0);
    for (const op of built.ops) {
      expect(TimelineOpSchema.parse(op).kind).toBe(op.kind);
    }
    const applied = applyTimelineOps(project.timeline!, built.ops);
    const restored = applyTimelineOps(applied.timeline, applied.inverses);
    expect(restored.timeline.tracks.map((track) => track.clips)).toEqual(
      project.timeline?.tracks.map((track) => track.clips),
    );
  });

  it('rejects a revision conflict with the existing plan message', () => {
    expect(() => assertRevisionMatch(projectFixture(), 1)).toThrowError(
      FrameworkApplyError,
    );
    try {
      assertRevisionMatch(projectFixture(), 1);
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toMatchObject({
        message: 'Project revision conflict: plan expects 1, current 2',
        code: 'revision-conflict',
      });
    }
  });
});
