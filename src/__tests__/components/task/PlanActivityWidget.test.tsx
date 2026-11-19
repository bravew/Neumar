import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PlanActivityWidget } from '@/components/task/PlanActivityWidget';

import { renderWithProviders } from '../../helpers/render-with-providers';

const plan = {
  phase: 'running',
  goal: 'Ship the widget',
  steps: [
    { id: 'step-1', description: 'Write it', status: 'completed' },
    { id: 'step-2', description: 'Test it', status: 'in_progress' },
    { id: 'step-3', description: 'Ship it', status: 'pending' },
  ],
};

describe('PlanActivityWidget', () => {
  it('shows the goal, phase, and each step with its status', () => {
    renderWithProviders(<PlanActivityWidget plan={plan} />);

    expect(screen.getByRole('region', { name: 'Plan' })).toBeInTheDocument();
    expect(screen.getByText('Ship the widget')).toBeInTheDocument();
    expect(screen.getByText('Write it')).toBeInTheDocument();
    expect(screen.getByText('Test it')).toBeInTheDocument();
    expect(screen.getByText('Ship it')).toBeInTheDocument();
    // The phase label and the in-progress step both read "In progress"; step
    // state is a label on the step, not an announcement.
    expect(screen.getAllByText('In progress')).toHaveLength(2);
    expect(screen.getAllByText('Completed')).toHaveLength(1);
    expect(screen.getAllByText('Pending')).toHaveLength(1);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(document.querySelector('[aria-live]')).not.toBeInTheDocument();
    // A patch cannot disturb focus or collapse state: the widget owns neither.
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });

  it.each([
    ['awaiting_approval', 'Awaiting approval'],
    ['failed', 'Failed'],
    ['cancelled', 'Cancelled'],
    ['done', 'Completed'],
  ])('labels the %s phase', (phase, label) => {
    renderWithProviders(<PlanActivityWidget plan={{ ...plan, phase }} />);

    // The phase label renders in the header, before the step labels.
    expect(screen.getAllByText(label)[0]).toBeInTheDocument();
  });

  it('renders without steps', () => {
    renderWithProviders(<PlanActivityWidget plan={{ ...plan, steps: [] }} />);

    expect(screen.getByText('Ship the widget')).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});
