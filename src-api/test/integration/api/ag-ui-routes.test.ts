import { beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonReq } from '../../helpers/request-factory';

// ---- Mock heavy dependencies ----

vi.mock('@/shared/services/agent', () => ({
  createSession: vi.fn().mockReturnValue({
    id: 'session-123',
    abortController: new AbortController(),
  }),
  runAgent: vi.fn().mockReturnValue(
    (async function* () {
      yield { type: 'text', content: 'Hello' };
    })(),
  ),
  runPlanningPhase: vi.fn().mockReturnValue(
    (async function* () {
      yield { type: 'text', content: 'Plan step 1' };
    })(),
  ),
  runExecutionPhase: vi.fn().mockReturnValue(
    (async function* () {
      yield { type: 'text', content: 'Executed' };
    })(),
  ),
  resolveAgentProvider: vi.fn().mockReturnValue('claude'),
}));

vi.mock('@/shared/services/branch-sdk-session', () => ({
  resolveBranchContextPlan: vi.fn().mockReturnValue({ path: 'main' }),
  withBranchSdkSessionRecording: vi.fn((stream: AsyncGenerator) => stream),
}));

vi.mock('@/shared/services/task-event-bus', () => ({
  taskEventBus: {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    publish: vi.fn(),
    getBuffer: vi.fn().mockReturnValue([]),
    getSeqBounds: vi.fn().mockReturnValue({ minSeq: null, maxSeq: null }),
    isTaskActive: vi.fn().mockReturnValue(false),
  },
}));

vi.mock('@/shared/services/active-query-store', () => ({
  activeQueryStore: {
    getQuery: vi.fn(),
    pushReply: vi.fn(),
  },
}));

vi.mock('@/shared/services/ag-ui/transport', () => ({
  runDetachedPipeline: vi.fn().mockResolvedValue(undefined),
  subscribeSSEToBus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/shared/services/ag-ui/emitter', () => ({
  AGUIEmitter: class MockAGUIEmitter {
    transform(gen: AsyncGenerator) {
      return gen;
    }
  },
}));

vi.mock('@/shared/services/ag-ui/history', () => ({
  dbMessagesToFullAGUI: vi.fn().mockReturnValue([]),
  dbMessagesToSubagents: vi.fn().mockReturnValue([]),
}));

vi.mock('@/shared/services/ag-ui/open-interrupts', () => ({
  listOpenInterrupts: vi.fn(),
}));

vi.mock('@/shared/services/ag-ui/journal', () => ({
  replayAGUIEvents: vi.fn().mockReturnValue([]),
}));

vi.mock('@/shared/services/ag-ui/persistence', () => ({
  AGUIEventPersister: class MockAGUIEventPersister {
    runStartedAtMs = Date.now();
    scanOutputArtifacts = vi.fn();
    wrap = (gen: AsyncGenerator) => gen;
  },
}));

