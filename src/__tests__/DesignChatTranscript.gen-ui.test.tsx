import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DesignChatTranscript } from '@/components/design/DesignChatTranscript';
import type { DesignChatTurn } from '@/shared/hooks/useDesignChat';

describe('DesignChatTranscript GenUI rendering', () => {
  it('renders allowlisted GenUI cards from assistant turns', () => {
    const turns: DesignChatTurn[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        text: JSON.stringify({
          $genui: 'StatusCard',
          props: {
            title: 'Prototype ready',
            status: 'success',
            detail: 'Open the generated file from the workspace.',
          },
        }),
        tools: [],
        questions: [],
        questionsStreaming: false,
        status: 'done',
      },
    ];

    render(
      <DesignChatTranscript turns={turns} errorFallback="Design run failed" />,
    );

    expect(screen.getByText('Prototype ready')).toBeInTheDocument();
    expect(
      screen.getByText('Open the generated file from the workspace.'),
    ).toBeInTheDocument();
  });
});
