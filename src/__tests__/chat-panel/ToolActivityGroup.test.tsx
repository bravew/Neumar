import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ToolActivityGroup } from '@/components/shared/chat-panel';
import type { ChatToolCall } from '@/components/shared/chat-panel';

const labels = {
  hide: 'Hide steps',
  show: 'Show {count} steps',
  failed: '{count} failed',
  running: 'Running',
  polling: '{count} checks',
  checking: 'Checking',
  pending: 'Pending',
};

describe('ToolActivityGroup', () => {
  it('groups repeated tool calls into one polling row', async () => {
    const user = userEvent.setup();
    render(
      <ToolActivityGroup
        labels={labels}
        calls={[
          toolCall('a', 'media_check_video'),
          toolCall('b', 'media_check_video'),
        ]}
      />,
    );

    expect(screen.getByText('Show 1 steps')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /show 1 steps/i }));
    expect(
      screen.getByText('media_check_video · 2 checks'),
    ).toBeInTheDocument();
  });

  it('auto-expands failed tool calls', () => {
    render(
      <ToolActivityGroup
        labels={labels}
        calls={[toolCall('a', 'Read', 'error')]}
      />,
    );

    expect(screen.getByText('Hide steps')).toBeInTheDocument();
    expect(screen.getByText('1 failed')).toBeInTheDocument();
  });

  it('renders allowlisted GenUI cards from tool results', async () => {
    const user = userEvent.setup();
    render(
      <ToolActivityGroup
        labels={labels}
        calls={[
          {
            ...toolCall('a', 'media_generate_image', 'complete'),
            result: JSON.stringify({
              $genui: 'StatusCard',
              props: {
                title: 'Image ready',
                status: 'success',
                detail: 'hero.png',
              },
            }),
          },
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: /show 1 steps/i }));
    await user.click(screen.getByRole('button', { name: /media_generate/i }));

    expect(screen.getByText('Image ready')).toBeInTheDocument();
    expect(screen.getByText('hero.png')).toBeInTheDocument();
  });
});

function toolCall(
  id: string,
  name: string,
  stage: ChatToolCall['stage'] = 'streaming',
): ChatToolCall {
  return {
    id,
    name,
    argsText: '{}',
    args: {},
    stage,
    isError: stage === 'error',
  };
}
