import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import {
  requestBodyLimit,
  resolveRequestBodyLimit,
} from '@/shared/http/body-limit';

const MB = 1024 * 1024;

describe('CopilotKit request body limit', () => {
  it.each([
    '/copilotkit',
    '/copilotkit/agent/default/run',
    '/copilotkit/agent/default/connect',
    '/copilotkit/agent/default/stop/thread-1',
  ])('keeps %s at the default cap', (path) => {
    expect(resolveRequestBodyLimit(path)).toBe(10 * MB);
  });

  it('rejects an oversized CopilotKit body before the route reads it', async () => {
    const app = new Hono();
    let handlerReached = false;
    app.use('*', requestBodyLimit);
    app.post('/copilotkit/agent/:agentId/run', async (c) => {
      handlerReached = true;
      await c.req.json();
      return c.json({ ok: true });
    });

    const response = await app.request('/copilotkit/agent/default/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: 'x'.repeat(11 * MB) }),
    });

    expect(response.status).toBe(413);
    expect(handlerReached).toBe(false);
  });
});
