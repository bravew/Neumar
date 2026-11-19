import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AgentDockMessageList } from '@/components/video/AgentDockMessageList';
import type { AgentDockMessage } from '@/components/video/useAgentDock';
import type { VideoProject } from '@/shared/types/video';

import { renderWithProviders } from '../helpers/render-with-providers';

const project: VideoProject = {
  id: 'project-1',
  name: 'Project',
  template: 'explainer',
  prompt: '',
  assets: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function renderMessages(messages: AgentDockMessage[]) {
  return renderWithProviders(
    <AgentDockMessageList
      messages={messages}
      project={project}
      streaming={false}
      onPreview={vi.fn()}
      onSend={vi.fn()}
      onAcceptAction={vi.fn()}
      onRejectAction={vi.fn()}
      onRefineAction={vi.fn()}
      onCancelAction={vi.fn()}
    />,
  );
}

describe('AgentDockMessageList', () => {
  it('labels an activity that is still planning as running, not done', () => {
    renderMessages([
      {
        id: 'status-1',
        role: 'assistant',
        kind: 'activity',
        createdAt: new Date(0).toISOString(),
        activity: {
          id: 'status-1',
          activityType: 'status',
          content: { phase: 'planning', message: 'Planning the edit' },
        },
      },
    ]);

    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.queryByText('Done')).not.toBeInTheDocument();
  });
});
