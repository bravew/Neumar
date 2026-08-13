import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SANDBOX_ATTR } from '@/components/artifacts/live/iframe-sandbox';
import { DesignsTab } from '@/components/design/tabs/DesignsTab';
import type { DesignProject } from '@/shared/types/design-mode';

import { renderWithProviders } from './helpers/render-with-providers';

describe('DesignsTab cards', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('renders sandboxed covers and supports rename/delete/select flows', async () => {
    const user = userEvent.setup();
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        files: [
          {
            name: 'artifacts',
            path: 'artifacts',
            isDir: true,
            children: [
              {
                name: 'index.html',
                path: 'artifacts/index.html',
                isDir: false,
                updatedAt: '2026-05-12T00:00:00.000Z',
              },
            ],
          },
        ],
      }),
    ) as typeof fetch;
    const onRename = vi.fn();
    const onDelete = vi.fn();

    renderWithProviders(
      <DesignsTab
        projects={[
          projectFixture('design_card_1'),
          projectFixture('design_card_2'),
        ]}
        designSystems={[]}
        onOpen={vi.fn()}
        onRename={onRename}
        onDelete={onDelete}
      />,
    );

    const preview = await screen.findByTitle('Project design_card_1 preview');
    expect(preview).toHaveAttribute('sandbox', SANDBOX_ATTR);
    expect(preview.closest('.pointer-events-none')).toBeTruthy();

    await user.click(screen.getAllByLabelText('Project actions')[0]!);
    await user.click(await screen.findByRole('menuitem', { name: /rename/i }));
    await user.clear(screen.getByDisplayValue('Project design_card_1'));
    await user.type(screen.getByRole('textbox'), 'Renamed');
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(onRename).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'design_card_1' }),
      'Renamed',
    );

    await user.click(screen.getByRole('button', { name: /^select$/i }));
    await user.click(screen.getAllByLabelText('Select project')[0]!);
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^delete$/i }));
    await user.click(
      screen.getAllByRole('button', { name: /^delete$/i }).at(-1)!,
    );
    await waitFor(() =>
      expect(onDelete).toHaveBeenCalledWith(['design_card_1']),
    );
  });
});

function projectFixture(id: string): DesignProject {
  const now = '2026-05-12T00:00:00.000Z';
  return {
    id,
    title: `Project ${id}`,
    surface: 'prototype',
    intent: 'landing-page',
    status: 'draft',
    skillId: null,
    designSystemId: null,
    inspirationDesignSystemIds: [],
    craftRefs: [],
    linkedContextDirs: [],
    brief: {},
    outputs: [],
    createdAt: now,
    updatedAt: now,
  };
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
