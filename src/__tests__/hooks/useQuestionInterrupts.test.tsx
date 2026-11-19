import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  formatQuestionAnswer,
  useQuestionInterrupts,
} from '@/shared/hooks/useQuestionInterrupts';

vi.mock('@/config', () => ({ API_BASE_URL: 'http://localhost:5126' }));

const question = {
  question: 'Which colour?',
  header: 'Colour',
  options: [{ label: 'Blue' }, { label: 'Green' }],
  multiSelect: false,
};

const interrupt = {
  id: 'question:q-1',
  reason: 'agent_question',
  message: 'Which colour?',
  responseSchema: { type: 'object' },
  metadata: {
    decision: { kind: 'question', taskId: 'task-1', questions: [question] },
  },
};

const permissionInterrupt = {
  id: 'permission:perm-1',
  reason: 'tool_permission',
  message: 'Run Bash?',
  responseSchema: { type: 'object' },
  metadata: { decision: { kind: 'permission', taskId: 'task-1' } },
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

function makeAgent(runAgent = vi.fn().mockResolvedValue({})) {
  return {
    messages: [{ id: 'm1', role: 'user', content: 'Ask me' }] as unknown[],
    addMessage: vi.fn(),
    setMessages: vi.fn(),
    runAgent,
  };
}

function mount(isRunning: boolean, agent = makeAgent()) {
  const view = renderHook(
    (props: { isRunning: boolean }) =>
      useQuestionInterrupts('task-1', props.isRunning, agent),
    { initialProps: { isRunning } },
  );
  return { ...view, agent };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useQuestionInterrupts', () => {
  it('loads the open question once the run is idle and ignores other interrupts', async () => {
    stubFetch([interrupt, permissionInterrupt]);
    const { result } = mount(false);

    await waitFor(() =>
      expect(result.current.openQuestions).toMatchObject([
        {
          interruptId: 'question:q-1',
          questions: [{ question: 'Which colour?' }],
        },
      ]),
    );
  });

  it('does not read open interrupts while a run is live', () => {
    const fetchMock = stubFetch([interrupt]);
    const { result } = mount(true);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.openQuestions).toEqual([]);
  });

  it('answers by adding the answer as the final user message and resuming', async () => {
    stubFetch([interrupt]);
    const { result, agent } = mount(false);
    await waitFor(() => expect(result.current.openQuestions).toHaveLength(1));

    await act(() =>
      result.current.answer('question:q-1', { 'Which colour?': 'Blue' }),
    );

    const expected = 'Which colour? → Blue';
    expect(agent.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'user', content: expected }),
    );
    expect(agent.runAgent).toHaveBeenCalledWith({
      resume: [
        {
          interruptId: 'question:q-1',
          status: 'resolved',
          payload: { answer: expected },
        },
      ],
      forwardedProps: { taskId: 'task-1' },
    });
    // The message is in the thread before the run starts.
    expect(agent.addMessage.mock.invocationCallOrder[0]).toBeLessThan(
      agent.runAgent.mock.invocationCallOrder[0]!,
    );
    expect(result.current.openQuestions).toEqual([]);
  });

  it('ignores an answer with no text', async () => {
    stubFetch([interrupt]);
    const { result, agent } = mount(false);
    await waitFor(() => expect(result.current.openQuestions).toHaveLength(1));

    await act(() => result.current.answer('question:q-1', {}));

    expect(agent.addMessage).not.toHaveBeenCalled();
    expect(agent.runAgent).not.toHaveBeenCalled();
  });

  it('cancels a question without adding a message', async () => {
    stubFetch([interrupt]);
    const { result, agent } = mount(false);
    await waitFor(() => expect(result.current.openQuestions).toHaveLength(1));

    await act(() => result.current.dismiss('question:q-1'));

    expect(agent.addMessage).not.toHaveBeenCalled();
    expect(agent.runAgent).toHaveBeenCalledWith({
      resume: [{ interruptId: 'question:q-1', status: 'cancelled' }],
      forwardedProps: { taskId: 'task-1' },
    });
  });

  it('takes the unsent answer back and reopens the card when the resume is refused', async () => {
    const fetchMock = stubFetch([interrupt]);
    const agent = makeAgent(vi.fn().mockRejectedValue(new Error('409')));
    const { result } = mount(false, agent);
    await waitFor(() => expect(result.current.openQuestions).toHaveLength(1));
    fetchMock.mockClear();

    await act(() =>
      result.current.answer('question:q-1', { 'Which colour?': 'Blue' }),
    );

    expect(agent.setMessages).toHaveBeenCalledWith([
      { id: 'm1', role: 'user', content: 'Ask me' },
    ]);
    // The backend's record decides whether the question is still open.
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5126/ag-ui/interrupts/task-1',
      expect.anything(),
    );
    await waitFor(() => expect(result.current.openQuestions).toHaveLength(1));
    expect(result.current.answering).toBe(false);
  });
});

describe('formatQuestionAnswer', () => {
  it('uses the legacy one-line-per-question format', () => {
    expect(formatQuestionAnswer({ A: '1', B: '2' })).toBe('A → 1\nB → 2');
  });
});
