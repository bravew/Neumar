import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { expect4xx, getJson, post, postJson } from '../helpers/http-client';
import {
  spawnApiInstance,
  stopApiInstance,
  type ApiInstance,
} from '../helpers/spawn-api';

describe('Agent Routes Validation E2E', () => {
  let api: ApiInstance;

  beforeAll(async () => {
    api = await spawnApiInstance('agent-validation');
  }, 60_000);

  afterAll(async () => {
    await stopApiInstance(api);
  });

  describe('input validation', () => {
    it('POST /agent rejects empty body', async () => {
      const { status } = await postJson(api.baseUrl, '/agent', {});
      expect4xx(status);
    });

    it('POST /agent rejects missing prompt', async () => {
      const { status } = await postJson(api.baseUrl, '/agent', {
        sessionId: 'whatever',
      });
      expect4xx(status);
    });

    it('POST /agent rejects empty prompt', async () => {
      const { status } = await postJson(api.baseUrl, '/agent', { prompt: '' });
      expect4xx(status);
    });

    it('POST /agent/plan rejects missing prompt', async () => {
      const { status } = await postJson(api.baseUrl, '/agent/plan', {});
      expect4xx(status);
    });

    it('POST /agent/permission rejects missing permissionId', async () => {
      const { status } = await postJson(api.baseUrl, '/agent/permission', {
        approved: true,
      });
      expect4xx(status);
    });
  });

  describe('lookups for non-existent ids', () => {
    it('GET /agent/session/:id → 404', async () => {
      const { status } = await getJson(
        api.baseUrl,
        '/agent/session/does-not-exist',
      );
      expect(status).toBe(404);
    });

    it('GET /agent/plan/:id → 404', async () => {
      const { status } = await getJson(api.baseUrl, '/agent/plan/no-such-plan');
      expect(status).toBe(404);
    });

    it('POST /agent/stop/:id → 404', async () => {
      const { status } = await post(api.baseUrl, '/agent/stop/does-not-exist');
      expect(status).toBe(404);
    });

    it('POST /agent/permission with unknown permissionId → 404', async () => {
      const { status } = await postJson(api.baseUrl, '/agent/permission', {
        permissionId: 'no-such-permission',
        approved: true,
      });
      expect(status).toBe(404);
    });
  });

  describe('queue endpoints', () => {
    it('GET /agent/queue/status returns success+data', async () => {
      const { status, json } = await getJson(
        api.baseUrl,
        '/agent/queue/status',
      );
      expect(status).toBe(200);
      const body = json as { success: boolean; data: unknown };
      expect(body.success).toBe(true);
      expect(body.data).toBeTruthy();
    });

    it('GET /agent/queue/can-accept returns boolean', async () => {
      const { status, json } = await getJson(
        api.baseUrl,
        '/agent/queue/can-accept',
      );
      expect(status).toBe(200);
      const body = json as { success: boolean; canAccept: boolean };
      expect(body.success).toBe(true);
      expect(typeof body.canAccept).toBe('boolean');
    });

    it('GET /agent/queue/status?profileId=... is per-profile', async () => {
      const { status, json } = await getJson(
        api.baseUrl,
        '/agent/queue/status?profileId=test-profile',
      );
      expect(status).toBe(200);
      const body = json as { success: boolean };
      expect(body.success).toBe(true);
    });
  });
});
