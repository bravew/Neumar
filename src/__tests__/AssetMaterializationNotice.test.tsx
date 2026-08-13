import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AssetMaterializationNotice } from '@/components/assets/AssetMaterializationNotice';
import type { AssetMaterializationNoticeLabels } from '@/components/assets/AssetMaterializationNotice';

const labels: AssetMaterializationNoticeLabels = {
  budgetIncreaseAction: 'Increase and retry',
  budgetIncreasePrompt:
    '{budget}: {used} used, {requested} requested. Raise {limit} to {required}.',
  budgetIncreaseRetrying: 'Retrying...',
  budgetProjectLabel: 'Project downloads',
  budgetSessionLabel: 'Session downloads',
  error: 'Unknown error',
  materializeComplete: 'Asset ready',
  materializeDerivativeFailed: '{name} failed: {message}',
  materializeDerivativeReady: '{name} ready',
  materializeFailed: 'Asset failed: {message}',
  materializePreparing: 'Preparing asset...',
  materializeProgress: 'Downloading asset {percent}%',
};

describe('AssetMaterializationNotice', () => {
  it('shows derivative readiness from async events', () => {
    render(
      <AssetMaterializationNotice
        attaching={false}
        attachError={null}
        budgetIncreasing={false}
        budgetIssue={null}
        labels={labels}
        onBudgetRetry={vi.fn()}
        state={{
          assetId: 'asset-1',
          bytes: 1024,
          derivative: {
            kind: 'proxy',
            message: null,
            name: 'edit_1080p',
            status: 'ready',
          },
          message: null,
          percent: 100,
          status: 'complete',
          total: 1024,
          updatedAt: Date.now(),
        }}
      />,
    );

    expect(screen.getByText('edit_1080p ready')).toBeInTheDocument();
  });

  it('shows derivative failures from async events', () => {
    render(
      <AssetMaterializationNotice
        attaching={false}
        attachError={null}
        budgetIncreasing={false}
        budgetIssue={null}
        labels={labels}
        onBudgetRetry={vi.fn()}
        state={{
          assetId: 'asset-1',
          bytes: 1024,
          derivative: {
            kind: 'artifact',
            message: 'ffmpeg exited 1',
            name: 'filmstrip',
            status: 'error',
          },
          message: null,
          percent: 100,
          status: 'complete',
          total: 1024,
          updatedAt: Date.now(),
        }}
      />,
    );

    expect(
      screen.getByText('filmstrip failed: ffmpeg exited 1'),
    ).toBeInTheDocument();
  });
});
