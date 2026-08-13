import { describe, expect, it, vi } from 'vitest';

import { jsonReq } from '../../helpers/request-factory';

// ---- Mock the automation engine ----

const mockAutomation = {
  id: 'auto-1',
  name: 'Test Automation',
  enabled: true,
  trigger: { type: 'manual' },
  prompt: 'Do something',
  agent: { model: 'claude-3-5-sonnet-20241022' },
  createdAt: '2026-04-06T00:00:00Z',
  runCount: 0,
  totalCost: 0,
};

const mockRun = {
  id: 'run-1',
  automationId: 'auto-1',
  status: 'completed',
  triggeredBy: 'manual',
  queuedAt: '2026-04-06T00:00:00Z',
  result: 'Done',
};

const mockEngine = {
  create: vi.fn().mockResolvedValue(mockAutomation),
  get: vi.fn().mockReturnValue(mockAutomation),
  list: vi.fn().mockReturnValue([mockAutomation]),
  update: vi.fn().mockResolvedValue({ ...mockAutomation, name: 'Updated' }),
  remove: vi.fn().mockResolvedValue(undefined),
  toggle: vi.fn().mockResolvedValue({ ...mockAutomation, enabled: false }),
  enqueue: vi.fn().mockResolvedValue(mockRun),
  cancel: vi.fn().mockResolvedValue(undefined),
  getRun: vi.fn().mockReturnValue(mockRun),
  getRuns: vi.fn().mockReturnValue([mockRun]),
  getActiveRuns: vi.fn().mockReturnValue([]),
  getStatus: vi.fn().mockReturnValue({
    started: true,
    activeRunCount: 0,
    queuedCount: 0,
    automationCount: 1,
  }),
  handleWebhookRequest: vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    }),
  ),
};

vi.mock('@/shared/automation/engine', () => mockEngine);

