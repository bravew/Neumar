import { randomUUID } from 'crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  deleteJson,
  expect4xx,
  getJson,
  postJson,
  putJson,
} from '../helpers/http-client';
import {
  spawnApiInstance,
  stopApiInstance,
  type ApiInstance,
} from '../helpers/spawn-api';

describe('Budget Policy CRUD E2E', () => {
  let api: ApiInstance;
  const policyId = `e2e-policy-${randomUUID()}`;

  beforeAll(async () => {
    api = await spawnApiInstance('budget-policies');
  }, 60_000);

  afterAll(async () => {
    await stopApiInstance(api);
  });

  it('GET /budget/policies returns a policies array', async () => {
    const { status, json } = await getJson(api.baseUrl, '/budget/policies');
    expect(status).toBe(200);
    const body = json as { policies: unknown[] };
    expect(Array.isArray(body.policies)).toBe(true);
  });

  it('GET /budget/status returns items', async () => {
    const { status, json } = await getJson(api.baseUrl, '/budget/status');
    expect(status).toBe(200);
    const body = json as { items: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('POST /budget/policies creates a policy (201)', async () => {
    const { status, json } = await postJson(api.baseUrl, '/budget/policies', {
      id: policyId,
      name: 'E2E test policy',
      scope_type: 'global',
      period_type: 'monthly',
      limit_usd: 10,
      alert_threshold_pct: 80,
      hard_stop: true,
    });
    expect(status).toBe(201);
    const body = json as { policy: { id: string; limit_usd: number } };
    expect(body.policy.id).toBe(policyId);
    expect(Number(body.policy.limit_usd)).toBe(10);
  });

  it('POST /budget/policies rejects negative limit_usd', async () => {
    const { status } = await postJson(api.baseUrl, '/budget/policies', {
      id: `bad-${randomUUID()}`,
      scope_type: 'global',
      limit_usd: -5,
    });
    expect4xx(status);
  });

  it('POST /budget/policies rejects bad scope_type', async () => {
    const { status } = await postJson(api.baseUrl, '/budget/policies', {
      id: `bad-scope-${randomUUID()}`,
      scope_type: 'not-a-scope',
      limit_usd: 5,
    });
    expect4xx(status);
  });

  it('GET /budget/policies includes the created policy', async () => {
    const { json } = await getJson(api.baseUrl, '/budget/policies');
    const body = json as { policies: Array<{ id: string }> };
    expect(body.policies.some((p) => p.id === policyId)).toBe(true);
  });

  it('PUT /budget/policies/:id updates the policy', async () => {
    const { status, json } = await putJson(
      api.baseUrl,
      `/budget/policies/${policyId}`,
      { limit_usd: 25, hard_stop: false },
    );
    expect(status).toBe(200);
    const body = json as { policy: { limit_usd: number } };
    expect(Number(body.policy.limit_usd)).toBe(25);
  });

  it('PUT /budget/policies/:id returns 404 for unknown id', async () => {
    const { status } = await putJson(
      api.baseUrl,
      '/budget/policies/no-such-id',
      { limit_usd: 1 },
    );
    expect(status).toBe(404);
  });

  it('GET /budget/preflight runs against the live policy', async () => {
    const { status, json } = await getJson(
      api.baseUrl,
      '/budget/preflight?scope_type=global',
    );
    expect(status).toBe(200);
    expect(json).toBeTruthy();
  });

  it('GET /budget/preflight rejects bad scope_type', async () => {
    const { status } = await getJson(
      api.baseUrl,
      '/budget/preflight?scope_type=bogus',
    );
    expect4xx(status);
  });

  it('DELETE /budget/policies/:id removes the policy', async () => {
    const { status } = await deleteJson(
      api.baseUrl,
      `/budget/policies/${policyId}`,
    );
    expect(status).toBe(200);
  });

  it('DELETE /budget/policies/:id returns 404 if already gone', async () => {
    const { status } = await deleteJson(
      api.baseUrl,
      `/budget/policies/${policyId}`,
    );
    expect(status).toBe(404);
  });
});
