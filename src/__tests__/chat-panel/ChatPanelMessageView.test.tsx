import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ChatPanelMessageView } from '@/components/shared/chat-panel';
import type {
  ChatPanelMessage,
  ChatPanelMessageViewLabels,
} from '@/components/shared/chat-panel';

const labels: ChatPanelMessageViewLabels = {
  toolGroup: {
    hide: 'Hide steps',
    show: 'Show {count} steps',
    failed: '{count} failed',
    running: 'Running',
    polling: '{count} checks',
    checking: 'Checking',
    pending: 'Pending',
  },
  surface: {
    kind: {
      form: 'Form',
      choice: 'Choice',
      confirmation: 'Confirmation',
      'oauth-prompt': 'Account access',
    },
    status: {
      pending: 'Pending',
      resolved: 'Resolved',
      timeout: 'Timed out',
    },
    persist: {
      run: 'Run',
      conversation: 'Conversation',
      project: 'Project',
    },
    respondedBy: {
      user: 'User',
      agent: 'Agent',
      auto: 'Auto',
      cache: 'Cache',
    },
    payload: 'Payload',
    response: 'Response',
  },
  lifecycle: {
    started: 'Started',
    pipeline_stage_started: 'Stage started',
    pipeline_stage_completed: 'Stage completed',
    completed: 'Completed',
    cancelled: 'Cancelled',
    failed: 'Failed',
  },
  state: {
    updated: 'State updated',
    value: 'Value',
  },
};

describe('ChatPanelMessageView', () => {
  it('renders GenUI assistant text with the shared renderer', () => {
    render(
      <ChatPanelMessageView
        labels={labels}
        message={{
          id: 'message-1',
          kind: 'text',
          role: 'assistant',
          createdAt: '2026-06-21T00:00:00.000Z',
          content: JSON.stringify({
            $genui: 'StatusCard',
            props: {
              title: 'Asset ready',
              status: 'success',
              detail: 'cover.png',
            },
          }),
        }}
      />,
    );

    expect(screen.getByText('Asset ready')).toBeInTheDocument();
    expect(screen.getByText('cover.png')).toBeInTheDocument();
  });

  it('renders canonical surface, lifecycle, and state messages', () => {
    const messages: ChatPanelMessage[] = [
      {
        id: 'surface:audience',
        kind: 'surface',
        role: 'assistant',
        createdAt: '2026-06-21T00:00:00.000Z',
        surface: {
          id: 'audience',
          kind: 'form',
          status: 'pending',
          persist: 'project',
          payload: { title: 'Audience', schema: { type: 'object' } },
        },
      },
      {
        id: 'lifecycle:render',
        kind: 'lifecycle',
        role: 'system',
        createdAt: '2026-06-21T00:00:00.000Z',
        lifecycle: {
          status: 'pipeline_stage_started',
          stageId: 'render',
          iteration: 1,
        },
      },
      {
        id: 'state:artifact.status',
        kind: 'state',
        role: 'system',
        createdAt: '2026-06-21T00:00:00.000Z',
        state: {
          path: 'artifact.status',
          value: 'rendering',
        },
      },
    ];

    render(
      <>
        {messages.map((message) => (
          <ChatPanelMessageView
            key={message.id}
            labels={labels}
            message={message}
          />
        ))}
      </>,
    );

    expect(screen.getByText('Audience')).toBeInTheDocument();
    expect(screen.getByText('Project')).toBeInTheDocument();
    expect(screen.getByText('Stage started')).toBeInTheDocument();
    expect(screen.getByText('artifact.status')).toBeInTheDocument();
    expect(screen.getByText('rendering')).toBeInTheDocument();
  });
});
