import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DesignEntrySidebar } from '@/components/design/DesignEntrySidebar';
import { en } from '@/config/locale';
import type { useDesignCatalogs } from '@/shared/hooks/useDesignMode';

import { installLocalStorageMock } from './helpers/local-storage';
import { renderWithProviders } from './helpers/render-with-providers';

const createDesignProjectMock = vi.hoisted(() => vi.fn());

vi.mock('@/shared/hooks/useDesignMode', () => ({
  createDesignProject: createDesignProjectMock,
}));

describe('DesignEntrySidebar', () => {
  beforeEach(() => {
    installLocalStorageMock();
    createDesignProjectMock.mockReset();
    createDesignProjectMock.mockResolvedValue({
      project: {
        id: 'project-1',
        title: 'Project',
        surface: 'prototype',
        status: 'draft',
        outputs: [],
        createdAt: '2026-06-27T12:00:00.000Z',
        updatedAt: '2026-06-27T12:00:00.000Z',
      },
    });
  });

  it('keeps advanced project creation behind configure by default', async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <DesignEntrySidebar
        catalogs={catalogsFixture()}
        initialPanelSurface={{
          initialSurface: 'prototype',
          initialMediaSurface: 'image',
        }}
        initialPrompt=""
        language="en-US"
        labels={en.creative.intentEntry}
        onOpenProject={vi.fn()}
        onOpenVideo={vi.fn()}
        onSelectTemplates={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /^start$/i })).toBeVisible();
    expect(screen.queryByRole('button', { name: /^create$/i })).toBeNull();

    const configure = screen.getByRole('button', { name: /configure/i });
    expect(configure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('new-project-panel')).not.toBeVisible();

    await user.click(configure);

    expect(configure).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('new-project-panel')).toBeVisible();
    expect(screen.getByRole('button', { name: /^create$/i })).toBeVisible();
  });

  it('keeps the full idea in the brief but creates a short project title', async () => {
    const user = userEvent.setup();
    const prompt =
      'Design caregiver dashboard showing medication reminders and weekly summaries with a calm onboarding flow';

    renderWithProviders(
      <DesignEntrySidebar
        catalogs={catalogsFixture()}
        initialPanelSurface={{
          initialSurface: 'prototype',
          initialMediaSurface: 'image',
        }}
        initialPrompt=""
        language="en-US"
        labels={en.creative.intentEntry}
        onOpenProject={vi.fn()}
        onOpenVideo={vi.fn()}
        onSelectTemplates={vi.fn()}
      />,
    );

    await user.type(
      screen.getByPlaceholderText(/describe the output/i),
      prompt,
    );
    await user.click(screen.getByRole('button', { name: /^start$/i }));

    await waitFor(() => expect(createDesignProjectMock).toHaveBeenCalled());
    expect(createDesignProjectMock.mock.calls[0]?.[0]).toMatchObject({
      title: 'Design caregiver dashboard showing medication reminders',
      brief: { prompt },
    });
  });
});

function catalogsFixture(): ReturnType<typeof useDesignCatalogs> {
  return {
    designSystems: [],
    skills: [],
    imageTemplates: [],
    videoTemplates: [],
    refresh: vi.fn(),
  };
}
