import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { QuestionInterruptPanel } from '@/components/task/QuestionInterruptPanel';
import {
  QuestionInterruptsProvider,
  useQuestionInterruptsContext,
} from '@/components/task/QuestionInterruptsProvider';
import type {
  AGUIMessage,
  AGUIToolCall,
} from '@/components/task/TaskV2MessageBubble.types';
import { AskUserQuestionCard } from '@/components/task/TaskV2MessageBubbleAskUser';
import { LanguageProvider } from '@/shared/providers/language-provider';

vi.mock('@/config', () => ({ API_BASE_URL: 'http://localhost:5126' }));

const question = {
  question: 'Which colour?',
  header: 'Colour',
  options: [{ label: 'Blue' }, { label: 'Green' }],
  multiSelect: false,
};

const toolCall: AGUIToolCall = {
  id: 'tool-1',
  type: 'function',
  function: {
    name: 'AskUserQuestion',
    arguments: JSON.stringify({ questions: [question] }),
  },
};

function threadMessages(withAnswer = false): AGUIMessage[] {
  return [
    {
      id: 'a1',
      role: 'assistant',
      content: '',
      toolCalls: [toolCall],
    },
    ...(withAnswer
      ? [{ id: 'u1', role: 'user', content: 'Which colour? → Blue' }]
      : []),
  ];
}

const interrupt = {
  id: 'question:q-1',
  reason: 'agent_question',
  message: 'Which colour?',
  responseSchema: { type: 'object' },
  metadata: {
    decision: {
      kind: 'question',
      taskId: 'task-1',
      questions: [question],
      toolUseId: 'tool-1',
    },
  },
};

function stubFetch(openInterrupts: unknown[]) {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ interrupts: openInterrupts }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function makeAgent() {
  return {
    messages: [] as unknown[],
    addMessage: vi.fn(),
    setMessages: vi.fn(),
    runAgent: vi.fn().mockResolvedValue({}),
  };
}

function Counts() {
  const state = useQuestionInterruptsContext();
  return (
    <span data-testid="counts">
      {state?.openQuestions.length}:{state?.panelQuestions.length}
    </span>
  );
}

function renderSurfaces({
  messages,
  agent,
  onSendMessage,
}: {
  messages: AGUIMessage[];
  agent: ReturnType<typeof makeAgent>;
  onSendMessage: (text: string) => void;
}) {
  return render(
    <LanguageProvider>
      <QuestionInterruptsProvider
        taskId="task-1"
        isRunning={false}
        agent={agent}
        messages={messages}
      >
        <Counts />
        <AskUserQuestionCard
          tc={toolCall}
          allMessages={messages}
          onSendMessage={onSendMessage}
        />
        <QuestionInterruptPanel />
      </QuestionInterruptsProvider>
    </LanguageProvider>,
  );
}

async function answerInInlineCard(option: string) {
  fireEvent.click(
    await screen.findByRole('button', { name: new RegExp(option) }),
  );
  fireEvent.click(screen.getByRole('button', { name: /submit/i }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('question answer surfaces', () => {
  it('shows one answer surface when the inline card owns the record', async () => {
    stubFetch([interrupt]);
    renderSurfaces({
      messages: threadMessages(),
      agent: makeAgent(),
      onSendMessage: vi.fn(),
    });

    // The record loaded, but the panel skips it: the inline card is live.
    await waitFor(() =>
      expect(screen.getByTestId('counts').textContent).toBe('1:0'),
    );
    expect(screen.getAllByText('Which colour?')).toHaveLength(1);
  });

  it('submits the record from the inline card and resumes the run', async () => {
    stubFetch([interrupt]);
    const agent = makeAgent();
    const onSendMessage = vi.fn();
    renderSurfaces({
      messages: threadMessages(),
      agent,
      onSendMessage,
    });
    await waitFor(() =>
      expect(screen.getByTestId('counts').textContent).toBe('1:0'),
    );

    await answerInInlineCard('Blue');

    await waitFor(() =>
      expect(agent.runAgent).toHaveBeenCalledWith({
        resume: [
          {
            interruptId: 'question:q-1',
            status: 'resolved',
            payload: { answers: { 'Which colour?': 'Blue' } },
          },
        ],
        forwardedProps: { taskId: 'task-1' },
      }),
    );
    expect(agent.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'user',
        content: 'Which colour? → Blue',
      }),
    );
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it('keeps the plain message when the question has no record', async () => {
    stubFetch([]);
    const agent = makeAgent();
    const onSendMessage = vi.fn();
    renderSurfaces({
      messages: threadMessages(),
      agent,
      onSendMessage,
    });
    await waitFor(() =>
      expect(screen.getByTestId('counts').textContent).toBe('0:0'),
    );

    await answerInInlineCard('Blue');

    expect(onSendMessage).toHaveBeenCalledWith('Which colour? → Blue');
    expect(agent.runAgent).not.toHaveBeenCalled();
  });

  it('offers the record in the panel when the inline card was answered as a message', async () => {
    stubFetch([interrupt]);
    renderSurfaces({
      messages: threadMessages(true),
      agent: makeAgent(),
      onSendMessage: vi.fn(),
    });

    // The inline card is a read-only answer; the record still needs settling.
    await waitFor(() =>
      expect(screen.getByTestId('counts').textContent).toBe('1:1'),
    );
    expect(screen.getAllByText('Which colour?')).toHaveLength(1);
  });
});
