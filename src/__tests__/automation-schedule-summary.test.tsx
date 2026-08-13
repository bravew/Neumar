import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AutomationTriggerConfig } from '@/components/automation/AutomationTriggerConfig';
import { RoutineForm } from '@/components/design/tabs/RoutineForm';

import { renderWithProviders } from './helpers/render-with-providers';

describe('automation schedule summaries', () => {
  it('shows a human-readable summary for automation schedules', () => {
    renderWithProviders(
      <AutomationTriggerConfig
        trigger={{
          type: 'cron',
          schedule: { kind: 'cron', cronExpr: '0 9 * * 1-5' },
        }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Every weekday at 09:00')).toBeInTheDocument();
  });

  it('shows a summary pill for DesignMode routine schedules', async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <RoutineForm
        projects={[]}
        designSystems={[]}
        skills={[]}
        onCreated={vi.fn()}
        onOpen={vi.fn()}
      />,
    );

    await user.click(screen.getByLabelText('Run on a schedule'));

    expect(screen.getByText('Every day at 09:00')).toBeInTheDocument();
  });
});
