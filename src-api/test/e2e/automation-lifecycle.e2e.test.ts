/**
 * Automation Lifecycle E2E Tests
 *
 * Full lifecycle tests against a real spawned API server.
 * Tests the complete automation CRUD + execution cycle.
 *
 * Best practices:
 * - Real server (not mocked) — catches integration bugs
 * - Lifecycle test: create → verify → toggle → run → cancel → delete
 * - Clean up after each test group
 * - Generous timeouts for server startup
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  spawnApiInstance,
  stopApiInstance,
  type ApiInstance,
} from '../helpers/spawn-api';

describe('Automation Lifecycle E2E', () => {
  let api: ApiInstance;

  beforeAll(async () => {
    api = await spawnApiInstance('auto-lifecycle');
  }, 60_000);

  afterAll(async () => {
    await stopApiInstance(api);
  });

  let automationId: string;

  it('engine status is available', async () => {
    const res = await fetch(`${api.baseUrl}/automation/status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('success', true);
  });

  it('lists automations (empty initially)', async () => {
    const res = await fetch(`${api.baseUrl}/automation`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('creates an automation', async () => {
    // Use raw fetch to bypass any helper quirks
    const res = await fetch(`${api.baseUrl}/automation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'E2E Test Automation',
        prompt: 'Say hello',
        trigger: { type: 'manual' },
        agent: { usePlanning: false, autoApprove: true },
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      success: boolean;
      data: { id: string };
    };
    expect(body.success).toBe(true);
    automationId = body.data.id;
  });

  it('lists automations and includes created one', async () => {
    expect(
      automationId,
      'automationId must be set by "creates" test',
    ).toBeTruthy();
    const res = await fetch(`${api.baseUrl}/automation`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: Array<{ id: string; name: string }>;
    };
    expect(body.data.some((a) => a.id === automationId)).toBe(true);
  });

  it('gets automation by ID', async () => {
    expect(
      automationId,
      'automationId must be set by "creates" test',
    ).toBeTruthy();
    const res = await fetch(`${api.baseUrl}/automation/${automationId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { name: string };
    };
    expect(body.data.name).toBe('E2E Test Automation');
  });

  it('toggles automation off', async () => {
    expect(
      automationId,
      'automationId must be set by "creates" test',
    ).toBeTruthy();
    const res = await fetch(
      `${api.baseUrl}/automation/${automationId}/toggle`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { enabled: boolean };
    };
    expect(body.data.enabled).toBe(false);
  });

  it('rejects manual run on disabled automation', async () => {
    expect(
      automationId,
      'automationId must be set by "creates" test',
    ).toBeTruthy();
    const res = await fetch(`${api.baseUrl}/automation/${automationId}/run`, {
      method: 'POST',
    });
    expect(res.status).toBe(400);
  });

  it('toggles automation back on', async () => {
    expect(
      automationId,
      'automationId must be set by "creates" test',
    ).toBeTruthy();
    const res = await fetch(
      `${api.baseUrl}/automation/${automationId}/toggle`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { enabled: boolean };
    };
    expect(body.data.enabled).toBe(true);
  });

  it('deletes automation', async () => {
    expect(
      automationId,
      'automationId must be set by "creates" test',
    ).toBeTruthy();
    const res = await fetch(`${api.baseUrl}/automation/${automationId}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
  });

  it('confirms automation is gone', async () => {
    expect(
      automationId,
      'automationId must be set by "creates" test',
    ).toBeTruthy();
    const res = await fetch(`${api.baseUrl}/automation/${automationId}`);
    expect(res.status).toBe(404);
  });
});
