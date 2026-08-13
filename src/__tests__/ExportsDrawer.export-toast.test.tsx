import { openPath } from '@tauri-apps/plugin-opener';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExportsDrawer } from '@/components/design/ExportsDrawer';

import { renderWithProviders } from './helpers/render-with-providers';

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

const designModeMocks = vi.hoisted(() => ({
  exportDesignProject: vi.fn(),
  getDesignDependencies: vi.fn(),
  getDesignFileLocation: vi.fn(),
  listDesignExports: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: toastMock,
}));

vi.mock('@/shared/hooks/useDesignMode', () => ({
  DesignApiError: class DesignApiError extends Error {
    data: Record<string, unknown>;
    constructor(message: string, data: Record<string, unknown> = {}) {
      super(message);
      this.data = data;
    }
  },
  buildDesignPdfExportInput: vi.fn(),
  designBlobUrl: vi.fn(() => '#'),
  exportDesignProject: designModeMocks.exportDesignProject,
  getDesignDependencies: designModeMocks.getDesignDependencies,
  getDesignFileLocation: designModeMocks.getDesignFileLocation,
  listDesignExports: designModeMocks.listDesignExports,
}));

vi.mock('@/components/design/pdf-print', () => ({
  printArtifactPdfInput: vi.fn(),
}));

describe('ExportsDrawer export feedback', () => {
  beforeEach(() => {
    toastMock.success.mockReset();
    toastMock.error.mockReset();
    designModeMocks.listDesignExports.mockResolvedValue({ exports: [] });
    designModeMocks.getDesignDependencies.mockResolvedValue({
      dependencies: [],
    });
    designModeMocks.getDesignFileLocation.mockResolvedValue({
      path: 'exports/package.designpkg',
      absolutePath: '/workspace/project-1/exports/package.designpkg',
    });
    designModeMocks.exportDesignProject.mockResolvedValue({
      export: {
        id: 'export-1',
        path: 'exports/project.html',
        format: 'html',
        size: 128,
        createdAt: '2026-05-29T00:00:00.000Z',
      },
    });
    vi.mocked(openPath).mockReset();
    vi.mocked(openPath).mockResolvedValue(undefined);
  });

  it('shows a started toast when the user begins an export', async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <ExportsDrawer
        open
        onOpenChange={vi.fn()}
        projectId="project-1"
        surface="prototype"
      />,
    );

    expect(
      await screen.findByRole('button', { name: /^designpkg$/i }),
    ).toBeVisible();

    await user.click(await screen.findByRole('button', { name: /^export$/i }));

    expect(toastMock.success).toHaveBeenCalledWith('Export started');
    await waitFor(() =>
      expect(designModeMocks.exportDesignProject).toHaveBeenCalledWith(
        'project-1',
        'html',
        { allowLintOverride: false },
      ),
    );
  });

  it('surfaces the dependency hint from a classified 422 export failure', async () => {
    const user = userEvent.setup();
    const { DesignApiError } = await import('@/shared/hooks/useDesignMode');
    designModeMocks.exportDesignProject.mockRejectedValue(
      new (DesignApiError as unknown as new (
        message: string,
        data: Record<string, unknown>,
      ) => Error)(
        'DOCX export requires a document converter such as pandoc; no converter is currently configured.',
        { code: 'dependency_missing', dependency: 'pandoc', format: 'docx' },
      ),
    );

    renderWithProviders(
      <ExportsDrawer
        open
        onOpenChange={vi.fn()}
        projectId="project-1"
        surface="prototype"
      />,
    );

    await user.click(await screen.findByRole('button', { name: /^export$/i }));

    expect(
      await screen.findByText(/DOCX export requires a document converter/),
    ).toBeVisible();
    expect(await screen.findByText('Dependency: pandoc')).toBeVisible();
  });

  it('switches to the lint-override retry action on a classified 409 lint block', async () => {
    const user = userEvent.setup();
    const { DesignApiError } = await import('@/shared/hooks/useDesignMode');
    designModeMocks.exportDesignProject.mockRejectedValue(
      new (DesignApiError as unknown as new (
        message: string,
        data: Record<string, unknown>,
      ) => Error)('Export blocked by P0 DesignMode lint findings', {
        code: 'export_blocked_by_lint',
      }),
    );

    renderWithProviders(
      <ExportsDrawer
        open
        onOpenChange={vi.fn()}
        projectId="project-1"
        surface="prototype"
      />,
    );

    await user.click(
      await screen.findByRole('checkbox', { name: /allow p0 lint override/i }),
    );
    await user.click(await screen.findByRole('button', { name: /^export$/i }));

    expect(
      await screen.findByText('Export blocked by P0 DesignMode lint findings'),
    ).toBeVisible();
    expect(
      await screen.findByRole('button', { name: /export with override/i }),
    ).toBeVisible();
  });

  it('reveals the containing folder for an exported design package', async () => {
    const user = userEvent.setup();
    designModeMocks.listDesignExports.mockResolvedValue({
      exports: [
        {
          id: 'export-package',
          path: 'exports/package.designpkg',
          format: 'designpkg',
          size: 512,
          createdAt: '2026-05-29T00:00:00.000Z',
        },
      ],
    });

    renderWithProviders(
      <ExportsDrawer
        open
        onOpenChange={vi.fn()}
        projectId="project-1"
        surface="prototype"
      />,
    );

    await user.click(await screen.findByRole('button', { name: /^reveal$/i }));

    await waitFor(() =>
      expect(openPath).toHaveBeenCalledWith('/workspace/project-1/exports'),
    );
    expect(designModeMocks.getDesignFileLocation).toHaveBeenCalledWith(
      'project-1',
      'exports/package.designpkg',
    );
  });
});
