import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatusWidget } from '@/components/task/TaskV2StatusWidget';

import { renderWithProviders } from './helpers/render-with-providers';

describe('StatusWidget', () => {
  it('updates one row in place as the activity is patched', () => {
    const { rerender } = renderWithProviders(
      <StatusWidget
        status={{ phase: 'planning', message: 'Preparing...', elapsedMs: 1000 }}
        isRunning
      />,
    );
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByText('Preparing...')).toBeTruthy();
    expect(screen.getByText('1s')).toBeTruthy();

    rerender(
      <StatusWidget
        status={{
          phase: 'planning',
          message: 'Reasoning...',
          elapsedMs: 65000,
        }}
        isRunning
      />,
    );

    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByText('Reasoning...')).toBeTruthy();
    expect(screen.getByText('1m 5s')).toBeTruthy();
  });

  it('hides the ticking elapsed time from assistive technology', () => {
    renderWithProviders(
      <StatusWidget
        status={{ phase: 'planning', message: 'Preparing...', elapsedMs: 4000 }}
        isRunning
      />,
    );

    expect(screen.getByText('4s').getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('status').textContent).toContain('Preparing...');
  });

  it('falls back to the generic planning label for an unknown message', () => {
    renderWithProviders(
      <StatusWidget
        status={{ phase: 'planning', message: 'Whatever' }}
        isRunning
      />,
    );

    expect(screen.getByRole('status').textContent).toContain('Planning...');
    expect(screen.queryByText('Whatever')).toBeNull();
  });

  it('renders nothing when the run is not live', () => {
    renderWithProviders(
      <StatusWidget status={{ phase: 'planning', message: 'Preparing...' }} />,
    );

    expect(screen.queryByRole('status')).toBeNull();
  });
});
