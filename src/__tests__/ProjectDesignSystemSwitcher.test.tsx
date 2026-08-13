import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ProjectDesignSystemSwitcher } from '@/components/design/ProjectDesignSystemSwitcher';
import {
  listDesignSystems,
  updateDesignProject,
} from '@/shared/hooks/useDesignMode';
import type {
  DesignProject,
  DesignSystemRecord,
} from '@/shared/types/design-mode';

import { renderWithProviders } from './helpers/render-with-providers';

vi.mock('@/shared/hooks/useDesignMode', () => ({
  listDesignSystems: vi.fn(),
  updateDesignProject: vi.fn(),
  // The preview pane lazily loads a system's components.html via these.
  getDesignSystem: vi.fn(async () => ({
    designSystem: { componentsHtml: null },
  })),
  getDesignSystemShowcase: vi.fn(async () => ''),
}));

describe('ProjectDesignSystemSwitcher', () => {
  it('switches the active project design system', async () => {
    const user = userEvent.setup();
    const onProjectChange = vi.fn();
    const project = projectFixture();
    vi.mocked(listDesignSystems).mockResolvedValue({
      designSystems: [
        systemFixture('default', 'Default'),
        systemFixture('stripe', 'Stripe'),
      ],
    });
    vi.mocked(updateDesignProject).mockResolvedValue({
      project: { ...project, designSystemId: 'stripe' },
    });

    renderWithProviders(
      <ProjectDesignSystemSwitcher
        project={project}
        onProjectChange={onProjectChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Design system' }));
    await user.click(await screen.findByRole('option', { name: /Stripe/ }));

    await waitFor(() => {
      expect(updateDesignProject).toHaveBeenCalledWith('project-1', {
        designSystemId: 'stripe',
        inspirationDesignSystemIds: ['github'],
      });
      expect(onProjectChange).toHaveBeenCalledWith({
        ...project,
        designSystemId: 'stripe',
      });
    });
  });
});

function projectFixture(): DesignProject {
  const now = '2026-06-05T00:00:00.000Z';
  return {
    id: 'project-1',
    title: 'Project',
    surface: 'prototype',
    intent: 'landing-page',
    status: 'draft',
    skillId: null,
    designSystemId: 'default',
    inspirationDesignSystemIds: ['stripe', 'github'],
    craftRefs: [],
    linkedContextDirs: [],
    brief: {},
    outputs: [],
    createdAt: now,
    updatedAt: now,
  };
}

function systemFixture(id: string, title: string): DesignSystemRecord {
  return {
    id,
    title,
    category: 'Brand',
    summary: `${title} system`,
    body: '',
    swatches: ['#111827', '#ffffff'],
    tokens: [],
    origin: 'bundled',
  };
}
