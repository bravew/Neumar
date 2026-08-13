import { describe, expect, it, vi } from 'vitest';

import { jsonReq } from '../../helpers/request-factory';

// ---- Mock heavy dependencies ----

const mockRunPlanningPhase = vi.fn();
const mockRunExecutionPhase = vi.fn();
const mockRunAgent = vi.fn();
const mockRunAgentResume = vi.fn();
const mockCreateSession = vi.fn().mockResolvedValue('session-123');
const mockDeleteSession = vi.fn();
const mockGetSession = vi.fn();
const mockGetPlan = vi.fn();
const mockGenerateTitle = vi.fn();
const mockGetTask = vi.fn().mockImplementation((id: string) => ({
  id,
  work_dir: null,
}));

vi.mock('@/shared/services/agent', () => ({
  runPlanningPhase: (...args: unknown[]) => mockRunPlanningPhase(...args),
  runExecutionPhase: (...args: unknown[]) => mockRunExecutionPhase(...args),
  runAgent: (...args: unknown[]) => mockRunAgent(...args),
  runAgentResume: (...args: unknown[]) => mockRunAgentResume(...args),
  createSession: (...args: unknown[]) => mockCreateSession(...args),
  deleteSession: (...args: unknown[]) => mockDeleteSession(...args),
  getSession: (...args: unknown[]) => mockGetSession(...args),
  getPlan: (...args: unknown[]) => mockGetPlan(...args),
}));

vi.mock('@/shared/services/title-generator', () => ({
  generateTitle: (...args: unknown[]) => mockGenerateTitle(...args),
}));

vi.mock('@/shared/plugins', () => ({
  loadAllSkills: vi.fn().mockResolvedValue(
    ['one', 'two', 'three'].map((name) => ({
      name,
      bareName: name,
      plugin: null,
      path: `/skills/${name}`,
      metadata: { name, description: name },
      content: '',
    })),
  ),
}));

vi.mock('@/shared/services/task-event-bus', () => ({
  taskEventBus: {
    subscribe: vi.fn().mockReturnValue(vi.fn()), // returns unsubscribe fn
    unsubscribe: vi.fn(),
    publish: vi.fn(),
    publishWithEnvelope: vi.fn(),
    isTaskActive: vi.fn().mockReturnValue(false),
    getBufferSize: vi.fn().mockReturnValue(0),
    getSeqBounds: vi.fn().mockReturnValue({ minSeq: null, maxSeq: null }),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  },
}));

vi.mock('@/shared/services/active-query-store', () => ({
  activeQueryStore: {
    getQuery: vi.fn(),
    pushReply: vi.fn(),
  },
}));

vi.mock('@/shared/services/usage-logger', () => ({
  resolveBillingType: vi.fn().mockReturnValue('free'),
}));

const mockCanAcceptTask = vi.fn().mockReturnValue(true);
const mockTryExecuteOrQueue = vi.fn().mockReturnValue({ status: 'executing' });
const mockGetQueueState = vi.fn().mockReturnValue({
  running: 0,
  maxConcurrent: 3,
  queued: 0,
  runningTaskIds: [],
});
const mockGetGlobalStats = vi.fn().mockReturnValue({
  totalRunning: 0,
  totalQueued: 0,
  perProfile: {},
});

vi.mock('@/core/queue-manager', () => ({
  canAcceptTask: (...args: unknown[]) => mockCanAcceptTask(...args),
  tryExecuteOrQueue: (...args: unknown[]) => mockTryExecuteOrQueue(...args),
  getQueueState: (...args: unknown[]) => mockGetQueueState(...args),
  getGlobalStats: (...args: unknown[]) => mockGetGlobalStats(...args),
  onTaskComplete: vi.fn(),
  QUEUE_EVENTS: {
    TASK_COMPLETED: 'queue:task-completed',
    TASK_FAILED: 'queue:task-failed',
    TASK_DEQUEUED: 'queue:task-dequeued',
  },
}));

const mockGetAgentResumeIdentity = vi.fn().mockReturnValue(null);
const mockUpsertAgentResumeIdentity = vi.fn();

vi.mock('@/shared/db/agent-resume-identity', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/shared/db/agent-resume-identity')>();
  return {
    ...actual,
    getAgentResumeIdentity: (...args: unknown[]) =>
      mockGetAgentResumeIdentity(...args),
    upsertAgentResumeIdentity: (...args: unknown[]) =>
      mockUpsertAgentResumeIdentity(...args),
  };
});

