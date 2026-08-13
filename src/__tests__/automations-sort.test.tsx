import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AutomationList } from '@/components/automation/AutomationList';
import { RoutinesTab } from '@/components/design/tabs/RoutinesTab';
import type { Automation } from '@/shared/types/automation';

import { renderWithProviders } from './helpers/render-with-providers';

describe('automation sorting', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('renders channel automations newest first', () => {
    const { container } = renderWithProviders(
      <AutomationList
        automations={[
          automation({
            id: 'old',
            name: 'Old automation',
            createdAt: '2026-05-20T00:00:00.000Z',
          }),
          automation({
            id: 'new',
            name: 'New automation',
            createdAt: '2026-05-25T00:00:00.000Z',
          }),
        ]}
        loading={false}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onToggle={vi.fn()}
        onTrigger={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const cards = [
      ...container.querySelectorAll('[data-testid^="automation-card-"]'),
    ];
    expect(cards[0]).toHaveTextContent('New automation');
    expect(cards[1]).toHaveTextContent('Old automation');
  });

  it('renders DesignMode routines newest first', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/routines')) {
        return jsonResponse({
          routines: [
            routine('old', 'Old routine', '2026-05-20T00:00:00.000Z'),
            routine('new', 'New routine', '2026-05-25T00:00:00.000Z'),
          ],
        });
      }
      return jsonResponse({});
    }) as typeof fetch;

    renderWithProviders(
      <RoutinesTab
        projects={[]}
        designSystems={[]}
        skills={[]}
        onOpen={vi.fn()}
      />,
    );

    const newRoutine = await screen.findByText('New routine');
    const oldRoutine = await screen.findByText('Old routine');
    expect(
      newRoutine.compareDocumentPosition(oldRoutine) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

function automation(input: {
  id: string;
  name: string;
  createdAt: string;
}): Automation {
  return {
    id: input.id,
    name: input.name,
    enabled: true,
    prompt: 'Run the task.',
    trigger: { type: 'manual' },
    agent: { usePlanning: false, autoApprove: true },
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    runCount: 0,
    totalCost: 0,
    origin: 'ui',
    locale: 'en',
    overlapPolicy: 'skip',
    missedFirePolicy: 'skip',
  };
}

function routine(id: string, name: string, createdAt: string) {
  return {
    id: `droutine_${id}`,
    name,
    prompt: 'Create a tighter landing page.',
    surface: 'prototype',
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
    lastRunId: null,
    lastRunSummary: null,
    lastRunError: null,
    createdAt,
    updatedAt: createdAt,
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
