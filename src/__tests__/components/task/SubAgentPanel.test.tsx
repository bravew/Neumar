import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  SubAgentPanel,
  type SubAgentState,
} from '@/components/task/SubAgentPanel';

import { renderWithProviders } from '../../helpers/render-with-providers';

const agent = (overrides: Partial<SubAgentState> = {}): SubAgentState => ({
  id: 'task-a',
  name: 'Scan',
  status: 'running',
  startedAt: Date.now() - 1000,
  ...overrides,
});

describe('SubAgentPanel', () => {
  it('shows a suspended child as awaiting input and offers no cancel', () => {
    renderWithProviders(
      <SubAgentPanel
        subAgents={[agent({ status: 'suspended' })]}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText('Awaiting input')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Cancel' }),
    ).not.toBeInTheDocument();
  });

  it('offers cancel for a running child', () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <SubAgentPanel subAgents={[agent()]} onCancel={onCancel} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledWith('task-a');
  });

  it('keeps cancel out of the expander and links it to the detail panel', () => {
    renderWithProviders(
      <SubAgentPanel
        subAgents={[agent({ description: 'Read the logs' })]}
        onCancel={vi.fn()}
      />,
    );

    const expander = screen.getByRole('button', { expanded: true });
    expect(expander).toHaveAccessibleName(/Scan/);
    const detail = document.getElementById(
      expander.getAttribute('aria-controls') ?? '',
    );
    expect(detail).toHaveTextContent('Read the logs');
    // The cancel button must be a sibling: a button inside a button is
    // unreachable for assistive technology.
    expect(expander.querySelector('button')).toBeNull();

    fireEvent.click(expander);
    expect(expander).toHaveAttribute('aria-expanded', 'false');
    expect(expander).not.toHaveAttribute('aria-controls');
  });
});
