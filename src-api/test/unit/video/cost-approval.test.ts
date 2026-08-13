import { describe, expect, it } from 'vitest';

import {
  buildVideoCostApprovalToken,
  enforceVideoCostApproval,
} from '@/shared/video/cost-approval';
import type { VideoProject } from '@/shared/video/types';

describe('video cost approval', () => {
  it('auto-approves costs under the project threshold', () => {
    const decision = enforceVideoCostApproval(projectFixture(), {
      estimatedCents: 24,
      scopeId: 'job-1',
    });

    expect(decision).toMatchObject({
      estimatedCents: 24,
      autoApproveUnderCents: 25,
      approvalRequired: false,
      approved: true,
    });
  });

  it('requires an explicit approval token at the threshold', () => {
    const project = projectFixture();
    expect(() =>
      enforceVideoCostApproval(project, {
        estimatedCents: 25,
        scopeId: 'job-2',
      }),
    ).toThrow('cost-approval-required');

    const token = buildVideoCostApprovalToken(project.id, 'job-2', 25);
    expect(
      enforceVideoCostApproval(project, {
        estimatedCents: 25,
        scopeId: 'job-2',
        approval: { token, approvedCents: 25 },
      }),
    ).toMatchObject({
      approvalRequired: true,
      approved: true,
      approvalToken: token,
    });
  });

  it('uses a project-specific auto approval threshold when set', () => {
    const project = projectFixture({ autoApproveUnderCents: 50 });

    expect(
      enforceVideoCostApproval(project, {
        estimatedCents: 49,
        scopeId: 'job-3',
      }).approvalRequired,
    ).toBe(false);
    expect(() =>
      enforceVideoCostApproval(project, {
        estimatedCents: 50,
        scopeId: 'job-3',
      }),
    ).toThrow('cost-approval-required');
  });
});

function projectFixture(settings: VideoProject['settings'] = {}): VideoProject {
  return {
    schemaVersion: 2,
    id: 'project-cost',
    name: 'Cost gate',
    template: 'explainer',
    prompt: 'test',
    assets: [],
    budget: { capUsd: 5, spentUsd: 0 },
    settings,
    outputs: [],
    createdAt: '2026-06-18T00:00:00.000Z',
    updatedAt: '2026-06-18T00:00:00.000Z',
  };
}
