import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  formatQuestionAnswer,
  type QuestionInterruptContext,
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

function mount(
  isRunning: boolean,
  agent = makeAgent(),
  options: {
    taskId?: string;
    context?: QuestionInterruptContext;
  } = {},
) {
  const view = renderHook(
    (props: { isRunning: boolean; taskId: string }) =>
      useQuestionInterrupts(
        props.taskId,
        props.isRunning,
        agent,
        options.context,
      ),
    { initialProps: { isRunning, taskId: options.taskId ?? 'task-1' } },
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

  it('carries the owning sub-agent through to the open question', async () => {
    stubFetch([
      {
        ...interrupt,
        metadata: {
          decision: {
            kind: 'question',
            taskId: 'task-1',
            questions: [question],
            subagentRunId: 'task-child',
          },
        },
      },
    ]);
    const { result } = mount(false);

    await waitFor(() =>
      expect(result.current.openQuestions).toMatchObject([
        { interruptId: 'question:q-1', subagentRunId: 'task-child' },
      ]),
    );
  });

  it('carries the tool call that asked through to the open question', async () => {
    stubFetch([
      {
        ...interrupt,
        metadata: {
          decision: {
            kind: 'question',
            taskId: 'task-1',
            questions: [question],
            toolUseId: 'tool-1',
          },
        },
      },
    ]);
    const { result } = mount(false);

    await waitFor(() =>
      expect(result.current.openQuestions).toMatchObject([
        { interruptId: 'question:q-1', toolUseId: 'tool-1' },
      ]),
    );
  });

  it('reports the lookup as pending until the read returns', async () => {
    stubFetch([interrupt]);
    const { result } = mount(false);

    expect(result.current.lookup).toBe('pending');
    await waitFor(() => expect(result.current.lookup).toBe('loaded'));
  });

  it('reports a failed lookup instead of an empty list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('down', { status: 503 })),
    );
    const { result } = mount(false);

    await waitFor(() => expect(result.current.lookup).toBe('failed'));
    expect(result.current.openQuestions).toEqual([]);
  });

  it('reads again after a run ends and is pending until it returns', async () => {
    const fetchMock = stubFetch([]);
    const { result, rerender } = mount(false);
    await waitFor(() => expect(result.current.lookup).toBe('loaded'));

    rerender({ isRunning: true, taskId: 'task-1' });
    // The run may ask a new question; what was read before it is stale.
    let release: (() => void) | undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = () =>
            resolve(
              new Response(JSON.stringify({ interrupts: [interrupt] }), {
                status: 200,
              }),
            );
        }),
    );
    rerender({ isRunning: false, taskId: 'task-1' });

    expect(result.current.lookup).toBe('pending');
    await act(async () => release?.());
    expect(result.current.lookup).toBe('loaded');
    expect(result.current.openQuestions).toHaveLength(1);
  });

  it('trims each answer and drops empty ones before resuming', async () => {
    stubFetch([interrupt]);
    const { result, agent } = mount(false);
    await waitFor(() => expect(result.current.openQuestions).toHaveLength(1));

    await act(() =>
      result.current.answer('question:q-1', {
        'Which colour?': '  Blue ',
        'Which shape?': '   ',
      }),
    );

    // The server trims the record before comparing it with the message.
    expect(agent.addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Which colour? → Blue' }),
    );
    expect(agent.runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        resume: [
          {
            interruptId: 'question:q-1',
            status: 'resolved',
            payload: { answers: { 'Which colour?': 'Blue' } },
          },
        ],
      }),
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
          payload: { answers: { 'Which colour?': 'Blue' } },
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

  it('keeps the answer when the record shows the question was settled', async () => {
    const fetchMock = stubFetch([interrupt]);
    const agent = makeAgent(vi.fn().mockRejectedValue(new Error('stream')));
    const { result } = mount(false, agent);
    await waitFor(() => expect(result.current.openQuestions).toHaveLength(1));
    // The run was accepted; the question is no longer open.
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ interrupts: [] }), { status: 200 }),
    );

    await act(() =>
      result.current.answer('question:q-1', { 'Which colour?': 'Blue' }),
    );

    expect(agent.setMessages).not.toHaveBeenCalled();
    expect(result.current.openQuestions).toEqual([]);
  });

  it('keeps the answer and restores the card when the recovery read fails', async () => {
    const fetchMock = stubFetch([interrupt]);
    const agent = makeAgent(vi.fn().mockRejectedValue(new Error('stream')));
    const { result } = mount(false, agent);
    await waitFor(() => expect(result.current.openQuestions).toHaveLength(1));
    fetchMock.mockRejectedValueOnce(new Error('offline'));

    await act(() =>
      result.current.answer('question:q-1', { 'Which colour?': 'Blue' }),
    );

    expect(agent.setMessages).not.toHaveBeenCalled();
    // An inconclusive read cannot prove the answer was refused, so the card
    // comes back and the user can retry.
    expect(result.current.openQuestions).toHaveLength(1);
  });

  it('hides the cards and refuses answers once another run starts', async () => {
    stubFetch([interrupt]);
    const { result, rerender, agent } = mount(false);
    await waitFor(() => expect(result.current.openQuestions).toHaveLength(1));

    rerender({ isRunning: true, taskId: 'task-1' });
    expect(result.current.openQuestions).toEqual([]);

    await act(() =>
      result.current.answer('question:q-1', { 'Which colour?': 'Blue' }),
    );
    expect(agent.addMessage).not.toHaveBeenCalled();
    expect(agent.runAgent).not.toHaveBeenCalled();
  });

  it('seeds the agent from history and forwards the thread props', async () => {
    stubFetch([interrupt]);
    const seedAgent = vi.fn();
    const forwardedProps = vi.fn(() => ({
      modelConfig: { model: 'opus' },
    }));
    const { result, agent } = mount(false, makeAgent(), {
      context: { seedAgent, forwardedProps },
    });
    await waitFor(() => expect(result.current.openQuestions).toHaveLength(1));

    await act(() =>
      result.current.answer('question:q-1', { 'Which colour?': 'Blue' }),
    );

    expect(seedAgent.mock.invocationCallOrder[0]).toBeLessThan(
      agent.addMessage.mock.invocationCallOrder[0]!,
    );
    expect(agent.runAgent).toHaveBeenCalledWith({
      resume: [
        {
          interruptId: 'question:q-1',
          status: 'resolved',
          payload: { answers: { 'Which colour?': 'Blue' } },
        },
      ],
      forwardedProps: {
        taskId: 'task-1',
        modelConfig: { model: 'opus' },
      },
    });
  });

  it('ignores a recovery read that lands after the task changed', async () => {
    let rejectRun: ((error: Error) => void) | undefined;
    const runAgent = vi.fn(
      () =>
        new Promise((_resolve, reject) => {
          rejectRun = reject;
        }),
    );
    const agent = makeAgent(runAgent);
    const fetchMock = vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify({
            interrupts: url.endsWith('/task-2') ? [interrupt] : [],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { result, rerender } = mount(false, agent);

    act(() => {
      void result.current.answer('question:q-1', { 'Which colour?': 'Blue' });
    });
    rerender({ isRunning: false, taskId: 'task-2' });
    await waitFor(() => expect(result.current.openQuestions).toHaveLength(1));

    await act(async () => {
      rejectRun?.(new Error('409'));
    });

    // Task 1's late read must not replace task 2's list.
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith('/task-1')),
    ).toBe(true);
    expect(result.current.openQuestions).toHaveLength(1);
  });
});

describe('formatQuestionAnswer', () => {
  it('uses the legacy one-line-per-question format', () => {
    expect(formatQuestionAnswer({ A: '1', B: '2' })).toBe('A → 1\nB → 2');
  });
});
