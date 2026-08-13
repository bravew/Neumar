import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { reduceCritiqueEvents } from '@/components/design/critique/critique-reducer';
import { DesignJuryTheater } from '@/components/design/critique/theater';

import { renderWithProviders } from './helpers/render-with-providers';

describe('DesignJuryTheater', () => {
  it('renders panelist cards, round summaries, and terminal banners', () => {
    const state = reduceCritiqueEvents([
      {
        type: 'run_started',
        runId: 'jury_theater1234',
        protocolVersion: 'design-jury.v1',
        roles: ['designer'],
        startedAt: '2026-05-12T00:00:00.000Z',
      },
      {
        type: 'panelist_dim',
        runId: 'jury_theater1234',
        round: 1,
        role: 'designer',
        rating: 8,
      },
      {
        type: 'panelist_must_fix',
        runId: 'jury_theater1234',
        round: 1,
        role: 'designer',
        itemId: 'designer-1',
        body: 'Add visible focus states.',
      },
      {
        type: 'round_end',
        runId: 'jury_theater1234',
        round: 1,
        aggregate: { avgScore: 8, mustFix: 1, quickWins: 2 },
      },
      { type: 'shipped', runId: 'jury_theater1234' },
    ]);

    renderWithProviders(<DesignJuryTheater state={state} />);

    expect(screen.getByText('Shipped')).toBeVisible();
    expect(screen.getByText('Designer')).toBeVisible();
    expect(screen.getByText('Add visible focus states.')).toBeVisible();
    expect(
      screen.getByText('Round 1: 8/10 average, 1 must-fix, 2 quick wins'),
    ).toBeVisible();
  });
});
