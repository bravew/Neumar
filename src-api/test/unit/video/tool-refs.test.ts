import { describe, expect, it } from 'vitest';

import {
  hasVideoRefs,
  resolveVideoRefs,
  VideoRefResolutionError,
} from '@/shared/video/tool-refs';
import type { VideoProject } from '@/shared/video/types';

function project(): VideoProject {
  return {
    schemaVersion: 2,
    id: 'project-1',
    name: 'Refs',
    template: 'product-reel',
    prompt: 'refs',
    assets: [],
    sources: [],
    linkedSources: [],
    sourceAnalyses: [],
    cutPlans: [],
    scenes: [],
    timeline: {
      schema: 'neuma.video.timeline.v1',
      durationMs: 9000,
      fps: 30,
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
              sourceRef: { kind: 'asset', assetId: 'a' },
              startMs: 0,
              durationMs: 3000,
              trimStartMs: 0,
              trimEndMs: 3000,
            },
            {
              id: 'clip-b',
              kind: 'video',
              sourceRef: { kind: 'asset', assetId: 'a' },
              startMs: 3000,
              durationMs: 3000,
              trimStartMs: 0,
              trimEndMs: 3000,
            },
          ],
        },
        {
          id: 'track-music',
          kind: 'audio-music',
          name: 'Music',
          muted: false,
          locked: false,
          order: 1,
          clips: [
            {
              id: 'clip-music',
              kind: 'audio',
              sourceRef: { kind: 'asset', assetId: 'm' },
              startMs: 0,
              durationMs: 9000,
              trimStartMs: 0,
              trimEndMs: 9000,
            },
          ],
        },
      ],
    },
    render: { status: 'idle', updatedAt: '2026-08-22T00:00:00.000Z' },
    budget: { capUsd: 5, spentUsd: 0 },
    outputs: [],
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z',
  } as VideoProject;
}

function resolve(
  value: unknown,
  refs?: Parameters<typeof resolveVideoRefs>[0]['refs'],
) {
  return resolveVideoRefs({ value, project: project(), refs });
}

describe('hasVideoRefs', () => {
  it('is false for literal ids so the dispatcher can skip the project read', () => {
    expect(hasVideoRefs({ clipId: 'clip-a', trackId: 'track-video' })).toBe(
      false,
    );
  });

  it('finds refs nested inside arrays and objects', () => {
    expect(hasVideoRefs({ moves: [{ clipId: '$selection' }] })).toBe(true);
    expect(hasVideoRefs({ ops: [{ trackId: 'trackIndex:1' }] })).toBe(true);
  });
});

describe('resolveVideoRefs', () => {
  it('resolves $selection when exactly one clip is selected', () => {
    expect(
      resolve({ clipId: '$selection' }, { selectionClipIds: ['clip-b'] }),
    ).toEqual({ clipId: 'clip-b' });
  });

  it('refuses $selection when the selection is ambiguous', () => {
    expect(() =>
      resolve({ clipId: '$selection' }, { selectionClipIds: ['a', 'b'] }),
    ).toThrow(VideoRefResolutionError);
  });

  it('resolves clipIndex on the default video track', () => {
    expect(resolve({ clipId: 'clipIndex:1' })).toEqual({ clipId: 'clip-b' });
  });

  it('supports negative clip indexes', () => {
    expect(resolve({ clipId: 'clipIndex:-1' })).toEqual({ clipId: 'clip-b' });
  });

  it('honours an explicit sibling trackId when resolving clipIndex', () => {
    expect(resolve({ trackId: 'track-music', clipId: 'clipIndex:0' })).toEqual({
      trackId: 'track-music',
      clipId: 'clip-music',
    });
  });

  it('resolves trackIndex:<n>:clipIndex:<m>', () => {
    expect(resolve({ clipId: 'trackIndex:1:clipIndex:0' })).toEqual({
      clipId: 'clip-music',
    });
  });

  it('resolves atSec to the clip covering that time', () => {
    expect(resolve({ clipId: 'atSec:4' })).toEqual({ clipId: 'clip-b' });
    expect(resolve({ clipId: 'atSec:0' })).toEqual({ clipId: 'clip-a' });
  });

  it('reports the gap when no clip covers the time', () => {
    expect(() => resolve({ clipId: 'atSec:8' })).toThrow(/no clip covers 8s/);
  });

  it('resolves track refs', () => {
    expect(resolve({ trackId: 'trackIndex:1' })).toEqual({
      trackId: 'track-music',
    });
  });

  it('resolves every entry of a clipIds array, leaving literals alone', () => {
    expect(
      resolve(
        { clipIds: ['clip-a', 'clipIndex:1', '$selection'] },
        { selectionClipIds: ['clip-music'] },
      ),
    ).toEqual({ clipIds: ['clip-a', 'clip-b', 'clip-music'] });
  });

  it('resolves refs nested in a moves array', () => {
    expect(
      resolve({
        moves: [{ clipId: 'atSec:1', toFrame: 0, toTrackId: 'trackIndex:1' }],
      }),
    ).toEqual({
      moves: [{ clipId: 'clip-a', toFrame: 0, toTrackId: 'track-music' }],
    });
  });

  it('resolves $key: against keys minted earlier in a batch', () => {
    expect(
      resolve({ clipId: '$key:intro' }, { keyedClipIds: { intro: 'new-1' } }),
    ).toEqual({ clipId: 'new-1' });
  });

  it('rejects a $key: that was never minted', () => {
    expect(() => resolve({ clipId: '$key:missing' })).toThrow(
      /symbolic key "missing"/,
    );
  });

  it('leaves non-ref payloads untouched', () => {
    const input = { clipId: 'clip-a', summary: 'no refs here', nested: [1, 2] };
    expect(resolve(input)).toEqual(input);
  });
});