vi.mock('@/shared/db/operations', () => ({
  AgentRunConflictError: class AgentRunConflictError extends Error {},
  createSession: vi.fn().mockReturnValue({ id: 'session-1' }),
  createTask: vi.fn().mockReturnValue({ id: 'task-1' }),
  createMessage: vi.fn(),
  createAgentQuestion: vi.fn().mockReturnValue({
    id: 'question-1',
    session_id: 'session-1',
    task_id: null,
    tool_use_id: null,
    questions_json: '[]',
    status: 'pending',
    answer_json: null,
    asked_at: '2026-05-17T00:00:00.000Z',
    answered_at: null,
    expires_at: null,
    created_at: '2026-05-17T00:00:00.000Z',
    updated_at: '2026-05-17T00:00:00.000Z',
  }),
  getAgentQuestion: vi.fn().mockReturnValue(null),
  getPendingAgentQuestions: vi.fn().mockReturnValue([]),
  answerAgentQuestion: vi.fn().mockReturnValue(null),
  getSession: vi.fn().mockReturnValue(null),
  getSetting: vi.fn().mockReturnValue(null),
  getTask: (...args: unknown[]) => mockGetTask(...args),
  reserveAgentRun: vi.fn().mockImplementation((input) => ({
    disposition: 'created',
    run: { id: input.runId },
  })),
  finishAgentRun: vi.fn(),
  markZombieTasks: vi.fn().mockReturnValue(0),
  messageExists: vi.fn().mockReturnValue(false),
  touchTask: vi.fn(),
  updateTask: vi.fn(),
  updateTaskFromMessage: vi.fn(),
  updateTaskHeartbeat: vi.fn(),
}));

vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('@/shared/utils/task-classifier', () => ({
  classifyTask: vi.fn().mockReturnValue('complex'),
}));

vi.mock('@/shared/utils/url-validator', () => ({
  validateBaseUrl: vi.fn().mockReturnValue({ valid: true }),
  validateBaseUrlForFetch: vi.fn().mockResolvedValue({ valid: true }),
}));

vi.mock('@/shared/utils/path-validator', () => ({
  validateWorkDir: vi
    .fn()
    .mockReturnValue({ valid: true, resolved: '/tmp/test' }),
  checkPermission: vi.fn().mockReturnValue({ allowed: true }),
}));

vi.mock('@/extensions/agent/claude/index', () => ({
  resolvePermission: vi.fn().mockReturnValue(true),
}));

