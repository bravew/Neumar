import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CreativeWorkflowHeader } from '@/components/creative/CreativeWorkflowHeader';
import type { CreativeWorkflowState } from '@/shared/creative-workflow';

import { renderWithProviders } from './helpers/render-with-providers';

describe('CreativeWorkflowHeader', () => {
  it('renders step state and exposes primary and step actions', async () => {
    const user = userEvent.setup();
    const onPrimaryAction = vi.fn();
    const onStepSelect = vi.fn();

    renderWithProviders(
      <CreativeWorkflowHeader
        workflow={workflowFixture()}
        onPrimaryAction={onPrimaryAction}
        onStepSelect={onStepSelect}
      />,
    );

    expect(screen.getByText('Current step')).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: /creative workflow/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Plan').length).toBeGreaterThan(0);
    expect(
      screen.getByRole('button', { name: /generate: ready/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('2 assets, 1 generated')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /create plan/i }));
    expect(onPrimaryAction).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /generate/i }));
    expect(onStepSelect).toHaveBeenCalledWith('generate');
  });
});

function workflowFixture(): CreativeWorkflowState {
  return {
    mode: 'video',
    projectId: 'video_1',
    title: 'Launch spot',
    currentStep: 'plan',
    steps: [
      { step: 'intent', status: 'complete' },
      { step: 'assets', status: 'complete' },
      { step: 'plan', status: 'active' },
      { step: 'generate', status: 'ready' },
      { step: 'review', status: 'not-started' },
      { step: 'export', status: 'not-started' },
    ],
    primaryAction: { id: 'create-plan', step: 'plan' },
    assetSummary: {
      total: 2,
      generated: 1,
      used: 0,
      byRole: {},
      byMaterialization: {},
    },
    assets: [],
    source: { kind: 'video-project', status: 'idle' },
    updatedAt: '2026-06-21T00:00:00.000Z',
  };
}
