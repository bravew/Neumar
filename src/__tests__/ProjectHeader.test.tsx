import type { ComponentProps } from 'react';

import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ProjectHeader } from '@/components/design/ProjectHeader';
import type { DesignProject } from '@/shared/types/design-mode';

import { renderWithProviders } from './helpers/render-with-providers';

describe('ProjectHeader', () => {
  it('renders project intent next to project chips', () => {
    renderWithProviders(
      <ProjectHeader
        project={projectFixture()}
        title="Intent project"
        budget={null}
        debugLoading={false}
        juryEnabled={false}
        juryLoading={false}
        designMdState={designMdStateFixture()}
        finalizing={false}
        continueCopied={false}
        onBack={vi.fn()}
        onTitleChange={vi.fn()}
        onTitleBlur={vi.fn()}
        onResolvePrompt={vi.fn()}
        onOpenDebug={vi.fn()}
        onRunJury={vi.fn()}
        onFinalizeDesign={vi.fn()}
        onContinueInCli={vi.fn()}
        onOpenSettings={vi.fn()}
        onCustomInstructionsSave={vi.fn()}
      />,
    );

    expect(screen.getByText('Landing page')).toBeInTheDocument();
    expect(screen.getByText('default')).toBeInTheDocument();
  });

  it('hides handoff on a fresh project with no artifact package', () => {
    renderHeader({ project: projectFixture() });

    expect(screen.queryByTestId('design-handoff-trigger')).toBeNull();
  });

  it('shows handoff when a project has an output artifact', () => {
    renderHeader({
      project: projectFixture({
        outputs: [
          {
            id: 'output_hero',
            kind: 'html',
            path: 'artifacts/index.html',
            createdAt: '2026-05-12T00:00:00.000Z',
          },
        ],
      }),
    });

    expect(screen.getByTestId('design-handoff-trigger')).toBeVisible();
  });
});

function renderHeader({
  project,
  designMdState = designMdStateFixture(),
}: {
  project: DesignProject;
  designMdState?: ComponentProps<typeof ProjectHeader>['designMdState'];
}) {
  renderWithProviders(
    <ProjectHeader
      project={project}
      title={project.title}
      budget={null}
      debugLoading={false}
      juryEnabled={false}
      juryLoading={false}
      designMdState={designMdState}
      finalizing={false}
      continueCopied={false}
      onBack={vi.fn()}
      onTitleChange={vi.fn()}
      onTitleBlur={vi.fn()}
      onResolvePrompt={vi.fn()}
      onOpenDebug={vi.fn()}
      onRunJury={vi.fn()}
      onFinalizeDesign={vi.fn()}
      onContinueInCli={vi.fn()}
      onOpenSettings={vi.fn()}
      onCustomInstructionsSave={vi.fn()}
    />,
  );
}

function designMdStateFixture(): ComponentProps<
  typeof ProjectHeader
>['designMdState'] {
  return {
    exists: false,
    generatedAt: null,
    transcriptMessageCount: null,
    designSystemId: null,
    currentArtifact: null,
    isStale: false,
    staleReason: null,
  };
}

function projectFixture(overrides: Partial<DesignProject> = {}): DesignProject {
  const now = '2026-05-12T00:00:00.000Z';
  return {
    id: 'design_intent',
    title: 'Intent project',
    surface: 'prototype',
    intent: 'landing-page',
    status: 'draft',
    skillId: null,
    designSystemId: 'default',
    inspirationDesignSystemIds: [],
    craftRefs: [],
    linkedContextDirs: [],
    brief: {},
    outputs: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
