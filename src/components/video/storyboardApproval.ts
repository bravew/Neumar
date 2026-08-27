import type { VideoProject } from '@/shared/types/video';

/**
 * Longest storyboard each template will approve, mirroring the server's check
 * in `store.ts::assertStoryboardWithinTemplateLimits`. Duplicated deliberately:
 * the button has to be able to say *why* before the POST, and a 422 that only
 * arrives after the click reads as the button doing nothing.
 */
export function templateMaxDurationMs(template: string): number {
  if (template === 'ugc-ad') return 15_000;
  if (template === 'custom') return Number.POSITIVE_INFINITY;
  return 60_000;
}

export type ApprovalBlockedReason =
  | { kind: 'no-storyboard' }
  | { kind: 'already-approved' }
  | { kind: 'over-budget'; estimateUsd: number; capUsd: number }
  | { kind: 'over-duration'; durationMs: number; maxDurationMs: number }
  | null;

/**
 * Why approving this storyboard would fail, or null when it would succeed.
 */
export function storyboardApprovalBlockedReason(
  project: Pick<VideoProject, 'storyboard' | 'budget' | 'template'>,
): ApprovalBlockedReason {
  const storyboard = project.storyboard;
  if (!storyboard) return { kind: 'no-storyboard' };
  if (storyboard.status === 'approved') return { kind: 'already-approved' };

  const maxDurationMs = templateMaxDurationMs(project.template);
  if (storyboard.totalDurationMs > maxDurationMs) {
    return {
      kind: 'over-duration',
      durationMs: storyboard.totalDurationMs,
      maxDurationMs,
    };
  }

  const capUsd = project.budget?.capUsd;
  const estimateUsd = storyboard.costEstimateUsd?.high ?? 0;
  if (capUsd !== undefined && estimateUsd > capUsd) {
    return { kind: 'over-budget', estimateUsd, capUsd };
  }

  return null;
}

export function canApproveStoryboard(
  project: Pick<VideoProject, 'storyboard' | 'budget' | 'template'>,
): boolean {
  return storyboardApprovalBlockedReason(project) === null;
}
