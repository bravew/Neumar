import { describe, expect, it } from 'vitest';

import {
  canApproveStoryboard,
  storyboardApprovalBlockedReason,
  templateMaxDurationMs,
} from '@/components/video/storyboardApproval';
import type { VideoProject } from '@/shared/types/video';

function project(
  overrides: {
    template?: string;
    totalDurationMs?: number;
    status?: string;
    capUsd?: number;
    estimateHigh?: number;
  } = {},
): Pick<VideoProject, 'storyboard' | 'budget' | 'template'> {
  return {
    template: overrides.template ?? 'slideshow',
    budget:
      overrides.capUsd === undefined
        ? undefined
        : { capUsd: overrides.capUsd, spentUsd: 0 },
    storyboard: {
      status: overrides.status ?? 'edited',
      intent: 'Montage',
      totalDurationMs: overrides.totalDurationMs ?? 30_000,
      costEstimateUsd: { low: 0, high: overrides.estimateHigh ?? 0 },
      scenes: [],
    },
  } as unknown as Pick<VideoProject, 'storyboard' | 'budget' | 'template'>;
}

describe('storyboard approval gate', () => {
  it('mirrors the server duration caps per template', () => {
    expect(templateMaxDurationMs('ugc-ad')).toBe(15_000);
    expect(templateMaxDurationMs('slideshow')).toBe(60_000);
    expect(templateMaxDurationMs('product-reel')).toBe(60_000);
    expect(templateMaxDurationMs('custom')).toBe(Number.POSITIVE_INFINITY);
  });

  it('blocks a storyboard longer than its template allows', () => {
    // The ChongQing case: a 3-minute montage on the 60s `slideshow` template.
    // The server answered 422 and the button said nothing at all.
    const reason = storyboardApprovalBlockedReason(
      project({ template: 'slideshow', totalDurationMs: 187_500 }),
    );

    expect(reason).toEqual({
      kind: 'over-duration',
      durationMs: 187_500,
      maxDurationMs: 60_000,
    });
  });

  it('allows the same storyboard on the custom template', () => {
    expect(
      canApproveStoryboard(
        project({ template: 'custom', totalDurationMs: 187_500 }),
      ),
    ).toBe(true);
  });

  it('blocks when the cost estimate exceeds the budget cap', () => {
    expect(
      storyboardApprovalBlockedReason(
        project({ capUsd: 5, estimateHigh: 7.5 }),
      ),
    ).toEqual({ kind: 'over-budget', estimateUsd: 7.5, capUsd: 5 });
  });

  it('does not treat a $0 storyboard under a cap as over budget', () => {
    expect(canApproveStoryboard(project({ capUsd: 5, estimateHigh: 0 }))).toBe(
      true,
    );
  });

  it('reports an already-approved storyboard rather than re-approving', () => {
    expect(
      storyboardApprovalBlockedReason(project({ status: 'approved' })),
    ).toEqual({ kind: 'already-approved' });
  });
});
