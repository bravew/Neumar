import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ProjectChatSidebar } from '@/components/design/ProjectChatSidebar';
import type { DesignProject } from '@/shared/types/design-mode';

import { renderWithProviders } from './helpers/render-with-providers';

describe('ProjectChatSidebar', () => {
  it('keeps chat visible without the legacy comments tab', () => {
    renderWithProviders(
      <ProjectChatSidebar
        activeTaskId={null}
        chatPanelWidth={360}
        juryError={null}
        juryRun={null}
        message=""
        project={projectFixture}
        queuedSends={[]}
        sendError={null}
        sending={false}
        tasks={[]}
        onBriefSubmit={vi.fn()}
        onCancelActiveTask={vi.fn()}
        onEditQueuedSend={vi.fn()}
        onMessageChange={vi.fn()}
        onRemoveQueuedSend={vi.fn()}
        onSampleSelected={vi.fn()}
        onSend={vi.fn()}
        onSendQueuedNow={vi.fn()}
        onAnswerQuestion={vi.fn()}
        onWidthChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Chat')).toBeVisible();
    expect(screen.queryByText('Comments')).not.toBeInTheDocument();
  });
});

const projectFixture = {
  id: 'design_test',
  title: 'Chat sidebar',
  surface: 'prototype',
  status: 'draft',
  skillId: null,
  designSystemId: null,
  inspirationDesignSystemIds: [],
  craftRefs: [],
  brief: {},
  outputs: [],
  createdAt: '2026-05-12T00:00:00.000Z',
  updatedAt: '2026-05-12T00:00:00.000Z',
} satisfies DesignProject;
