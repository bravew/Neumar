import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const importBackupMock = vi.fn();

vi.mock('@/shared/services/backup-import', async () => {
  const actual = await vi.importActual<
    typeof import('@/shared/services/backup-import')
  >('@/shared/services/backup-import');
  return {
    ...actual,
    importBackup: (payload: unknown) => importBackupMock(payload),
  };
});

// Stub other heavy imports pulled in by db.ts
vi.mock('@/shared/db/operations', () => ({}));
vi.mock('@/shared/services/active-query-store', () => ({
  activeQueryStore: { getSessionId: vi.fn() },
}));
vi.mock('@/shared/services/agent', () => ({
  deleteSession: vi.fn(),
}));
vi.mock('@/shared/services/task-event-bus', () => ({
  taskEventBus: { publish: vi.fn() },
}));

const validBackup = {
  version: 1,
  exportedAt: new Date().toISOString(),
  sessions: [{ id: 's-1', prompt: 'hi' }],
  tasks: [{ id: 't-1', session_id: 's-1', prompt: 'do' }],
  messages: [],
  files: [],
};

describe('POST /db/import-backup', () => {
  beforeEach(() => {
    importBackupMock.mockReset();
  });

  async function loadRoutes() {
    const mod = await import('@/app/api/db');
    return mod.dbRoutes;
  }

  function makeReq(body: unknown) {
    return new Request('http://localhost/import-backup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Host: 'localhost',
      },
      body: JSON.stringify(body),
    });
  }

  it('forwards payload to importBackup and returns success', async () => {
    importBackupMock.mockReturnValue({
      success: true,
      sessions: { inserted: 1, updated: 0, skipped: 0, failed: 0 },
      tasks: { inserted: 1, updated: 0, skipped: 0, failed: 0 },
      messages: { inserted: 0, updated: 0, skipped: 0, failed: 0 },
      files: { inserted: 0, updated: 0, skipped: 0, failed: 0 },
      settings: { inserted: 0, updated: 0, skipped: 0, failed: 0 },
    });

    const routes = await loadRoutes();
    const res = await routes.request(makeReq(validBackup));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(importBackupMock).toHaveBeenCalledTimes(1);
    const arg = importBackupMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.version).toBe(1);
    expect(Array.isArray(arg.tasks)).toBe(true);
  });

  it('returns 400 when importBackup reports failure', async () => {
    importBackupMock.mockReturnValue({
      success: false,
      sessions: { inserted: 0, updated: 0, skipped: 0, failed: 0 },
      tasks: { inserted: 0, updated: 0, skipped: 0, failed: 0 },
      messages: { inserted: 0, updated: 0, skipped: 0, failed: 0 },
      files: { inserted: 0, updated: 0, skipped: 0, failed: 0 },
      settings: { inserted: 0, updated: 0, skipped: 0, failed: 0 },
      error: 'version: missing',
    });

    const routes = await loadRoutes();
    const res = await routes.request(makeReq({ broken: true }));
    expect(res.status).toBe(400);
  });

  it('rejects non-localhost host', async () => {
    const routes = await loadRoutes();
    const req = new Request('http://example.com/import-backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Host: 'example.com' },
      body: JSON.stringify(validBackup),
    });
    const res = await routes.request(req);
    expect(res.status).toBe(403);
  });
});
