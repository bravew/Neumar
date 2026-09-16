import { describe, expect, it } from 'vitest';

import { bindFrameworkSlots } from '@/shared/video/reference/bind';
import type {
  MediaItem,
  VideoFramework,
  VideoProject,
} from '@/shared/video/types';

const FRAMEWORK: VideoFramework = {
  id: 'fw-bind',
  version: 1,
  displayName: 'Bind spine',
  category: 'explainer',
  hook: 'cold-open',
  pace: 'medium',
  aspectRatios: ['16:9'],
  totalDuration: { typicalMs: 4000, minMs: 2000, maxMs: 8000 },
  sections: [
    {
      id: 'sec-hook',
      role: 'hook',
      purpose: 'Open',
      timing: { proportion: 0.5, minMs: 1000, maxMs: 4000, observedMs: 2000 },
      slots: [
        {
          id: 'slot-aroll',
          kind: 'a-roll',
          constraints: { minDurationMs: 1500, aspect: ['16:9'] },
          fallback: { kind: 'ask-user' },
          required: true,
        },
      ],
      systemIds: [],
      pacing: { cutsPerMinute: 0, shortestHoldMs: 1000, longestHoldMs: 2000 },
      confidence: 0.8,
      derivedFromSectionIds: ['sec-1'],
    },
    {
      id: 'sec-demo',
      role: 'demonstration',
      purpose: 'Show',
      timing: { proportion: 0.5, minMs: 1000, maxMs: 4000, observedMs: 2000 },
      slots: [
        {
          id: 'slot-broll',
          kind: 'b-roll',
          constraints: { subject: 'workflow' },
          fallback: { kind: 'broll-search', queryTemplate: 'workflow' },
          required: false,
        },
      ],
      systemIds: [],
      pacing: { cutsPerMinute: 4, shortestHoldMs: 400, longestHoldMs: 1200 },
      confidence: 0.7,
      derivedFromSectionIds: ['sec-2'],
    },
  ],
  systems: [],
  provenance: {
    referenceId: 'ref-1',
    derivedFromArtifacts: ['analysis'],
    extractedBy: 'test',
    extractedAt: '2026-09-15T00:00:00.000Z',
  },
  confidence: 0.7,
};

function asset(
  id: string,
  kind: MediaItem['kind'],
  durationMs: number,
  extras: Partial<MediaItem> = {},
): MediaItem {
  return {
    id,
    kind,
    source: 'user',
    path: `assets/${id}.bin`,
    metadata: { durationMs, width: 1920, height: 1080 },
    ...extras,
  };
}

function project(assets: MediaItem[]): VideoProject {
  return {
    id: 'project-bind',
    name: 'Bind',
    template: 'explainer',
    prompt: '',
    assets,
    createdAt: '2026-09-15T00:00:00.000Z',
    updatedAt: '2026-09-15T00:00:00.000Z',
  };
}

describe('bindFrameworkSlots', () => {
  it('filters by kind, duration, and aspect, and ranks stably', () => {
    const short = asset('asset-short', 'video', 400);
    const still = asset('asset-still', 'image', 4000);
    const first = asset('asset-aa', 'video', 4000);
    const second = asset('asset-bb', 'video', 4000);
    const bindings = bindFrameworkSlots(
      project([short, still, second, first]),
      FRAMEWORK,
    );
    const aroll = bindings.find((item) => item.slot.id === 'slot-aroll');
    expect(aroll?.chosen?.assetId).toBe('asset-aa');
    expect(aroll?.alternatives.map((item) => item.assetId)).toEqual([
      'asset-bb',
    ]);
    const again = bindFrameworkSlots(
      project([short, still, second, first]),
      FRAMEWORK,
    );
    expect(
      again.find((item) => item.slot.id === 'slot-aroll')?.chosen?.assetId,
    ).toBe('asset-aa');
  });

  it('reports a gap instead of binding a mismatched asset', () => {
    const bindings = bindFrameworkSlots(
      project([asset('asset-audio', 'audio', 4000)]),
      FRAMEWORK,
    );
    const aroll = bindings.find((item) => item.slot.id === 'slot-aroll');
    expect(aroll?.chosen).toBeNull();
    expect(aroll?.alternatives).toEqual([]);
  });
});
