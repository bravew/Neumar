import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RoutinesTab } from '@/components/design/tabs/RoutinesTab';

import { renderWithProviders } from './helpers/render-with-providers';

describe('DesignMode routines UI', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('validates routine form input and creates a manual routine', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/routines') && init?.method === 'POST') {
          return jsonResponse({
            routine: {
              id: 'droutine_test',
              name: 'Landing polish',
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
              createdAt: '2026-05-10T00:00:00.000Z',
              updatedAt: '2026-05-10T00:00:00.000Z',
            },
          });
        }
        if (url.endsWith('/routines')) return jsonResponse({ routines: [] });
        return jsonResponse({});
      },
    );
    globalThis.fetch = fetchMock as typeof fetch;

    renderWithProviders(
      <RoutinesTab
        projects={[]}
        designSystems={[]}
        skills={[]}
        onOpen={vi.fn()}
      />,
    );

    await screen.findByText('Saved routines');
    await user.click(screen.getByRole('button', { name: 'Create routine' }));
    expect(
      screen.getByText('Name and prompt are required.'),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText('Routine name'), 'Landing polish');
    await user.type(
      screen.getByLabelText('Prompt'),
      'Create a tighter landing page.',
    );
    await user.click(screen.getByRole('button', { name: 'Create routine' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/design/routines'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
    const createCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith('/routines') && init?.method === 'POST',
    );
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
      name: 'Landing polish',
      prompt: 'Create a tighter landing page.',
      targetMode: 'new_project',
      schedule: { kind: 'manual' },
    });
    const createdTitle = await screen.findByText('Landing polish');
    const createdRow = createdTitle.closest('article');
    if (!createdRow) throw new Error('missing created routine row');
    await waitFor(() => {
      expect(document.activeElement).toBe(createdRow);
    });
    expect(createdRow).toHaveClass('border-primary');
  });
});

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
