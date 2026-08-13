import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDesignChat } from '@/shared/hooks/useDesignChat';

const QUESTION_INPUT = {
  questions: [
    {
      question: 'Which direction?',
      header: 'Direction',
      options: [
        { label: 'Calm', description: 'Restrained' },
        { label: 'Bold', description: 'Energetic' },
      ],
      multiSelect: false,
      policy: { behavior: 'optional', defaultOptionLabel: 'Calm' },
    },
  ],
};

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useDesignChat questions', () => {
  it('reads normalized AskUserQuestion data from AG-UI tool events', async () => {
    const body = [
      sse('message', {
        type: 'TOOL_CALL_START',
        toolCallId: 'ask-1',
        toolCallName: 'AskUserQuestion',
      }),
      sse('message', {
        type: 'TOOL_CALL_ARGS',
        toolCallId: 'ask-1',
        delta: JSON.stringify(QUESTION_INPUT),
      }),
      sse('message', { type: 'TOOL_CALL_END', toolCallId: 'ask-1' }),
      sse('message', { type: 'RUN_FINISHED' }),
    ].join('');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(body, { status: 200 })),
    );
    const { result } = renderHook(() => useDesignChat('design-1'));

    await act(async () => result.current.send('Make a page'));

    const assistant = result.current.turns.at(-1);
    expect(assistant?.questions).toEqual(QUESTION_INPUT.questions);
    expect(assistant?.questionsStreaming).toBe(false);
  });

  it('fails missing policy closed for the raw native bridge', async () => {
    const nativeInput = {
      questions: QUESTION_INPUT.questions.map(
        ({ policy: _, ...question }) => question,
      ),
    };
    const body = [
      sse('agent', {
        type: 'tool_use',
        id: 'ask-native',
        name: 'AskUserQuestion',
        input: nativeInput,
      }),
      sse('done', {}),
    ].join('');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(body, { status: 200 })),
    );
    const { result } = renderHook(() => useDesignChat('design-1'));

    await act(async () => result.current.send('Make a page'));

    expect(result.current.turns.at(-1)?.questions[0].policy).toEqual({
      behavior: 'manual',
    });
  });
});