describe('Agent API', () => {
  // ---- POST /plan ----

  describe('POST /plan', () => {
    it('rejects empty body', async () => {
      const { agentRoutes } = await import('@/app/api/agent');
      const res = await agentRoutes.request(jsonReq('/plan', {}));
      expect(res.status).toBe(400);
    });

    it('rejects missing prompt', async () => {
      const { agentRoutes } = await import('@/app/api/agent');
      const res = await agentRoutes.request(jsonReq('/plan', { prompt: '' }));
      expect(res.status).toBe(400);
    });

    it('accepts valid plan request and returns SSE stream', async () => {
      mockRunPlanningPhase.mockReturnValue(
        (async function* () {
          yield { type: 'text', content: 'Plan step 1' };
        })(),
      );

      const { agentRoutes } = await import('@/app/api/agent');
      const res = await agentRoutes.request(
        jsonReq('/plan', { prompt: 'Build a todo app' }),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
    });
  });

  // ---- POST /execute ----

  describe('POST /execute', () => {
    it('rejects missing planId', async () => {
      const { agentRoutes } = await import('@/app/api/agent');
      const res = await agentRoutes.request(jsonReq('/execute', {}));
      expect(res.status).toBe(400);
    });

    it('rejects empty planId', async () => {
      const { agentRoutes } = await import('@/app/api/agent');
      const res = await agentRoutes.request(
        jsonReq('/execute', { planId: '' }),
      );
      expect(res.status).toBe(400);
    });
  });

  // ---- POST / (direct run) ----

  describe('POST / (direct run)', () => {
    it('rejects empty body', async () => {
      const { agentRoutes } = await import('@/app/api/agent');
      const res = await agentRoutes.request(jsonReq('/', {}));
      expect(res.status).toBe(400);
    });

    it('rejects empty prompt', async () => {
      const { agentRoutes } = await import('@/app/api/agent');
      const res = await agentRoutes.request(jsonReq('/', { prompt: '' }));
      expect(res.status).toBe(400);
    });

    it('returns 202 when queue is at capacity', async () => {
      mockTryExecuteOrQueue.mockReturnValueOnce({
        status: 'queued',
        queuePosition: 1,
      });

      const { agentRoutes } = await import('@/app/api/agent');
      const res = await agentRoutes.request(
        jsonReq('/', { prompt: 'Do something', taskId: 'task-q1' }),
      );
      expect(res.status).toBe(202);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('status', 'queued');
      expect(body).toHaveProperty('queuePosition', 1);
    });

    it('rejects a combined legacy and supplemental skill union over the cap', async () => {
      const { agentRoutes } = await import('@/app/api/agent');
      const res = await agentRoutes.request(
        jsonReq('/', {
          prompt: 'Do something',
          taskId: 'task-skills',
          pinnedSkills: ['one', 'two'],
          supplementalSkillIds: ['three', 'four'],
        }),
      );
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        error: expect.stringContaining('three supplemental skills'),
      });
    });

    it('normalizes both Task skill spellings into one agent option', async () => {
      mockRunAgent.mockReturnValueOnce(
        (async function* () {
          yield { type: 'done' };
        })(),
      );
      const { agentRoutes } = await import('@/app/api/agent');
      const res = await agentRoutes.request(
        jsonReq('/', {
          prompt: 'Do something',
          taskId: 'task-skill-compat',
          pinnedSkills: ['one'],
          supplementalSkillIds: ['two', 'one'],
        }),
      );
      expect(res.status).toBe(200);
      await res.text();
      expect(mockRunAgent).toHaveBeenCalledWith(
        'Do something',
        expect.objectContaining({ pinnedSkills: ['two', 'one'] }),
      );
    });

    it('rejects a stale Task conversation when the new envelope is used', async () => {
      mockGetTask.mockReturnValueOnce(null);
      const { agentRoutes } = await import('@/app/api/agent');
      const res = await agentRoutes.request(
        jsonReq('/', {
          prompt: 'Do something',
          taskId: 'stale-task',
          runContext: { mode: 'task', conversationId: 'stale-task' },
        }),
      );
      expect(res.status).toBe(404);
    });
  });

  // ---- Resume identity recording ----

  describe('resume identity recording', () => {
    it('records the identity when an /execute stream reports its session', async () => {
      mockUpsertAgentResumeIdentity.mockClear();
      mockGetPlan.mockReturnValueOnce({ id: 'plan-1', goal: 'Do the thing' });
      mockRunExecutionPhase.mockReturnValueOnce(
        (async function* () {
          yield {
            type: 'session',
            sessionId: 'live-1',
            resumeSessionId: 'native-exec-1',
            cwd: '/tmp/test',
          };
          yield { type: 'done' };
        })(),
      );

      const { agentRoutes } = await import('@/app/api/agent');
      const res = await agentRoutes.request(
        jsonReq('/execute', { planId: 'plan-1', taskId: 'task-exec-1' }),
      );
      expect(res.status).toBe(200);
      // Drain the SSE stream so the generator (and its session handler) runs.
      await res.text();

      expect(mockUpsertAgentResumeIdentity).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-exec-1',
          providerId: 'claude',
          nativeSessionId: 'native-exec-1',
        }),
      );
    });
  });

  // ---- POST /resume ----

  describe('POST /resume', () => {
    const resumeBody = {
      resumeSessionId: 'native-abc',
      prompt: 'Continue the work',
      taskId: 'task-resume-1',
    };
    const streamOnce = () =>
      (async function* () {
        yield { type: 'text', content: 'resumed' };
      })();

    it('natively resumes when no identity is stored for the task', async () => {
      mockRunAgent.mockClear();
      mockRunAgentResume.mockClear();
      mockGetAgentResumeIdentity.mockReturnValueOnce(null);
      mockRunAgentResume.mockReturnValueOnce(streamOnce());

      const { agentRoutes } = await import('@/app/api/agent');
      const res = await agentRoutes.request(jsonReq('/resume', resumeBody));

      expect(res.status).toBe(200);
      expect(mockRunAgentResume).toHaveBeenCalledWith(
        'native-abc',
        'Continue the work',
        expect.anything(),
        undefined,
        'task-resume-1',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );
      expect(mockRunAgent).not.toHaveBeenCalled();
    });

    it('natively resumes when the stored identity matches', async () => {
      mockRunAgent.mockClear();
      mockRunAgentResume.mockClear();
      mockGetAgentResumeIdentity.mockReturnValueOnce({
        taskId: 'task-resume-1',
        providerId: 'claude',
        workspaceRoot: '/tmp/test',
        nativeSessionId: 'native-abc',
        createdAt: '2026-07-06T00:00:00.000Z',
        lastSeenAt: '2026-07-06T00:00:00.000Z',
      });
      mockRunAgentResume.mockReturnValueOnce(streamOnce());

      const { agentRoutes } = await import('@/app/api/agent');
      const res = await agentRoutes.request(jsonReq('/resume', resumeBody));

      expect(res.status).toBe(200);
      expect(mockRunAgentResume).toHaveBeenCalled();
      expect(mockRunAgent).not.toHaveBeenCalled();
    });

    it('falls back to a fresh run on a provider mismatch', async () => {
      mockRunAgent.mockClear();
      mockRunAgentResume.mockClear();
      mockGetAgentResumeIdentity.mockReturnValueOnce({
        taskId: 'task-resume-1',
        providerId: 'codex',
        nativeSessionId: 'native-abc',
        createdAt: '2026-07-06T00:00:00.000Z',
        lastSeenAt: '2026-07-06T00:00:00.000Z',
      });
      mockRunAgent.mockReturnValueOnce(streamOnce());

      const { agentRoutes } = await import('@/app/api/agent');
      const res = await agentRoutes.request(jsonReq('/resume', resumeBody));

      expect(res.status).toBe(200);
      expect(mockRunAgent).toHaveBeenCalledWith(
        'Continue the work',
        expect.objectContaining({ taskId: 'task-resume-1' }),
      );
      expect(mockRunAgentResume).not.toHaveBeenCalled();
    });

    it('falls back to a fresh run when the stored session id is stale', async () => {
      mockRunAgent.mockClear();
      mockRunAgentResume.mockClear();
      mockGetAgentResumeIdentity.mockReturnValueOnce({
        taskId: 'task-resume-1',
        providerId: 'claude',
        nativeSessionId: 'native-newer',
        createdAt: '2026-07-06T00:00:00.000Z',
        lastSeenAt: '2026-07-06T00:00:00.000Z',
      });
      mockRunAgent.mockReturnValueOnce(streamOnce());

      const { agentRoutes } = await import('@/app/api/agent');
      const res = await agentRoutes.request(jsonReq('/resume', resumeBody));

      expect(res.status).toBe(200);
      expect(mockRunAgent).toHaveBeenCalled();
      expect(mockRunAgentResume).not.toHaveBeenCalled();
    });

    it('rolls over near the context limit and reseeds conversation history', async () => {
      mockRunAgent.mockClear();
      mockRunAgentResume.mockClear();
      mockGetAgentResumeIdentity.mockReturnValueOnce(null);
      mockRunAgent.mockReturnValueOnce(streamOnce());
      const conversation = [
        { role: 'user' as const, content: 'Earlier request' },
        { role: 'assistant' as const, content: 'Earlier answer' },
      ];

      const { agentRoutes } = await import('@/app/api/agent');
      const res = await agentRoutes.request(
        jsonReq('/resume', {
          ...resumeBody,
          modelConfig: { model: 'claude-opus-5' },
          contextTokensUsed: 900_000,
          conversation,
        }),
      );

      expect(res.status).toBe(200);
      expect(mockRunAgent).toHaveBeenCalledWith(
        'Continue the work',
        expect.objectContaining({ conversation }),
      );
      expect(mockRunAgentResume).not.toHaveBeenCalled();
    });
  });

  // ---- Agent questions ----

  describe('Agent questions', () => {
    it('creates a pending question', async () => {
      const { agentRoutes } = await import('@/app/api/agent');
      const res = await agentRoutes.request(
        jsonReq('/questions', {
          sessionId: 'session-1',
          questions: [{ question: 'Pick one' }],
        }),
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('question');
    });

    it('requires a filter when listing pending questions', async () => {
      const { agentRoutes } = await import('@/app/api/agent');
      const res = await agentRoutes.request('/questions/pending');
      expect(res.status).toBe(400);
    });
  });

  // ---- GET /queue/status ----

  describe('GET /queue/status', () => {
    it('returns global stats when no profileId', async () => {
      const { agentRoutes } = await import('@/app/api/agent');
      const res = await agentRoutes.request('/queue/status');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('success', true);
      expect(body).toHaveProperty('data');
    });

    it('returns profile-specific stats with profileId', async () => {
      const { agentRoutes } = await import('@/app/api/agent');
      const res = await agentRoutes.request('/queue/status?profileId=prof-1');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('success', true);
    });
  });

  // ---- GET /queue/can-accept ----

  describe('GET /queue/can-accept', () => {
    it('returns canAccept boolean', async () => {
      const { agentRoutes } = await import('@/app/api/agent');
      const res = await agentRoutes.request('/queue/can-accept');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('success', true);
      expect(body).toHaveProperty('canAccept', true);
    });

    it('returns false when queue is full', async () => {
      mockCanAcceptTask.mockReturnValueOnce(false);
      const { agentRoutes } = await import('@/app/api/agent');
      const res = await agentRoutes.request(
        '/queue/can-accept?profileId=prof-busy',
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('canAccept', false);
    });
  });

  // ---- GET /subscribe/:taskId ----

  describe('GET /subscribe/:taskId', () => {
    it('returns SSE stream headers', async () => {
      const { agentRoutes } = await import('@/app/api/agent');
      const res = await agentRoutes.request('/subscribe/task-123');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
    });

    it('replays buffered events after the requested cursor', async () => {
      const { taskEventBus } = await import('@/shared/services/task-event-bus');
      vi.mocked(taskEventBus.getSeqBounds).mockReturnValueOnce({
        minSeq: 0,
        maxSeq: 3,
      });

      const { agentRoutes } = await import('@/app/api/agent');
      const res = await agentRoutes.request('/subscribe/task-123?from=1');

      expect(res.status).toBe(200);
      expect(taskEventBus.subscribe).toHaveBeenCalledWith(
        'task-123',
        expect.any(Function),
        { afterSeq: 1 },
      );
    });
  });

  // ---- POST /generate-title ----

  describe('POST /generate-title', () => {
    it('returns generated title', async () => {
      mockGenerateTitle.mockResolvedValueOnce('My Todo App');

      const { agentRoutes } = await import('@/app/api/agent');
      const res = await agentRoutes.request(
        jsonReq('/generate-title', { userPrompt: 'Build a todo app' }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('title', 'My Todo App');
    });

    it('rejects empty userPrompt', async () => {
      const { agentRoutes } = await import('@/app/api/agent');
      const res = await agentRoutes.request(
        jsonReq('/generate-title', { userPrompt: '' }),
      );
      expect(res.status).toBe(400);
    });
  });

  // ---- POST /stop/:sessionId ----

  describe('POST /stop/:sessionId', () => {
    it('returns 404 for unknown session', async () => {
      mockGetSession.mockReturnValueOnce(undefined);

      const { agentRoutes } = await import('@/app/api/agent');
      const res = await agentRoutes.request(
        jsonReq('/stop/session-unknown', undefined, 'POST'),
      );
      expect(res.status).toBe(404);
    });

    it('stops an existing session', async () => {
      mockGetSession.mockReturnValueOnce({
        id: 'session-abc',
        isAborted: false,
      });

      const { agentRoutes } = await import('@/app/api/agent');
      const res = await agentRoutes.request(
        jsonReq('/stop/session-abc', undefined, 'POST'),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('status', 'stopped');
    });
  });

  // ---- POST /permission ----

  describe('POST /permission', () => {
    it('resolves permission request', async () => {
      const { agentRoutes } = await import('@/app/api/agent');
      const res = await agentRoutes.request(
        jsonReq('/permission', {
          permissionId: 'perm-123',
          approved: true,
        }),
      );
      expect(res.status).toBe(200);
    });

    it('rejects missing permissionId', async () => {
      const { agentRoutes } = await import('@/app/api/agent');
      const res = await agentRoutes.request(
        jsonReq('/permission', { approved: true }),
      );
      expect(res.status).toBe(400);
    });
  });

  // ---- GET /session/:sessionId ----

  describe('GET /session/:sessionId', () => {
    it('returns 404 for unknown session', async () => {
      mockGetSession.mockReturnValueOnce(undefined);

      const { agentRoutes } = await import('@/app/api/agent');
      const res = await agentRoutes.request('/session/session-unknown');
      expect(res.status).toBe(404);
    });

    it('returns session details when found', async () => {
      mockGetSession.mockReturnValueOnce({
        id: 'session-xyz',
        createdAt: '2026-04-06',
        phase: 'planning',
        abortController: { signal: { aborted: false } },
      });

      const { agentRoutes } = await import('@/app/api/agent');
      const res = await agentRoutes.request('/session/session-xyz');
      // Route may return the session or format it — check 200 OK
      expect(res.status).toBe(200);
    });
  });

  // ---- GET /plan/:planId ----

  describe('GET /plan/:planId', () => {
    it('returns 404 for expired plan', async () => {
      mockGetPlan.mockReturnValueOnce(undefined);

      const { agentRoutes } = await import('@/app/api/agent');
      const res = await agentRoutes.request('/plan/plan-expired');
      expect(res.status).toBe(404);
    });

    it('returns plan object', async () => {
      mockGetPlan.mockReturnValueOnce({
        id: 'plan-abc',
        steps: ['step1', 'step2'],
      });

      const { agentRoutes } = await import('@/app/api/agent');
      const res = await agentRoutes.request('/plan/plan-abc');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('id', 'plan-abc');
    });
  });
});
