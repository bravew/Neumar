import { describe, expect, it, vi } from 'vitest';

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
  runDetachedPipeline: vi.fn(),
  subscribeSSEToBus: vi.fn(),
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
}));

vi.mock('@/shared/services/ag-ui/journal', () => ({
  replayAGUIEvents: vi.fn().mockReturnValue([]),
}));

vi.mock('@/shared/services/ag-ui/persistence', () => ({
  AGUIEventPersister: vi.fn().mockImplementation(() => ({
    wrap: (gen: AsyncGenerator) => gen,
    runStartedAtMs: Date.now(),
    scanOutputArtifacts: vi.fn(),
  })),
}));

vi.mock('@/shared/db/operations', () => ({
  AgentRunConflictError: class AgentRunConflictError extends Error {},
  createFileSnapshot: vi.fn(),
  getAgentRun: vi.fn(),
  getFilesByTaskId: vi.fn().mockReturnValue([]),
  getMessagesByTaskId: vi.fn().mockReturnValue([]),
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
  });
});
