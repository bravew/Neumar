import { applyTimelineOps } from '@neumar/video-ir';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/video/flags', () => ({ getVideoFeatureFlag: () => true }));

import {
  buildTimelineEditToolOps,
  isTimelineEditAgentToolCall,
  videoAgentToolCallSchema,
} from '@/shared/video/agent-tools';
import { buildTranscriptWordOps } from '@/shared/video/analysis/transcript-agent-ops';
import type { VideoProject } from '@/shared/video/types';

const project = {
  id: 'p',
  sources: [{ id: 's', mediaItemId: 'a' }],
  sourceAnalyses: [
    {
      sourceId: 's',
      transcript: {
        words: [
          { text: 'one', startMs: 0, endMs: 1000 },
          { text: 'two', startMs: 1000, endMs: 2000 },
        ],
      },
    },
  ],
  timeline: {
    schema: 'neuma.video.timeline.v1',
    fps: 30,
    durationMs: 2000,
    tracks: [
      {
        id: 'v',
        kind: 'video',
        name: 'V',
        locked: false,
        muted: false,
        order: 0,
        clips: [
          {
            id: 'c',
            kind: 'video',
            sourceRef: { kind: 'asset', assetId: 'a' },
            startMs: 0,
            durationMs: 2000,
            trimStartMs: 0,
            trimEndMs: 2000,
          },
        ],
      },
    ],
  },
} as unknown as VideoProject;
const args = { sourceId: 's', startIndex: 1, endIndex: 1 };

describe('transcript agent tools', () => {
  it('parses the named tool and routes it through timeline edit operations', () => {
    const call = videoAgentToolCallSchema.parse({
      name: 'transcriptCutWords',
      args,
    });
    expect(isTimelineEditAgentToolCall(call)).toBe(true);
    if (!isTimelineEditAgentToolCall(call))
      throw new Error('Expected timeline tool');
    const built = buildTimelineEditToolOps(project, call);
    expect(built.ops[0]).toMatchObject({
      kind: 'clip.removeTimeRange',
      startMs: 1000,
      endMs: 2000,
    });
    const cut = applyTimelineOps(project.timeline!, built.ops).timeline;
    const restore = buildTranscriptWordOps(
      { ...project, timeline: cut },
      cut,
      'restore',
      args,
    );
    expect(applyTimelineOps(cut, restore.ops).timeline.durationMs).toBe(2000);
  });
  it('rejects out-of-range word selection and missing source', () => {
    expect(() =>
      buildTranscriptWordOps(project, project.timeline!, 'cut', {
        ...args,
        endIndex: 10,
      }),
    ).toThrow(/outside/);
    expect(() =>
      buildTranscriptWordOps(project, project.timeline!, 'cut', {
        ...args,
        sourceId: 'missing',
      }),
    ).toThrow('Source not found');
  });
  it('rejects edits on a locked track', () => {
    const locked = structuredClone(project.timeline!);
    locked.tracks[0]!.locked = true;
    expect(() => buildTranscriptWordOps(project, locked, 'cut', args)).toThrow(
      'Track is locked',
    );
  });
});