vi.mock('@/shared/automation/hooks', () => ({
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('@/shared/automation/templates', () => ({
  getTemplates: vi.fn().mockReturnValue([
    { id: 'tpl-1', name: 'Weekly Report', category: 'reporting' },
    { id: 'tpl-2', name: 'Daily Standup', category: 'workflow' },
  ]),
  getTemplate: vi
    .fn()
    .mockImplementation((id: string) =>
      id === 'tpl-1'
        ? { id: 'tpl-1', name: 'Weekly Report', category: 'reporting' }
        : undefined,
    ),
}));

vi.mock('@/shared/db/operations', () => ({
  enqueueTask: vi
    .fn()
    .mockReturnValue({ taskId: 'task-1', profileId: 'prof-1' }),
  getQueueStats: vi.fn().mockReturnValue({ queued: 0, running: 0 }),
}));

vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('Automation API', () => {
  // ---- GET /status ----

  describe('GET /status', () => {
    it('returns engine status', async () => {
      const { automationRoutes } = await import('@/app/api/automation');
      const res = await automationRoutes.request('/status');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('success', true);
      const data = body.data as Record<string, unknown>;
      expect(data).toHaveProperty('started', true);
      expect(data).toHaveProperty('automationCount', 1);
    });
  });

  // ---- LIST / CREATE / GET / UPDATE / DELETE ----

  describe('GET / (list automations)', () => {
    it('returns array of automations', async () => {
      const { automationRoutes } = await import('@/app/api/automation');
      const res = await automationRoutes.request('/');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('success', true);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  describe('POST / (create automation)', () => {
    it('creates automation with valid body', async () => {
      const { automationRoutes } = await import('@/app/api/automation');
      const res = await automationRoutes.request(
        jsonReq('/', {
          name: 'New Auto',
          prompt: 'Do something useful',
          trigger: { type: 'manual' },
          agent: {
            model: 'claude-3-5-sonnet-20241022',
            usePlanning: false,
            autoApprove: true,
          },
        }),
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('success', true);
    });

    it('rejects missing name', async () => {
      const { automationRoutes } = await import('@/app/api/automation');
      const res = await automationRoutes.request(
        jsonReq('/', {
          prompt: 'Do something',
          trigger: { type: 'manual' },
          agent: {},
        }),
      );
      expect(res.status).toBe(400);
    });

    it('rejects empty prompt', async () => {
      const { automationRoutes } = await import('@/app/api/automation');
      const res = await automationRoutes.request(
        jsonReq('/', {
          name: 'Test',
          prompt: '',
          trigger: { type: 'manual' },
          agent: {},
        }),
      );
      expect(res.status).toBe(400);
    });
  });

  describe('GET /:id', () => {
    it('returns automation by ID', async () => {
      const { automationRoutes } = await import('@/app/api/automation');
      const res = await automationRoutes.request('/auto-1');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('success', true);
      const data = body.data as Record<string, unknown>;
      expect(data).toHaveProperty('id', 'auto-1');
    });

    it('returns 404 for non-existent automation', async () => {
      mockEngine.get.mockReturnValueOnce(undefined);
      const { automationRoutes } = await import('@/app/api/automation');
      const res = await automationRoutes.request('/auto-nonexistent');
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /:id', () => {
    it('updates automation', async () => {
      const { automationRoutes } = await import('@/app/api/automation');
      const res = await automationRoutes.request(
        jsonReq('/auto-1', { name: 'Updated Name' }, 'PUT'),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('success', true);
    });

    it('returns 400 when engine rejects update', async () => {
      mockEngine.update.mockRejectedValueOnce(new Error('Not found'));
      const { automationRoutes } = await import('@/app/api/automation');
      const res = await automationRoutes.request(
        jsonReq('/auto-bad', { name: 'X' }, 'PUT'),
      );
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /:id', () => {
    it('deletes automation', async () => {
      const { automationRoutes } = await import('@/app/api/automation');
      const res = await automationRoutes.request(
        new Request('http://localhost/auto-1', { method: 'DELETE' }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('success', true);
    });

    it('returns 400 when engine rejects delete', async () => {
      mockEngine.remove.mockRejectedValueOnce(new Error('Not found'));
      const { automationRoutes } = await import('@/app/api/automation');
      const res = await automationRoutes.request(
        new Request('http://localhost/auto-bad', { method: 'DELETE' }),
      );
      expect(res.status).toBe(400);
    });
  });

  // ---- TOGGLE ----

  describe('PATCH /:id/toggle', () => {
    it('toggles automation state', async () => {
      const { automationRoutes } = await import('@/app/api/automation');
      const res = await automationRoutes.request(
        jsonReq('/auto-1/toggle', { enabled: false }, 'PATCH'),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('success', true);
      const data = body.data as Record<string, unknown>;
      expect(data).toHaveProperty('enabled', false);
    });

    it('rejects missing enabled field', async () => {
      const { automationRoutes } = await import('@/app/api/automation');
      const res = await automationRoutes.request(
        jsonReq('/auto-1/toggle', {}, 'PATCH'),
      );
      expect(res.status).toBe(400);
    });
  });

  // ---- RUN (manual trigger) ----

  describe('POST /:id/run', () => {
    it('triggers manual run on enabled automation', async () => {
      const { automationRoutes } = await import('@/app/api/automation');
      const res = await automationRoutes.request(jsonReq('/auto-1/run', null));
      expect(res.status).toBe(202);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('success', true);
    });

    it('returns 400 when engine rejects run', async () => {
      mockEngine.enqueue.mockImplementationOnce(() => {
        throw new Error('Automation is disabled');
      });
      const { automationRoutes } = await import('@/app/api/automation');
      const res = await automationRoutes.request(
        jsonReq('/auto-disabled/run', null),
      );
      expect(res.status).toBe(400);
    });
  });

  // ---- RUN HISTORY ----

  describe('GET /:id/runs', () => {
    it('returns run history for automation', async () => {
      const { automationRoutes } = await import('@/app/api/automation');
      const res = await automationRoutes.request('/auto-1/runs');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('success', true);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  // ---- ACTIVE RUNS ----

  describe('GET /runs/active', () => {
    it('returns active runs', async () => {
      const { automationRoutes } = await import('@/app/api/automation');
      const res = await automationRoutes.request('/runs/active');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('success', true);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  // ---- GET/CANCEL RUN ----

  describe('GET /runs/:runId', () => {
    it('returns run by ID', async () => {
      const { automationRoutes } = await import('@/app/api/automation');
      const res = await automationRoutes.request('/runs/run-1');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      const data = body.data as Record<string, unknown>;
      expect(data).toHaveProperty('id', 'run-1');
    });

    it('returns 404 for non-existent run', async () => {
      mockEngine.getRun.mockReturnValueOnce(undefined);
      const { automationRoutes } = await import('@/app/api/automation');
      const res = await automationRoutes.request('/runs/run-nope');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /runs/:runId/cancel', () => {
    it('cancels run', async () => {
      const { automationRoutes } = await import('@/app/api/automation');
      const res = await automationRoutes.request(
        jsonReq('/runs/run-1/cancel', null),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('success', true);
    });

    it('returns 400 when cancel fails', async () => {
      mockEngine.cancel.mockRejectedValueOnce(new Error('Not found'));
      const { automationRoutes } = await import('@/app/api/automation');
      const res = await automationRoutes.request(
        jsonReq('/runs/run-bad/cancel', null),
      );
      expect(res.status).toBe(400);
    });
  });

  // ---- TEMPLATES ----

  describe('GET /templates', () => {
    it('returns template list', async () => {
      const { automationRoutes } = await import('@/app/api/automation');
      const res = await automationRoutes.request('/templates');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('success', true);
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  describe('GET /templates/:templateId', () => {
    it('returns template by ID', async () => {
      const { automationRoutes } = await import('@/app/api/automation');
      const res = await automationRoutes.request('/templates/tpl-1');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('success', true);
    });

    it('returns 404 for unknown template', async () => {
      const { automationRoutes } = await import('@/app/api/automation');
      const res = await automationRoutes.request('/templates/tpl-unknown');
      expect(res.status).toBe(404);
    });
  });

  // ---- QUEUE ----

  describe('GET /queue/status', () => {
    it('returns queue stats', async () => {
      const { automationRoutes } = await import('@/app/api/automation');
      const res = await automationRoutes.request('/queue/status');
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('success', true);
    });
  });

  describe('POST /queue/enqueue', () => {
    it('enqueues task with valid body', async () => {
      const { automationRoutes } = await import('@/app/api/automation');
      const res = await automationRoutes.request(
        jsonReq('/queue/enqueue', {
          taskId: 'task-1',
          profileId: 'prof-1',
        }),
      );
      expect([200, 202]).toContain(res.status);
    });

    it('rejects missing taskId', async () => {
      const { automationRoutes } = await import('@/app/api/automation');
      const res = await automationRoutes.request(
        jsonReq('/queue/enqueue', { profileId: 'prof-1' }),
      );
      expect(res.status).toBe(400);
    });
  });

  // ---- WEBHOOK ----

  describe('POST /hooks/:slug', () => {
    it('delegates to engine webhook handler', async () => {
      const { automationRoutes } = await import('@/app/api/automation');
      const res = await automationRoutes.request(
        jsonReq('/hooks/my-webhook', { event: 'triggered' }),
      );
      expect(res.status).toBe(200);
    });
  });

  // ---- SSE EVENTS ----

  describe('GET /events', () => {
    it('returns SSE stream headers', async () => {
      const { automationRoutes } = await import('@/app/api/automation');
      const res = await automationRoutes.request('/events');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
    });
  });
});
