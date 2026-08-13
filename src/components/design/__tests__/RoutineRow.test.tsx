import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RoutineRow } from '@/components/design/tabs/RoutineRow';
import type { DesignRoutine } from '@/shared/types/design-mode';

import { renderWithProviders } from '../../../__tests__/helpers/render-with-providers';

const routine: DesignRoutine = {
  id: 'droutine_test',
  name: 'Daily hero',
  prompt: 'Create a landing page hero.',
  surface: 'document',
  targetMode: 'new_project',
  projectId: null,
  enabled: true,
  designSystemId: null,
  skillId: null,
  craftRefs: [],
  providerProfileId: null,
  schedule: { kind: 'manual' },
  automationSchedule: null,
  nextRunAt: null,
  lastFiredAt: null,
  lastRunId: 'run_failed',
  lastRunSummary: 'Routine run failed.',
  lastRunError: 'Provider quota exceeded',
  createdAt: '2026-05-21T00:00:00.000Z',
  updatedAt: '2026-05-21T00:00:00.000Z',
};

describe('RoutineRow', () => {
  it('renders persisted failure reasons for failed routine runs', () => {
    renderWithProviders(
      <RoutineRow routine={routine} onRun={vi.fn()} onToggle={vi.fn()} />,
    );

    expect(
      screen.getByText('Failure reason: Provider quota exceeded'),
    ).toBeInTheDocument();
  });

  it('renders failure reasons without replacement-pattern expansion', () => {
    renderWithProviders(
      <RoutineRow
        routine={{ ...routine, lastRunError: 'Provider returned $& $1 $$' }}
        onRun={vi.fn()}
        onToggle={vi.fn()}
      />,
    );

    expect(
      screen.getByText('Failure reason: Provider returned $& $1 $$'),
    ).toBeInTheDocument();
  });
});
