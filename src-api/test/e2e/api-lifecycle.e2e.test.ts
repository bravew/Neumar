import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getJson, postJson } from '../helpers/http-client';
import {
  spawnApiInstance,
  stopApiInstance,
  type ApiInstance,
} from '../helpers/spawn-api';

describe('API Lifecycle E2E', () => {
  let api: ApiInstance;

  beforeAll(async () => {
    api = await spawnApiInstance('lifecycle');
  });

  afterAll(async () => {
    await stopApiInstance(api);
  });

  it('health endpoint returns ok', async () => {
    const { status, json } = await getJson(api.baseUrl, '/health');
    expect(status).toBe(200);
    expect(json).toHaveProperty('status', 'ok');
  });

  it('health endpoint includes uptime', async () => {
    const { status, json } = await getJson(api.baseUrl, '/health');
    expect(status).toBe(200);
    const body = json as Record<string, unknown>;
    expect(typeof body.uptime).toBe('number');
    expect(body.uptime as number).toBeGreaterThanOrEqual(0);
  });

  it('lists agent providers', async () => {
    const { status, json } = await getJson(api.baseUrl, '/providers/agents');
    expect(status).toBe(200);
    expect(json).toHaveProperty('providers');
  });

  it('lists sandbox providers', async () => {
    const { status, json } = await getJson(api.baseUrl, '/providers/sandbox');
    expect(status).toBe(200);
    expect(json).toHaveProperty('providers');
  });

  it('rejects invalid agent plan request', async () => {
    const { status } = await postJson(api.baseUrl, '/agent/plan', {});
    expect(status).toBeGreaterThanOrEqual(400);
  });

  it('handles concurrent health requests', async () => {
    const results = await Promise.all([
      getJson(api.baseUrl, '/health'),
      getJson(api.baseUrl, '/health'),
      getJson(api.baseUrl, '/health'),
    ]);
    for (const r of results) {
      expect(r.status).toBe(200);
    }
  });

  it('returns 404 for unknown routes', async () => {
    const { status } = await getJson(api.baseUrl, '/does-not-exist');
    expect(status).toBe(404);
  });
});
