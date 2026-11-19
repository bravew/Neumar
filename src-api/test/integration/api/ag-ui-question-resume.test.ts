import { beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonReq } from '../../helpers/request-factory';

/**
 * An agent question is answered by the user's next turn. The answer records
 * the question and the run continues as a new turn whose user message is the
 * answer. Everything between the route and the agent is real; only the agent,
 * the database, the persister, and the question store are replaced.
 */

interface QuestionRow {
  id: string;
  task_id: string | null;
  status: 'pending' | 'answered' | 'cancelled';
  answer_json: string | null;
  expires_at: string | null;
}

const questions = vi.hoisted(() => ({
  rows: new Map<string, QuestionRow>(),
}));

const db = vi.hoisted(() => ({ run: vi.fn() }));

const agent = vi.hoisted(() => ({
  script: null as null | (() => AsyncGenerator<unknown>),
}));

vi.mock('@/core/agent/questions', () => ({
  serializeAgentQuestion: vi.fn(),
  agentQuestionService: {
    getQuestion: (id: string) => questions.rows.get(id) ?? null,
    answerQuestion: (id: string, answer: unknown) => {
      const row = questions.rows.get(id);
      if (!row) return null;
      if (row.status === 'pending') {
        row.status = 'answered';
        row.answer_json = JSON.stringify(answer);
      }
      return row;
    },
    cancelQuestion: (id: string) => {
      const row = questions.rows.get(id);
      if (row?.status !== 'pending') return false;
      row.status = 'cancelled';
      return true;
    },
  },
}));

vi.mock('@/shared/services/agent', () => ({
  createSession: vi.fn(() => ({
    id: `session-${crypto.randomUUID()}`,
    abortController: new AbortController(),
  })),
  runAgent: vi.fn(() => agent.script!()),
  runPlanningPhase: vi.fn(),
  runExecutionPhase: vi.fn(),
  resolveAgentProvider: vi.fn().mockReturnValue('claude'),
}));

vi.mock('@/shared/services/branch-sdk-session', () => ({
  resolveBranchContextPlan: vi.fn().mockReturnValue({ path: 'main' }),
  withBranchSdkSessionRecording: vi.fn((stream: AsyncGenerator) => stream),
}));

vi.mock('@/shared/services/ag-ui/journal', () => ({
  journalAGUIEvent: vi.fn(),
  replayAGUIEvents: vi.fn().mockReturnValue([]),
}));

vi.mock('@/extensions/agent/claude/index', () => ({
  resolvePermission: vi.fn().mockReturnValue(false),
}));

vi.mock('@/shared/services/ag-ui/open-interrupts', () => ({
  listOpenInterrupts: vi.fn(),
}));

vi.mock('@/shared/services/ag-ui/persistence', () => ({
  AGUIEventPersister: class MockAGUIEventPersister {
    runStartedAtMs = Date.now();
    scanOutputArtifacts = vi.fn();
    handleEvent = vi.fn();
  },
}));

vi.mock('@/shared/db/operations', () => ({
  AgentRunConflictError: class AgentRunConflictError extends Error {},
  createFileSnapshot: vi.fn(),
  decideOrchestrationRun: vi.fn(),
  getAgentRun: vi.fn(),
  getFilesByTaskId: vi.fn().mockReturnValue([]),
  getMessagesByTaskId: vi.fn().mockReturnValue([]),
  getOrchestrationRun: vi.fn(),
  getOrchestrationRunsByTaskId: vi.fn().mockReturnValue([]),
  getSetting: vi.fn(),
  getTask: vi.fn().mockImplementation((id: string) => ({
    id,
    work_dir: null,
  })),
  reserveAgentRun: vi.fn().mockImplementation((input) => ({
    disposition: 'created',
    run: { id: input.runId },
  })),
  finishAgentRun: vi.fn(),
  updateOrchestrationRunPayload: vi.fn(),
  updateOrchestrationRunStatus: vi.fn(),
  updateTask: vi.fn(),
}));

vi.mock('@/shared/db/index', () => ({
  getDatabase: vi.fn().mockReturnValue({
    prepare: vi.fn().mockReturnValue({
      run: db.run,
      get: vi.fn(),
      all: vi.fn().mockReturnValue([]),
    }),
  }),
}));

vi.mock('@/core/agent/base', () => ({
  isConversationalPrompt: vi.fn().mockReturnValue(false),
  isSingleActionPrompt: vi.fn().mockReturnValue(false),
}));

vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('@/shared/utils/url-validator', () => ({
  safeFetch: vi.fn(),
  validateBaseUrl: vi.fn().mockReturnValue({ valid: true }),
  validateBaseUrlForFetch: vi.fn().mockResolvedValue({ valid: true }),
}));

interface WireEvent {
  type: string;
  outcome?: { type: string; interrupts?: Array<{ id: string }> };
}

async function readEvents(res: Response): Promise<WireEvent[]> {
  const text = await res.text();
  return text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice('data: '.length)) as WireEvent);
}

const finished = (events: WireEvent[]): WireEvent | undefined =>
  events.find((event) => event.type === 'RUN_FINISHED');

/** A question asked in an earlier turn, then the user's answer as the final message. */
function answerRequest(
  taskId: string,
  runId: string,
  options: {
    answer: string;
    finalMessage?: string;
    payload?: unknown;
    status?: 'resolved' | 'cancelled';
    extraEntries?: Array<Record<string, unknown>>;
  },
) {
  return jsonReq('/run', {
    threadId: taskId,
    runId,
    messages: [
      { id: `${runId}-u1`, role: 'user', content: 'Which colour?' },
      { id: `${runId}-a1`, role: 'assistant', content: 'Pick one.' },
      {
        id: `${runId}-u2`,
        role: 'user',
        content: options.finalMessage ?? options.answer,
      },
    ],
    forwardedProps: { taskId },
    resume: [
      {
        interruptId: 'question:q-1',
        status: options.status ?? 'resolved',
        payload: options.payload ?? { answer: options.answer },
      },
      ...(options.extraEntries ?? []),
    ],
  });
}

