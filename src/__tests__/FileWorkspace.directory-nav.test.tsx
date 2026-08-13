import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileWorkspace } from '@/components/design/FileWorkspace';
import type { DesignProject } from '@/shared/types/design-mode';

import { renderWithProviders } from './helpers/render-with-providers';

describe('FileWorkspace directory navigation', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('drills into folders, goes back, and resets selection', async () => {
    const user = userEvent.setup();
    mockWorkspaceFetch();

    renderWithProviders(
      <FileWorkspace
        projectId="design_tree"
        surface="prototype"
        outputs={[]}
      />,
    );

    // The file tree is a collapsible drawer, default collapsed — open it first.
    await user.click(
      await screen.findByRole('button', { name: 'Toggle file tree' }),
    );

    const readmeCheckbox = await screen.findByRole('checkbox', {
      name: 'Select README.md',
    });
    await user.click(readmeCheckbox);
    expect(readmeCheckbox).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Folder: artifacts' }));

    expect(screen.getByText('Folder: artifacts')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'artifacts/index.html' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Folder: node_modules' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(
      await screen.findByRole('checkbox', { name: 'Select README.md' }),
    ).not.toBeChecked();
  });

  it('restores and persists the current folder view', async () => {
    const user = userEvent.setup();
    const project = designProjectFixture({
      ui: { fileWorkspace: { currentDirectory: 'artifacts' } },
    });
    const patchBodies: unknown[] = [];
    mockWorkspaceFetch({ project, patchBodies });

    renderWithProviders(
      <FileWorkspace
        projectId={project.id}
        project={project}
        surface="prototype"
        outputs={[]}
      />,
    );

    // The file tree is a collapsible drawer, default collapsed — open it first.
    await user.click(
      await screen.findByRole('button', { name: 'Toggle file tree' }),
    );

    expect(await screen.findByText('Folder: artifacts')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'artifacts/index.html' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() =>
      expect(patchBodies).toContainEqual({
        ui: {
          fileWorkspace: {
            currentDirectory: null,
            sortBy: 'name',
            sortDirection: 'asc',
            groupBy: 'none',
            kindFilter: 'all',
          },
        },
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Folder: artifacts' }));
    await waitFor(() =>
      expect(patchBodies).toContainEqual({
        ui: {
          fileWorkspace: {
            currentDirectory: 'artifacts',
            sortBy: 'name',
            sortDirection: 'asc',
            groupBy: 'none',
            kindFilter: 'all',
          },
        },
      }),
    );
  });
});

function mockWorkspaceFetch(
  options: { project?: DesignProject; patchBodies?: unknown[] } = {},
) {
  globalThis.fetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/files')) {
        return jsonResponse({
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
                },
                {
                  name: 'node_modules',
                  path: 'artifacts/node_modules',
                  isDir: true,
                  children: [
                    {
                      name: 'noise.html',
                      path: 'artifacts/node_modules/noise.html',
                      isDir: false,
                    },
                  ],
                },
              ],
            },
            { name: 'README.md', path: 'README.md', isDir: false },
          ],
        });
      }
      if (url.includes('/file?')) {
        const path = new URL(url).searchParams.get('path') ?? '';
        return jsonResponse({ path, content: `<main>${path}</main>` });
      }
      if (
        options.project &&
        url.endsWith(`/projects/${options.project.id}`) &&
        init?.method === 'PATCH'
      ) {
        const body = JSON.parse(String(init.body)) as Partial<DesignProject>;
        options.patchBodies?.push(body);
        return jsonResponse({
          project: {
            ...options.project,
            ui: body.ui,
          },
        });
      }
      return jsonResponse({});
    },
  ) as typeof fetch;
}

function designProjectFixture(
  overrides: Partial<DesignProject> = {},
): DesignProject {
  return {
    id: 'design_tree',
    title: 'Design tree',
    surface: 'prototype',
    status: 'ready',
    skillId: null,
    designSystemId: null,
    inspirationDesignSystemIds: [],
    craftRefs: [],
    brief: {},
    outputs: [],
    createdAt: '2026-05-02T00:00:00.000Z',
    updatedAt: '2026-05-02T00:00:00.000Z',
    ...overrides,
  };
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
