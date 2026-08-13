import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { jsonReq } from '../../helpers/request-factory';

vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const insertFeedbackMock = vi.fn();
const listFeedbackMock = vi.fn();
const listUnsyncedFeedbackMock = vi.fn();
const markForwardedMock = vi.fn();
const markFailedMock = vi.fn();
const setLinearIdMock = vi.fn();

vi.mock('@/shared/services/feedback-store', () => ({
  insertFeedback: (...args: unknown[]) => insertFeedbackMock(...args),
  listFeedback: (...args: unknown[]) => listFeedbackMock(...args),
  listUnsyncedFeedback: (...args: unknown[]) =>
    listUnsyncedFeedbackMock(...args),
  markFeedbackForwarded: (...args: unknown[]) => markForwardedMock(...args),
  markFeedbackForwardFailed: (...args: unknown[]) => markFailedMock(...args),
  setFeedbackLinearId: (...args: unknown[]) => setLinearIdMock(...args),
}));

const collectDiagnosticsMock = vi
  .fn()
  .mockReturnValue({ os: { platform: 'linux' } });

vi.mock('@/shared/services/feedback-diagnostics', () => ({
  collectFeedbackDiagnostics: (...args: unknown[]) =>
    collectDiagnosticsMock(...args),
}));

const forwardFeedbackMock = vi.fn();
const isRemoteEnabledMock = vi.fn().mockReturnValue(false);

vi.mock('@/shared/services/feedback-forwarder', () => ({
  forwardFeedback: (...args: unknown[]) => forwardFeedbackMock(...args),
  isRemoteForwardingEnabled: () => isRemoteEnabledMock(),
}));

const createIssueMock = vi.fn();
const getLinearClientMock = vi.fn();

vi.mock('@/shared/services/linear', () => ({
  createIssue: (...args: unknown[]) => createIssueMock(...args),
  getLinearClient: () => getLinearClientMock(),
}));

async function loadRoutes() {
  const mod = await import('@/app/api/feedback');
  mod._resetFeedbackRateLimitForTests();
  return mod.feedbackRoutes;
}

const validBody = {
  category: 'bug',
  subject: 'Test crash',
  description: 'It crashed when I clicked the button',
  email: 'user@example.com',
  appName: 'neumar',
  appVersion: '0.1.0',
};

const fakeRow = {
  id: 'fb-1',
  category: 'bug',
  subject: 'Test crash',
  description: 'It crashed when I clicked the button',
  email: 'user@example.com',
  app_name: 'neumar',
  app_version: '0.1.0',
  diagnostics_json: null,
  linear_id: null,
  remote_status: 'pending',
  sync_attempts: 0,
  last_sync_error: null,
  created_at: new Date().toISOString(),
  synced_at: null,
};

describe('Feedback API', () => {
  beforeEach(() => {
    insertFeedbackMock.mockReset().mockReturnValue(fakeRow);
    listFeedbackMock.mockReset();
    listUnsyncedFeedbackMock.mockReset().mockReturnValue([]);
    markForwardedMock.mockReset();
    markFailedMock.mockReset();
    setLinearIdMock.mockReset();
    forwardFeedbackMock.mockReset();
    isRemoteEnabledMock.mockReset().mockReturnValue(false);
    createIssueMock.mockReset();
    getLinearClientMock.mockReset();
    collectDiagnosticsMock
      .mockReset()
      .mockReturnValue({ os: { platform: 'linux' } });
    delete process.env['LINEAR_FEEDBACK_TEAM_ID'];
  });

  afterEach(() => {
    delete process.env['LINEAR_FEEDBACK_TEAM_ID'];
  });

  it('persists feedback locally when Linear is disabled', async () => {
    const routes = await loadRoutes();
    const res = await routes.request(jsonReq('/', validBody));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.id).toBe('fb-1');
    expect(insertFeedbackMock).toHaveBeenCalledTimes(1);
    expect(createIssueMock).not.toHaveBeenCalled();
  });

  it('persists locally even when Linear throws', async () => {
    process.env['LINEAR_FEEDBACK_TEAM_ID'] = 'team-1';
    getLinearClientMock.mockReturnValue({});
    createIssueMock.mockRejectedValue(new Error('linear down'));

    const routes = await loadRoutes();
    const res = await routes.request(jsonReq('/', validBody));
    expect(res.status).toBe(200);
    expect(insertFeedbackMock).toHaveBeenCalledTimes(1);
    expect(setLinearIdMock).not.toHaveBeenCalled();
  });

  it('attaches diagnostics for bug category', async () => {
    const routes = await loadRoutes();
    await routes.request(jsonReq('/', validBody));
    expect(collectDiagnosticsMock).toHaveBeenCalled();
    const insertArg = insertFeedbackMock.mock.calls[0]![0];
    expect(insertArg.diagnostics).toEqual({ os: { platform: 'linux' } });
  });

  it('does not collect diagnostics for non-bug categories', async () => {
    const routes = await loadRoutes();
    await routes.request(jsonReq('/', { ...validBody, category: 'feature' }));
    expect(collectDiagnosticsMock).not.toHaveBeenCalled();
  });

  it('rate-limits the 11th request in an hour', async () => {
    const routes = await loadRoutes();
    const headers = { 'x-neuma-session-id': 'session-A' };
    for (let i = 0; i < 10; i++) {
      const r = await routes.request(
        new Request('http://localhost/', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(validBody),
        }),
      );
      expect(r.status).toBe(200);
    }
    const res = await routes.request(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody),
      }),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
  });

  it('GET paginates and filters by category', async () => {
    listFeedbackMock.mockReturnValue({
      items: [fakeRow],
      total: 1,
      page: 2,
      limit: 10,
    });
    const routes = await loadRoutes();
    const res = await routes.request('/?page=2&limit=10&category=bug');
    expect(res.status).toBe(200);
    expect(listFeedbackMock).toHaveBeenCalledWith({
      page: 2,
      limit: 10,
      category: 'bug',
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.items).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  it('flush retries queued rows and records failures', async () => {
    isRemoteEnabledMock.mockReturnValue(true);
    listUnsyncedFeedbackMock.mockReturnValue([
      fakeRow,
      { ...fakeRow, id: 'fb-2' },
    ]);
    forwardFeedbackMock
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, error: 'boom' });

    const routes = await loadRoutes();
    const res = await routes.request(
      new Request('http://localhost/flush', { method: 'POST' }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.attempted).toBe(2);
    expect(body.forwarded).toBe(1);
    expect(body.failed).toBe(1);
    expect(markForwardedMock).toHaveBeenCalledWith('fb-1', 'forwarded');
    expect(markFailedMock).toHaveBeenCalledWith('fb-2', 'boom');
  });
});
