import { describe, expect, it } from 'vitest';

import {
  buildCreditLine,
  collectProjectAttributions,
  requiredAttributions,
} from '@/shared/video/attribution';
import {
  AI_DISCLOSURE,
  buildExportMetadata,
  disclosureSidecarPath,
} from '@/shared/video/export-metadata';
import type { VideoProject } from '@/shared/video/types';

function project(assets: VideoProject['assets']): VideoProject {
  return {
    id: 'p1',
    name: 'My Clip',
    template: 'explainer',
    prompt: '',
    assets,
  } as VideoProject;
}

const requiredAsset = {
  id: 'a1',
  kind: 'image' as const,
  source: 'broll' as const,
  path: 'a1.jpg',
  provenance: {
    provider: 'pexels',
    attribution: 'Photo by Jane',
    attributionRequired: true,
    license: 'pexels',
    sourceDisplayName: 'Jane',
  },
};

describe('attribution aggregation', () => {
  it('collects credits from asset provenance and flags required ones', () => {
    const credits = collectProjectAttributions(project([requiredAsset]));
    expect(credits).toEqual([
      {
        source: 'Jane',
        attribution: 'Photo by Jane',
        license: 'pexels',
        required: true,
      },
    ]);
  });

  it('ignores assets with no attribution string', () => {
    expect(
      collectProjectAttributions(
        project([
          {
            id: 'x',
            kind: 'image',
            source: 'ai-image',
            path: 'x.jpg',
            provenance: { provider: 'seedream-5-0' },
          },
        ]),
      ),
    ).toEqual([]);
  });

  it('dedupes by normalized credit and keeps required if any requires it', () => {
    const credits = collectProjectAttributions(
      project([
        {
          ...requiredAsset,
          id: 'a1',
          provenance: {
            ...requiredAsset.provenance,
            attributionRequired: false,
          },
        },
        { ...requiredAsset, id: 'a2' },
      ]),
    );
    expect(credits).toHaveLength(1);
    expect(credits[0]?.required).toBe(true);
  });

  it('requiredAttributions filters to mandatory credits', () => {
    expect(requiredAttributions(project([requiredAsset]))).toHaveLength(1);
  });

  it('buildCreditLine joins or returns undefined', () => {
    expect(buildCreditLine([])).toBeUndefined();
    expect(
      buildCreditLine([
        { source: 'a', attribution: 'A', required: true },
        { source: 'b', attribution: 'B', required: false },
      ]),
    ).toBe('Credits: A · B');
  });
});

describe('buildExportMetadata', () => {
  it('always marks AI-generated and embeds credits', () => {
    const meta = buildExportMetadata(project([requiredAsset]));
    expect(meta.aiGenerated).toBe(true);
    expect(meta.title).toBe('My Clip');
    expect(meta.artist).toBe('Credits: Photo by Jane');
    expect(meta.comment).toContain(AI_DISCLOSURE);
    expect(meta.comment).toContain('Photo by Jane');
  });

  it('omits artist when there are no credits but still discloses AI', () => {
    const meta = buildExportMetadata(project([]));
    expect(meta.artist).toBeUndefined();
    expect(meta.comment).toBe(AI_DISCLOSURE);
    expect(meta.warnings).toEqual([]);
  });

  it('warns when an export contains unverified YouTube sources', () => {
    const meta = buildExportMetadata(
      project([
        {
          id: 'yt-1',
          kind: 'video',
          source: 'broll',
          path: 'yt-1.mp4',
          metadata: { durationMs: 1000 },
          provenance: {
            provider: 'youtube-unverified',
            sourceDisplayName: 'Reference demo',
            sourceUrl: 'https://www.youtube.com/watch?v=demo',
          },
        },
      ]),
    );

    expect(meta.warnings).toEqual([
      'YouTube source "Reference demo" has unverified rights; confirm license and attribution before publishing.',
    ]);
    expect(meta.comment).toContain('Warnings:');
    expect(meta.comment).toContain('Reference demo');
  });
});

describe('disclosureSidecarPath', () => {
  it('appends .credits.json to the output path', () => {
    expect(disclosureSidecarPath('out/out.mp4')).toBe(
      'out/out.mp4.credits.json',
    );
  });
});
