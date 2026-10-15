import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sandboxRoutes } from '@/app/api/sandbox';
import { jwtMiddleware } from '@/app/middleware/jwt';

const execution = vi.hoisted(() => ({ exec: vi.fn(), runScript: vi.fn() }));
vi.mock('@/core/sandbox/index', () => {
  const provider = {
    type: 'native',
    name: 'Native',
    isAvailable: async () => true,
    getCapabilities: () => ({ isolation: 'none' }),
    ...execution,
  };
  return {
    initSandbox: async () => {},
    getSandboxProvider: async () => provider,
    getBestProvider: async () => provider,
    SANDBOX_IMAGES: { node: 'node' },
    getSandboxInfo: vi.fn(),
    stopAllSandboxProviders: vi.fn(),
  };
});

function app() {
  const app = new Hono();
  app.use('*', jwtMiddleware);
  app.route('/sandbox', sandboxRoutes);
  for (const path of [
    '/files',
    '/health',
    '/health-extra',
    '/auth/jwt/login',
    '/auth/jwt-extra',
  ]) {
    app.get(path, (c) => c.json({ ok: true }));
  }
  app.post('/auth/jwt/setup', (c) => c.json({ ok: true }));
  return app;
}

const secret = 'isolated-daemon-auth-test-signing-secret';
async function token() {
  return sign(
    { sub: 'local', exp: Math.floor(Date.now() / 1000) + 60 },
    secret,
    'HS256',
  );
}

describe('daemon route authorization', () => {
  beforeEach(() => {
    vi.stubEnv('WEBUI_AUTH', 'false');
    vi.stubEnv('NEUMAR_REMOTE', 'false');
    vi.stubEnv('WEBUI_JWT_SECRET', secret);
    execution.exec.mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: '',
      duration: 0,
    });
  });
  afterEach(() => vi.clearAllMocks());

  it.each(['/exec', '/exec/stream', '/run/file', '/run/node'])(
    'requires authentication for sandbox %s independently of WebUI mode',
    async (path) => {
      const response = await app().request(`/sandbox${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: 'unused',
          provider: 'native',
          script: 'unused',
          filePath: 'unused',
          workDir: 'unused',
        }),
      });
      expect(response.status).toBe(401);
      expect(execution.exec).not.toHaveBeenCalled();
      expect(execution.runScript).not.toHaveBeenCalled();
    },
  );

  it('accepts an authenticated native execution request', async () => {
    const response = await app().request('/sandbox/exec', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await token()}`,
      },
      body: JSON.stringify({ command: 'unused', provider: 'native' }),
    });
    expect(response.status).toBe(200);
    expect(execution.exec).toHaveBeenCalledOnce();
  });

  it('preserves unauthenticated ordinary local desktop routes', async () => {
    expect((await app().request('/files')).status).toBe(200);
  });

  it.each(['NEUMAR_REMOTE', 'WEBUI_AUTH'])(
    'enforces JWT in %s mode with exact public route boundaries',
    async (mode) => {
      vi.stubEnv(mode, 'true');
      for (const path of ['/files', '/health-extra', '/auth/jwt-extra']) {
        expect((await app().request(path)).status).toBe(401);
        expect(
          (
            await app().request(path, {
              headers: { Authorization: `Bearer ${await token()}` },
            })
          ).status,
        ).toBe(200);
      }
      expect((await app().request('/health')).status).toBe(200);
      expect(
        (
          await app().request('/files', {
            headers: { Authorization: 'Bearer invalid' },
          })
        ).status,
      ).toBe(401);
    },
  );

  it('blocks unauthenticated remote password setup', async () => {
    vi.stubEnv('NEUMAR_REMOTE', 'true');
    expect(
      (await app().request('/auth/jwt/setup', { method: 'POST' })).status,
    ).toBe(401);
  });
});