function pendingQuestion(
  taskId: string,
  overrides: Partial<QuestionRow> = {},
): void {
  questions.rows.set('q-1', {
    id: 'q-1',
    task_id: taskId,
    status: 'pending',
    answer_json: null,
    expires_at: null,
    ...overrides,
  });
}

describe('AG-UI agent question resume', () => {
  beforeEach(() => {
    agent.script = null;
    questions.rows.clear();
    db.run.mockClear();
    vi.clearAllMocks();
  });

  it('records the answer and continues the run as a turn tagged as an answer', async () => {
    const { aguiRoutes } = await import('@/app/api/ag-ui');
    const { runAgent } = await import('@/shared/services/agent');
    agent.script = async function* () {
      yield { type: 'text', content: 'Thanks' };
    };
    pendingQuestion('task-q-answer');

    const res = await aguiRoutes.request(
      answerRequest('task-q-answer', 'run-answer', { answer: 'Blue' }),
    );
    const events = await readEvents(res);

    expect(res.status).toBe(200);
    expect(finished(events)?.outcome?.type ?? 'success').toBe('success');
    expect(questions.rows.get('q-1')).toMatchObject({
      status: 'answered',
      answer_json: JSON.stringify({ answer: 'Blue' }),
    });
    // The continuation's prompt is the answer, not the earlier question.
    expect(runAgent).toHaveBeenCalledWith('Blue', expect.anything());
    // The answer's user turn is stored with the subtype the legacy transcript reads.
    expect(db.run).toHaveBeenCalledWith(
      'task-q-answer',
      'Blue',
      expect.any(String),
      'main',
      expect.any(String),
      'question_answer',
    );
  });

  it('refuses an answer that is not the final user message, and leaves the question open', async () => {
    const { aguiRoutes } = await import('@/app/api/ag-ui');
    const { runAgent } = await import('@/shared/services/agent');
    pendingQuestion('task-q-mismatch');

    const res = await aguiRoutes.request(
      answerRequest('task-q-mismatch', 'run-mismatch', {
        answer: 'Blue',
        finalMessage: 'Green',
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'answer_mismatch' });
    expect(questions.rows.get('q-1')?.status).toBe('pending');
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('refuses a question that belongs to another task', async () => {
    const { aguiRoutes } = await import('@/app/api/ag-ui');
    pendingQuestion('task-someone-else');

    const res = await aguiRoutes.request(
      answerRequest('task-q-wrong-thread', 'run-wrong', { answer: 'Blue' }),
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'wrong_thread' });
    expect(questions.rows.get('q-1')?.status).toBe('pending');
  });

  it('refuses a question that was already answered', async () => {
    const { aguiRoutes } = await import('@/app/api/ag-ui');
    pendingQuestion('task-q-done', { status: 'answered' });

    const res = await aguiRoutes.request(
      answerRequest('task-q-done', 'run-done', { answer: 'Blue' }),
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'already_resolved' });
  });

  it('refuses an expired question as unavailable', async () => {
    const { aguiRoutes } = await import('@/app/api/ag-ui');
    pendingQuestion('task-q-expired', {
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });

    const res = await aguiRoutes.request(
      answerRequest('task-q-expired', 'run-expired', { answer: 'Blue' }),
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: 'continuation_unavailable',
    });
    expect(questions.rows.get('q-1')?.status).toBe('pending');
  });

  it('rejects an invalid answer without settling the question', async () => {
    const { aguiRoutes } = await import('@/app/api/ag-ui');
    pendingQuestion('task-q-invalid');

    const res = await aguiRoutes.request(
      answerRequest('task-q-invalid', 'run-invalid', {
        answer: '   ',
        payload: { answer: '   ' },
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'invalid_response' });
    expect(questions.rows.get('q-1')?.status).toBe('pending');
  });

  it('cancels the question and ends the run as cancelled, without continuing', async () => {
    const { aguiRoutes } = await import('@/app/api/ag-ui');
    const { runAgent } = await import('@/shared/services/agent');
    pendingQuestion('task-q-cancel');

    const res = await aguiRoutes.request(
      answerRequest('task-q-cancel', 'run-cancel', {
        answer: 'Blue',
        status: 'cancelled',
        payload: undefined,
      }),
    );
    const events = await readEvents(res);

    expect(finished(events)?.outcome).toEqual({ type: 'cancelled' });
    expect(questions.rows.get('q-1')?.status).toBe('cancelled');
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('refuses a batch that mixes a question with another decision', async () => {
    const { aguiRoutes } = await import('@/app/api/ag-ui');
    pendingQuestion('task-q-mixed');

    const res = await aguiRoutes.request(
      answerRequest('task-q-mixed', 'run-mixed', {
        answer: 'Blue',
        extraEntries: [
          {
            interruptId: 'permission:req-1',
            status: 'resolved',
            payload: {
              approved: true,
            },
          },
        ],
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'mixed_batch' });
    expect(questions.rows.get('q-1')?.status).toBe('pending');
  });

  it('answers 404 for a question id that does not exist', async () => {
    const { aguiRoutes } = await import('@/app/api/ag-ui');

    const res = await aguiRoutes.request(
      answerRequest('task-q-missing', 'run-missing', { answer: 'Blue' }),
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'unknown_interrupt' });
  });
});