vi.mock('@/shared/db/operations', () => ({
  AgentRunConflictError: class AgentRunConflictError extends Error {},
  answerAgentQuestion: vi.fn(),
  cancelAgentQuestion: vi.fn(),
  createAgentQuestion: vi.fn(),
  createFileSnapshot: vi.fn(),
  decideOrchestrationRun: vi.fn(),
  getAgentQuestion: vi.fn(),
  getPendingAgentQuestions: vi.fn().mockReturnValue([]),
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
      run: vi.fn(),
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

describe('AG-UI Routes', () => {
  // ---- POST /run ----

  describe('POST /run', () => {
    it('rejects missing threadId', async () => {
      const { aguiRoutes } = await import('@/app/api/ag-ui');
      const res = await aguiRoutes.request(jsonReq('/run', { messages: [] }));
      expect(res.status).toBe(400);
    });

    it('rejects empty body', async () => {
      const { aguiRoutes } = await import('@/app/api/ag-ui');
      const res = await aguiRoutes.request(jsonReq('/run', {}));
      expect(res.status).toBe(400);
    });

    it('accepts valid run request (does not return 400 validation error)', async () => {
      const { aguiRoutes } = await import('@/app/api/ag-ui');
      const res = await aguiRoutes.request(
        jsonReq('/run', {
          threadId: 'thread-1',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      );
      // Validation passes (not 400). Route may return 500 in-process because
      // SSE streaming requires a real connection (c.req.raw.signal unavailable
      // in app.request()). Full SSE testing is done via E2E tests.
      expect(res.status).not.toBe(400);
    });
  });

  describe('POST /run with a standard resume', () => {
    const planRow = (overrides: Record<string, unknown> = {}) => ({
      id: 'plan-1',
      task_id: 'task-resume',
      run_type: 'plan',
      status: 'pending',
      payload: JSON.stringify({
        id: 'plan-1',
        goal: 'Ship it',
        steps: [{ id: 's1', description: 'Write it', status: 'pending' }],
        createdAt: new Date().toISOString(),
      }),
      resume_token: null,
      created_at: '2026-01-01 00:00:00',
      updated_at: '2026-01-01 00:00:00',
      ...overrides,
    });

    const resumeRequest = (
      entries: Array<Record<string, unknown>>,
      taskId = 'task-resume',
    ) =>
      jsonReq('/run', {
        threadId: taskId,
        messages: [{ id: 'u1', role: 'user', content: 'Do the thing' }],
        forwardedProps: { taskId },
        resume: entries,
      });

    beforeEach(async () => {
      vi.clearAllMocks();
      const ops = await import('@/shared/db/operations');
      vi.mocked(ops.getTask).mockReturnValue({
        id: 'task-resume',
        status: 'stopped',
        work_dir: null,
      } as never);
      vi.mocked(ops.getOrchestrationRunsByTaskId).mockReturnValue([
        planRow() as never,
      ]);
    });

    it('starts execution for an approved plan named by its interrupt id', async () => {
      const { aguiRoutes } = await import('@/app/api/ag-ui');
      const ops = await import('@/shared/db/operations');
      const agent = await import('@/shared/services/agent');
      vi.mocked(ops.getOrchestrationRun).mockReturnValue(planRow() as never);
      vi.mocked(ops.decideOrchestrationRun).mockReturnValue(true);

      const res = await aguiRoutes.request(
        resumeRequest([
          {
            interruptId: 'plan:plan-1',
            status: 'resolved',
            payload: { approved: true },
          },
        ]),
      );

      expect(res.status).toBe(200);
      expect(ops.decideOrchestrationRun).toHaveBeenCalledWith(
        'plan-1',
        'pending',
        'approved',
      );
      expect(vi.mocked(agent.runExecutionPhase).mock.calls.at(-1)?.[0]).toBe(
        'plan-1',
      );
    });

    it('finishes without executing when the plan is rejected', async () => {
      const { aguiRoutes } = await import('@/app/api/ag-ui');
      const ops = await import('@/shared/db/operations');
      const agent = await import('@/shared/services/agent');
      vi.mocked(ops.getOrchestrationRun).mockReturnValue(planRow() as never);
      vi.mocked(ops.decideOrchestrationRun).mockReturnValue(true);
      const before = vi.mocked(agent.runExecutionPhase).mock.calls.length;

      const res = await aguiRoutes.request(
        resumeRequest([
          {
            interruptId: 'plan:plan-1',
            status: 'resolved',
            payload: { approved: false },
          },
        ]),
      );

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain('RUN_STARTED');
      expect(body).toContain('RUN_FINISHED');
      expect(body).not.toContain('"type":"interrupt"');
      expect(ops.decideOrchestrationRun).toHaveBeenCalledWith(
        'plan-1',
        'pending',
        'rejected',
      );
      expect(vi.mocked(agent.runExecutionPhase).mock.calls.length).toBe(before);
    });

    it('reports a cancelled decision with the standard cancelled outcome', async () => {
      const { aguiRoutes } = await import('@/app/api/ag-ui');
      const ops = await import('@/shared/db/operations');
      vi.mocked(ops.getOrchestrationRun).mockReturnValue(planRow() as never);
      vi.mocked(ops.decideOrchestrationRun).mockReturnValue(true);

      const res = await aguiRoutes.request(
        resumeRequest([{ interruptId: 'plan:plan-1', status: 'cancelled' }]),
      );

      expect(res.status).toBe(200);
      expect(await res.text()).toContain('"outcome":{"type":"cancelled"}');
      expect(ops.decideOrchestrationRun).toHaveBeenCalledWith(
        'plan-1',
        'pending',
        'rejected',
      );
    });

    it('rejects a response that does not match the plan schema', async () => {
      const { aguiRoutes } = await import('@/app/api/ag-ui');
      const ops = await import('@/shared/db/operations');
      vi.mocked(ops.getOrchestrationRun).mockReturnValue(planRow() as never);

      const res = await aguiRoutes.request(
        resumeRequest([
          {
            interruptId: 'plan:plan-1',
            status: 'resolved',
            payload: { approved: 'yes' },
          },
        ]),
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'invalid_response' });
      expect(ops.decideOrchestrationRun).not.toHaveBeenCalled();
    });

    it('reports an already answered decision instead of executing twice', async () => {
      const { aguiRoutes } = await import('@/app/api/ag-ui');
      const ops = await import('@/shared/db/operations');
      vi.mocked(ops.getOrchestrationRun).mockReturnValue(
        planRow({ status: 'approved' }) as never,
      );

      const res = await aguiRoutes.request(
        resumeRequest([
          {
            interruptId: 'plan:plan-1',
            status: 'resolved',
            payload: { approved: true },
          },
        ]),
      );

      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({
        code: 'already_resolved',
        status: 'approved',
      });
      expect(ops.decideOrchestrationRun).not.toHaveBeenCalled();
    });

    it('refuses a decision minted for another task', async () => {
      const { aguiRoutes } = await import('@/app/api/ag-ui');
      const ops = await import('@/shared/db/operations');
      vi.mocked(ops.getOrchestrationRun).mockReturnValue(
        planRow({ task_id: 'other-task' }) as never,
      );

      const res = await aguiRoutes.request(
        resumeRequest([
          {
            interruptId: 'plan:plan-1',
            status: 'resolved',
            payload: { approved: true },
          },
        ]),
      );

      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'wrong_thread' });
    });

    it.each(['pending', 'approved'])(
      'refuses an older pending plan when a newer plan is %s',
      async (status) => {
        const { aguiRoutes } = await import('@/app/api/ag-ui');
        const ops = await import('@/shared/db/operations');
        const agent = await import('@/shared/services/agent');
        vi.mocked(ops.getOrchestrationRun).mockReturnValue(planRow() as never);
        vi.mocked(ops.getOrchestrationRunsByTaskId).mockReturnValue([
          planRow({ id: 'new-plan', status }) as never,
          planRow() as never,
        ]);

        const res = await aguiRoutes.request(
          resumeRequest([
            {
              interruptId: 'plan:plan-1',
              status: 'resolved',
              payload: { approved: true },
            },
          ]),
        );

        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ code: 'stale_interrupt' });
        expect(ops.decideOrchestrationRun).not.toHaveBeenCalled();
        expect(agent.runExecutionPhase).not.toHaveBeenCalled();
        const pending = await aguiRoutes.request('/pending-plan/task-resume');
        if (status === 'approved') {
          expect(await pending.json()).toEqual({ plan: null, interrupt: null });
        }
      },
    );

    it('refuses a plan response while its task is already running', async () => {
      const { aguiRoutes } = await import('@/app/api/ag-ui');
      const ops = await import('@/shared/db/operations');
      vi.mocked(ops.getOrchestrationRun).mockReturnValue(planRow() as never);
      vi.mocked(ops.getTask).mockReturnValue({
        id: 'task-resume',
        status: 'running',
      } as never);

      const res = await aguiRoutes.request(
        resumeRequest([{ interruptId: 'plan:plan-1', status: 'cancelled' }]),
      );

      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'stale_interrupt' });
      expect(ops.decideOrchestrationRun).not.toHaveBeenCalled();
    });

    it('reports an unknown interrupt', async () => {
      const { aguiRoutes } = await import('@/app/api/ag-ui');
      const ops = await import('@/shared/db/operations');
      vi.mocked(ops.getOrchestrationRun).mockReturnValue(null);

      const res = await aguiRoutes.request(
        resumeRequest([
          {
            interruptId: 'plan:missing',
            status: 'resolved',
            payload: { approved: true },
          },
        ]),
      );

      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: 'unknown_interrupt' });
    });

    it('rejects the same interrupt twice in one batch', async () => {
      const { aguiRoutes } = await import('@/app/api/ag-ui');

      const res = await aguiRoutes.request(
        resumeRequest([
          {
            interruptId: 'plan:plan-1',
            status: 'resolved',
            payload: { approved: true },
          },
          { interruptId: 'plan:plan-1', status: 'cancelled' },
        ]),
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'duplicate_interrupt' });
    });

    it('does not mix a plan decision with a live decision', async () => {
      const { aguiRoutes } = await import('@/app/api/ag-ui');

      const res = await aguiRoutes.request(
        resumeRequest([
          {
            interruptId: 'plan:plan-1',
            status: 'resolved',
            payload: { approved: true },
          },
          {
            interruptId: 'permission:p-1',
            status: 'resolved',
            payload: { approved: true },
          },
        ]),
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'mixed_batch' });
    });

    it('answers at most one plan per batch', async () => {
      const { aguiRoutes } = await import('@/app/api/ag-ui');

      const res = await aguiRoutes.request(
        resumeRequest([
          {
            interruptId: 'plan:plan-1',
            status: 'resolved',
            payload: { approved: true },
          },
          {
            interruptId: 'plan:plan-2',
            status: 'resolved',
            payload: { approved: true },
          },
        ]),
      );

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'multiple_plans' });
    });

    // A question is answered by resuming the run (see
    // ag-ui-question-resume.test.ts); it no longer has a live-endpoint 409.
    it('reports a question with no stored record as an unknown interrupt', async () => {
      const { aguiRoutes } = await import('@/app/api/ag-ui');

      const res = await aguiRoutes.request(
        resumeRequest([
          {
            interruptId: 'question:q-1',
            status: 'resolved',
            payload: { answer: 'yes' },
          },
        ]),
      );

      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: 'unknown_interrupt' });
    });

    it('reports a permission nothing is waiting on as unavailable', async () => {
      const { aguiRoutes } = await import('@/app/api/ag-ui');

      const res = await aguiRoutes.request(
        resumeRequest([
          {
            interruptId: 'permission:p-1',
            status: 'resolved',
            payload: { approved: true },
          },
        ]),
      );

      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({
        code: 'continuation_unavailable',
      });
    });
  });

  describe('POST /run on a conversation branch', () => {
    const branchId = '0b3c6f4e-5d3a-4c1e-9f5a-2b7d8e9f0a1b';
    const branchRequest = () =>
      jsonReq('/run', {
        threadId: 'thread-branch',
        messages: [
          { id: 'u1', role: 'user', content: 'First question' },
          { id: 'a1', role: 'assistant', content: 'First answer' },
          { id: 'u2', role: 'user', content: 'Edited follow-up' },
        ],
        forwardedProps: { taskId: 'task-branch', branchId },
      });

    it('forks the SDK session instead of sending text history', async () => {
      const { aguiRoutes } = await import('@/app/api/ag-ui');
      const agent = await import('@/shared/services/agent');
      const branchSessions =
        await import('@/shared/services/branch-sdk-session');
      vi.mocked(agent.runAgent).mockClear();
      vi.mocked(branchSessions.resolveBranchContextPlan).mockReturnValueOnce({
        path: 'sdk',
        mode: 'fork',
        branchSession: { kind: 'fork', parentSessionId: 'sdk-main-1' },
      });

      await aguiRoutes.request(branchRequest());

      expect(branchSessions.resolveBranchContextPlan).toHaveBeenCalledWith({
        taskId: 'task-branch',
        branchId,
        provider: 'claude',
      });
      const [, options] = vi.mocked(agent.runAgent).mock.calls.at(-1)!;
      expect(options.branchSession).toEqual({
        kind: 'fork',
        parentSessionId: 'sdk-main-1',
      });
      expect(options.conversation).toBeUndefined();
      expect(branchSessions.withBranchSdkSessionRecording).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          taskId: 'task-branch',
          branchId,
          sdkSessionId: 'session-123',
        }),
      );
    });

    it('keeps the text history path when the branch cannot fork', async () => {
      const { aguiRoutes } = await import('@/app/api/ag-ui');
      const agent = await import('@/shared/services/agent');
      const branchSessions =
        await import('@/shared/services/branch-sdk-session');
      vi.mocked(agent.runAgent).mockClear();
      vi.mocked(agent.resolveAgentProvider).mockReturnValueOnce('codex');
      vi.mocked(branchSessions.resolveBranchContextPlan).mockReturnValueOnce({
        path: 'text',
        reason: 'runtime-without-fork',
      });

      await aguiRoutes.request(branchRequest());

      const [, options] = vi.mocked(agent.runAgent).mock.calls.at(-1)!;
      expect(options.branchSession).toBeUndefined();
      expect(options.conversation).toEqual([
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'First answer' },
      ]);
    });
  });

  describe('POST /run with activity messages in the thread', () => {
    // The AG-UI client keeps activity messages in its list and sends them back
    // on the next run. Their `content` is an object, not text.
    const activityRequest = () =>
      jsonReq('/run', {
        threadId: 'thread-activity',
        messages: [
          { id: 'u1', role: 'user', content: 'First question' },
          {
            id: 'status-1',
            role: 'activity',
            activityType: 'status',
            content: { phase: 'planning', message: 'SECRET-ACTIVITY-TEXT' },
          },
          { id: 'a1', role: 'assistant', content: 'First answer' },
          { id: 'u2', role: 'user', content: 'Follow-up' },
        ],
        forwardedProps: { taskId: 'task-activity' },
      });

    it('accepts the request and keeps activity content out of model input', async () => {
      const { aguiRoutes } = await import('@/app/api/ag-ui');
      const agent = await import('@/shared/services/agent');
      const branchSessions =
        await import('@/shared/services/branch-sdk-session');
      vi.mocked(agent.runAgent).mockClear();
      vi.mocked(agent.resolveAgentProvider).mockReturnValueOnce('codex');
      vi.mocked(branchSessions.resolveBranchContextPlan).mockReturnValueOnce({
        path: 'text',
        reason: 'runtime-without-fork',
      });

      const res = await aguiRoutes.request(activityRequest());

      expect(res.status).not.toBe(400);
      const [prompt, options] = vi.mocked(agent.runAgent).mock.calls.at(-1)!;
      expect(options.conversation).toEqual([
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'First answer' },
      ]);
      expect(JSON.stringify([prompt, options])).not.toContain(
        'SECRET-ACTIVITY-TEXT',
      );
    });
  });

  // ---- POST /stop/:taskId ----

  describe('POST /stop/:taskId', () => {
    it('returns ok for valid taskId', async () => {
      const { aguiRoutes } = await import('@/app/api/ag-ui');
      const res = await aguiRoutes.request(
        jsonReq('/stop/task-abc', null, 'POST'),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('ok', true);
    });

    it('rejects invalid taskId with path traversal', async () => {
      const { aguiRoutes } = await import('@/app/api/ag-ui');
      const res = await aguiRoutes.request(
        jsonReq('/stop/../../etc', null, 'POST'),
      );
      // Should reject due to path validation
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('POST /cancel/:mode/:ownerKey/:runId', () => {
    it('cancels only the active run owned by the route', async () => {
      const { aguiRoutes } = await import('@/app/api/ag-ui');
      const operations = await import('@/shared/db/operations');
      const runtime = await import('@/shared/services/ag-ui/runtime');
      const controller = new AbortController();
      vi.mocked(operations.getAgentRun).mockReturnValueOnce({
        id: 'run-cancel',
        mode: 'video',
        owner_key: 'project-video',
      } as never);
      runtime.registerActiveAGUIRun({
        mode: 'video',
        ownerKey: 'project-video',
        runId: 'run-cancel',
        busKey: 'video-bus',
        controller,
      });

      const res = await aguiRoutes.request(
        jsonReq('/cancel/video/project-video/run-cancel', null, 'POST'),
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(controller.signal.aborted).toBe(true);
    });
  });

  // ---- POST /interrupt/:taskId ----

  describe('POST /interrupt/:taskId', () => {
    it('accepts valid interrupt with response text', async () => {
      const { aguiRoutes } = await import('@/app/api/ag-ui');
      const res = await aguiRoutes.request(
        jsonReq('/interrupt/task-abc', { response: 'yes, proceed' }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('ok', true);
    });
  });

  // ---- GET /history/:taskId ----

  describe('GET /history/:taskId', () => {
    it('returns messages and running status', async () => {
      const { aguiRoutes } = await import('@/app/api/ag-ui');
      const res = await aguiRoutes.request('/history/task-abc');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('messages');
      expect(body).toHaveProperty('files');
      expect(body).toHaveProperty('isRunning');
      expect(Array.isArray(body.messages)).toBe(true);
      expect(Array.isArray(body.files)).toBe(true);
    });

    it('returns the sub-agent invocations built from the stored rows', async () => {
      const { aguiRoutes } = await import('@/app/api/ag-ui');
      const operations = await import('@/shared/db/operations');
      const history = await import('@/shared/services/ag-ui/history');
      const rows = [{ id: 'row-1' }] as never;
      const runs = [
        { id: 'task-a', name: 'Scan', status: 'completed', result: 'done' },
      ];
      vi.mocked(operations.getMessagesByTaskId).mockReturnValueOnce(rows);
      vi.mocked(history.dbMessagesToSubagents).mockReturnValueOnce(
        runs as never,
      );

      const res = await aguiRoutes.request('/history/task-abc');
      const body = (await res.json()) as { subagents: unknown };

      expect(history.dbMessagesToSubagents).toHaveBeenCalledWith(rows);
      expect(body.subagents).toEqual(runs);
    });
  });

  // ---- GET /pending-plan/:taskId ----

  describe('GET /pending-plan/:taskId', () => {
    it('returns null plan when no pending plan exists', async () => {
      const { aguiRoutes } = await import('@/app/api/ag-ui');
      const res = await aguiRoutes.request('/pending-plan/task-abc');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('plan');
    });
  });

  // ---- GET /interrupts/:taskId ----

  describe('GET /interrupts/:taskId', () => {
    it('returns every open decision the task is waiting on', async () => {
      const { listOpenInterrupts } =
        await import('@/shared/services/ag-ui/open-interrupts');
      vi.mocked(listOpenInterrupts).mockResolvedValueOnce([
        { id: 'permission:req-1', reason: 'tool_permission' },
        { id: 'question:q-1', reason: 'agent_question' },
      ]);
      const { aguiRoutes } = await import('@/app/api/ag-ui');

      const res = await aguiRoutes.request('/interrupts/task-abc');

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        interrupts: [
          { id: 'permission:req-1', reason: 'tool_permission' },
          { id: 'question:q-1', reason: 'agent_question' },
        ],
      });
      expect(listOpenInterrupts).toHaveBeenCalledWith('task-abc');
    });

    it('rejects a task id that is not a plain identifier', async () => {
      const { listOpenInterrupts } =
        await import('@/shared/services/ag-ui/open-interrupts');
      vi.mocked(listOpenInterrupts).mockClear();
      const { aguiRoutes } = await import('@/app/api/ag-ui');

      const res = await aguiRoutes.request('/interrupts/..%2Fescape');

      expect(res.status).toBe(400);
      expect(listOpenInterrupts).not.toHaveBeenCalled();
    });
  });

  // ---- POST /reject-plan/:taskId ----

  describe('POST /reject-plan/:taskId', () => {
    it('returns ok', async () => {
      const { aguiRoutes } = await import('@/app/api/ag-ui');
      const res = await aguiRoutes.request(
        jsonReq('/reject-plan/task-abc', null, 'POST'),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('ok', true);
    });
  });

  // ---- GET /subscribe/:taskId ----

  describe('GET /subscribe/:taskId', () => {
    it('returns 404 when no active run exists', async () => {
      const { aguiRoutes } = await import('@/app/api/ag-ui');
      const res = await aguiRoutes.request('/subscribe/task-no-run');
      // Subscribe should return 404 or start an SSE stream
      expect([200, 404]).toContain(res.status);
    });

    it('replays after Last-Event-ID without starting a duplicate run', async () => {
      const { aguiRoutes } = await import('@/app/api/ag-ui');
      const agentService = await import('@/shared/services/agent');
      const { taskEventBus } = await import('@/shared/services/task-event-bus');
      await aguiRoutes.request(
        jsonReq('/run', {
          threadId: 'task-reconnect',
          runId: 'run-reconnect',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      );
      const runCalls = vi.mocked(agentService.runAgent).mock.calls.length;
      vi.mocked(taskEventBus.getSeqBounds).mockReturnValueOnce({
        minSeq: 0,
        maxSeq: 3,
      });
      vi.mocked(taskEventBus.subscribe).mockReturnValueOnce(vi.fn());

      const res = await aguiRoutes.request(
        new Request('http://localhost/subscribe/task-reconnect', {
          headers: { 'Last-Event-ID': '1' },
        }),
      );

      expect(res.status).toBe(200);
      expect(taskEventBus.subscribe).toHaveBeenCalledWith(
        expect.stringMatching(/^agui-task-reconnect-/),
        expect.any(Function),
        { afterSeq: 1 },
      );
      expect(agentService.runAgent).toHaveBeenCalledTimes(runCalls);
    });
  });

  describe('GET /subscribe/:mode/:ownerKey/:runId', () => {
    it('rejects a route owner that does not match the reserved run', async () => {
      const { aguiRoutes } = await import('@/app/api/ag-ui');
      const operations = await import('@/shared/db/operations');
      vi.mocked(operations.getAgentRun).mockReturnValueOnce({
        id: 'run-owned',
        mode: 'design',
        owner_key: 'project-owned',
        status: 'running',
      } as never);

      const res = await aguiRoutes.request(
        '/subscribe/design/project-other/run-owned',
      );

      expect(res.status).toBe(409);
    });

    it('replays a persisted terminal suffix without requiring an active bus', async () => {
      const { aguiRoutes } = await import('@/app/api/ag-ui');
      const operations = await import('@/shared/db/operations');
      const journal = await import('@/shared/services/ag-ui/journal');
      vi.mocked(operations.getAgentRun).mockReturnValueOnce({
        id: 'run-finished',
        mode: 'video',
        owner_key: 'project-video',
        status: 'completed',
      } as never);
      vi.mocked(journal.replayAGUIEvents).mockReturnValueOnce([
        { type: 'TEXT_MESSAGE_CONTENT', seq: 3, delta: 'finished' } as never,
        { type: 'RUN_FINISHED', seq: 4 } as never,
      ]);

      const res = await aguiRoutes.request(
        new Request(
          'http://localhost/subscribe/video/project-video/run-finished',
          { headers: { 'Last-Event-ID': '2' } },
        ),
      );

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain('TEXT_MESSAGE_CONTENT');
      expect(body).toContain('RUN_FINISHED');
      expect(journal.replayAGUIEvents).toHaveBeenCalledWith('run-finished', 2);
    });

    it('hands off from the durable suffix to the active bus', async () => {
      const { aguiRoutes } = await import('@/app/api/ag-ui');
      const operations = await import('@/shared/db/operations');
      const journal = await import('@/shared/services/ag-ui/journal');
      const runtime = await import('@/shared/services/ag-ui/runtime');
      const { taskEventBus } = await import('@/shared/services/task-event-bus');
      vi.mocked(operations.getAgentRun).mockReturnValueOnce({
        id: 'run-active',
        mode: 'design',
        owner_key: 'project-design',
        status: 'running',
      } as never);
      vi.mocked(journal.replayAGUIEvents).mockReturnValueOnce([
        { type: 'RUN_STARTED', seq: 0 } as never,
      ]);
      vi.mocked(taskEventBus.subscribe).mockImplementationOnce(
        (_key, callback) => {
          callback(
            { type: 'RUN_FINISHED', seq: 1 },
            {
              id: '1',
              seq: 1,
              message: { type: 'RUN_FINISHED', seq: 1 },
            },
          );
          return vi.fn();
        },
      );
      const unregister = runtime.registerActiveAGUIRun({
        mode: 'design',
        ownerKey: 'project-design',
        runId: 'run-active',
        busKey: 'agui-design-project-design-run-active',
        controller: new AbortController(),
      });

      const res = await aguiRoutes.request(
        '/subscribe/design/project-design/run-active',
      );
      const body = await res.text();
      unregister();

      expect(body).toContain('RUN_STARTED');
      expect(body).toContain('RUN_FINISHED');
      expect(taskEventBus.subscribe).toHaveBeenCalledWith(
        'agui-design-project-design-run-active',
        expect.any(Function),
        { afterSeq: 0 },
      );
    });

    it('falls back to a Task snapshot when the durable suffix has a gap', async () => {
      const { aguiRoutes } = await import('@/app/api/ag-ui');
      const operations = await import('@/shared/db/operations');
      const journal = await import('@/shared/services/ag-ui/journal');
      vi.mocked(operations.getAgentRun).mockReturnValueOnce({
        id: 'run-gap',
        mode: 'task',
        owner_key: 'task-gap',
        status: 'completed',
        delivery: 'not_expected',
        delivery_reconciliation_deadline: null,
      } as never);
      vi.mocked(journal.replayAGUIEvents).mockReturnValueOnce([
        { type: 'RUN_FINISHED', seq: 4 } as never,
      ]);

      const res = await aguiRoutes.request(
        new Request('http://localhost/subscribe/task/task-gap/run-gap', {
          headers: { 'Last-Event-ID': '1' },
        }),
      );
      const body = await res.text();

      expect(body.indexOf('MESSAGES_SNAPSHOT')).toBeLessThan(
        body.indexOf('RUN_FINISHED'),
      );
    });

    it('carries the sub-agent invocations in the gap snapshot', async () => {
      const { aguiRoutes } = await import('@/app/api/ag-ui');
      const operations = await import('@/shared/db/operations');
      const journal = await import('@/shared/services/ag-ui/journal');
      const history = await import('@/shared/services/ag-ui/history');
      vi.mocked(operations.getAgentRun).mockReturnValueOnce({
        id: 'run-gap',
        mode: 'task',
        owner_key: 'task-gap',
        status: 'completed',
        delivery: 'not_expected',
        delivery_reconciliation_deadline: null,
      } as never);
      vi.mocked(journal.replayAGUIEvents).mockReturnValueOnce([
        { type: 'RUN_FINISHED', seq: 4 } as never,
      ]);
      vi.mocked(history.dbMessagesToSubagents).mockReturnValueOnce([
        { id: 'task-a', name: 'Scan', status: 'running' },
      ] as never);

      const res = await aguiRoutes.request(
        new Request('http://localhost/subscribe/task/task-gap/run-gap', {
          headers: { 'Last-Event-ID': '1' },
        }),
      );
      const body = await res.text();

      const snapshot = body
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>)
        .find((event) => event.type === 'MESSAGES_SNAPSHOT');
      expect(snapshot?.subagents).toEqual([
        { id: 'task-a', name: 'Scan', status: 'running' },
      ]);
    });
  });
});
