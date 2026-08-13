import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const undiciMocks = vi.hoisted(() => ({
  agent: vi.fn(function EnvHttpProxyAgentMock() {
    return { kind: 'env-proxy-agent' };
  }),
  setGlobalDispatcher: vi.fn(),
}));

vi.mock('undici', () => ({
  EnvHttpProxyAgent: undiciMocks.agent,
  setGlobalDispatcher: undiciMocks.setGlobalDispatcher,
}));

const PROXY_ENV_KEYS = [
  'http_proxy',
  'https_proxy',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'no_proxy',
  'NO_PROXY',
] as const;

describe('proxy dispatcher', () => {
  const originalEnv = new Map<string, string | undefined>();

  beforeEach(() => {
    vi.resetModules();
    undiciMocks.agent.mockClear();
    undiciMocks.setGlobalDispatcher.mockClear();
    for (const key of PROXY_ENV_KEYS) {
      originalEnv.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of PROXY_ENV_KEYS) {
      const value = originalEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    originalEnv.clear();
  });

  it('does not install a dispatcher when no proxy environment is set', async () => {
    const { configureGlobalFetchProxyFromEnv, hasFetchProxyEnv } =
      await import('@/shared/http/proxy-dispatcher');

    expect(hasFetchProxyEnv()).toBe(false);
    expect(configureGlobalFetchProxyFromEnv()).toBe(false);
    expect(undiciMocks.agent).not.toHaveBeenCalled();
    expect(undiciMocks.setGlobalDispatcher).not.toHaveBeenCalled();
  });

  it('installs EnvHttpProxyAgent when HTTP proxy environment is set', async () => {
    process.env.HTTPS_PROXY = 'http://proxy.example:8080';

    const { configureGlobalFetchProxyFromEnv, hasFetchProxyEnv } =
      await import('@/shared/http/proxy-dispatcher');

    expect(hasFetchProxyEnv()).toBe(true);
    expect(configureGlobalFetchProxyFromEnv()).toBe(true);
    expect(undiciMocks.agent).toHaveBeenCalledTimes(1);
    expect(undiciMocks.setGlobalDispatcher).toHaveBeenCalledWith({
      kind: 'env-proxy-agent',
    });
  });
});
