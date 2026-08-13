import { buildExportMetadata } from '@/shared/video/export-metadata';
import { assertCreditsCover } from '@/shared/video/render-plan';
import type { VideoProject } from '@/shared/video/types';

import type { EvalCase } from '../types';

// Phase 7 gate — a required attribution must surface in the export metadata AND
// be enforced on-screen (assertCreditsCover throws until the credit appears in a
// storyboard caption).

function project(captionText: string | undefined): VideoProject {
  return {
    id: 'eval-attr',
    name: 'Attribution eval',
    template: 'explainer',
    prompt: '',
    assets: [
      {
        id: 'a1',
        kind: 'image',
        source: 'broll',
        path: 'a1.jpg',
        provenance: {
          provider: 'pexels',
          attribution: 'Photo by Jane Doe',
          attributionRequired: true,
          sourceDisplayName: 'Jane Doe',
        },
      },
    ],
    storyboard: captionText
      ? {
          status: 'draft',
          intent: 'x',
          totalDurationMs: 3000,
          costEstimateUsd: 0,
          scenes: [
            {
              id: 's1',
              intent: 'intro',
              durationMs: 3000,
              caption: { text: captionText },
              assetPlan: { kind: 'image' },
            },
          ],
        }
      : undefined,
  } as unknown as VideoProject;
}

function throws(fn: () => void): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

const evalCase: EvalCase = {
  id: 'video-attribution-coverage',
  name: 'Required attribution surfaces in export metadata + on-screen',
  tier: 'gate',
  touchfiles: [
    'src-api/src/shared/video/attribution.ts',
    'src-api/src/shared/video/export-metadata.ts',
    'src-api/src/shared/video/render-plan.ts',
  ],
  budget: { maxUsd: 0, timeoutMs: 10_000 },
  run: () => {
    const metadata = buildExportMetadata(project(undefined));
    const inMetadata =
      metadata.comment.includes('Photo by Jane Doe') &&
      metadata.artist?.includes('Photo by Jane Doe') === true &&
      metadata.aiGenerated === true;

    // On-screen enforcement: missing caption → throws; credit in caption → ok.
    const missingThrows = throws(() => assertCreditsCover(project(undefined)));
    const coveredOk = !throws(() =>
      assertCreditsCover(project('Photo by Jane Doe')),
    );

    const passed = inMetadata && missingThrows && coveredOk;
    return {
      passed,
      score: passed ? 1 : 0,
      notes: passed
        ? 'credit in metadata; enforced on-screen'
        : `inMetadata=${inMetadata} missingThrows=${missingThrows} coveredOk=${coveredOk}`,
      metrics: { inMetadata, missingThrows, coveredOk },
    };
  },
};

export default evalCase;
