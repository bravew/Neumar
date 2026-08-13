import { describe, expect, it } from 'vitest';

import {
  AssetMaterializationBudgetError,
  assetMaterializationBudgetLabel,
} from '@/shared/assets/materializationBudget';

describe('asset materialization budget copy', () => {
  it('includes used, requested, limit, and required bytes', () => {
    const label = assetMaterializationBudgetLabel(
      new AssetMaterializationBudgetError('Budget exceeded', {
        code: 'ASSET_MATERIALIZE_BUDGET_EXCEEDED',
        budget: 'session',
        usedBytes: 2 * 1024 * 1024 * 1024,
        limitBytes: 5 * 1024 * 1024 * 1024,
        requestedBytes: 4 * 1024 * 1024 * 1024,
        requiredBytes: 6 * 1024 * 1024 * 1024,
        scope: 'video_project',
        scopeId: 'project-1',
      }),
      {
        budgetIncreasePrompt:
          '{budget}: {used} used, {requested} requested, {limit} limit, {required} required',
        budgetProjectLabel: 'Project downloads',
        budgetSessionLabel: 'Session downloads',
      },
    );

    expect(label).toBe(
      'Session downloads: 2 GB used, 4 GB requested, 5 GB limit, 6 GB required',
    );
  });
});
