import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DesignsTab } from '@/components/design/tabs/DesignsTab';
import type { DesignProject } from '@/shared/types/design-mode';

import { renderWithProviders } from './helpers/render-with-providers';

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: toastMock,
}));

describe('DesignsTab bulk delete feedback', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    toastMock.success.mockReset();
    toastMock.error.mockReset();
  });

  it('shows a success toast with the deleted project count', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    mockCoversFetch();

    renderDesignsTab(onDelete);

    await selectAllProjects(user);
    await user.click(screen.getByRole('button', { name: /^delete$/i }));
    await user.click(
      screen.getAllByRole('button', { name: /^delete$/i }).at(-1)!,
    );

    await waitFor(() =>
      expect(onDelete).toHaveBeenCalledWith(['design_bulk_1', 'design_bulk_2']),
    );
    expect(toastMock.success).toHaveBeenCalledWith('Deleted 2 projects.');
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('shows an error toast when bulk deletion fails', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn(async () => {
      throw new Error('Disk busy');
    });
    mockCoversFetch();

    renderDesignsTab(onDelete);

    await selectAllProjects(user);
    await user.click(screen.getByRole('button', { name: /^delete$/i }));
    await user.click(
      screen.getAllByRole('button', { name: /^delete$/i }).at(-1)!,
    );

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'Could not delete projects: Disk busy',
      ),
    );
    expect(toastMock.success).not.toHaveBeenCalled();
  });
});

function renderDesignsTab(onDelete: (ids: string[]) => Promise<void> | void) {
  renderWithProviders(
    <DesignsTab
      projects={[
        projectFixture('design_bulk_1'),
        projectFixture('design_bulk_2'),
      ]}
      designSystems={[]}
      onOpen={vi.fn()}
      onRename={vi.fn()}
      onDelete={onDelete}
    />,
  );
}

async function selectAllProjects(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /^select$/i }));
  const checkboxes = screen.getAllByLabelText('Select project');
  await user.click(checkboxes[0]!);
  await user.click(checkboxes[1]!);
  expect(screen.getByText('2 selected')).toBeInTheDocument();
}

function mockCoversFetch() {
  globalThis.fetch = vi.fn(async () =>
    jsonResponse({ files: [] }),
  ) as typeof fetch;
}

function projectFixture(id: string): DesignProject {
  const now = '2026-05-25T00:00:00.000Z';
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
