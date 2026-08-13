import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MessageItem } from '@/components/task/MessageItem';

import { renderWithProviders } from './helpers/render-with-providers';

describe('MessageItem structured envelopes', () => {
  it('renders a fenced direct answer as plain assistant text', () => {
    renderWithProviders(
      <MessageItem
        message={{
          type: 'text',
          content: [
            '```json',
            '{"type":"direct_answer","answer":"Here is the short answer."}',
            '```',
          ].join('\n'),
        }}
      />,
    );

    expect(screen.getByText('Here is the short answer.')).toBeVisible();
    expect(screen.queryByText(/direct_answer/)).toBeNull();
  });

  it('renders a fenced plan as the plan approval UI', () => {
    renderWithProviders(
      <MessageItem
        phase="awaiting_approval"
        message={{
          type: 'text',
          content: [
            '```json',
            JSON.stringify({
              type: 'plan',
              goal: 'Ship the fix',
              steps: [
                {
                  id: '1',
                  description: 'Patch the parser',
                  status: 'pending',
                },
              ],
            }),
            '```',
          ].join('\n'),
        }}
      />,
    );

    expect(screen.getByText('Ship the fix')).toBeInTheDocument();
    expect(screen.getByText('Patch the parser')).toBeInTheDocument();
    expect(screen.queryByText(/"type":"plan"/)).toBeNull();
  });
});
