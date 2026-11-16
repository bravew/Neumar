import { describe, expect, it } from 'vitest';

// The runtime captures telemetry on every handled request. Keep the suite off
// the third-party sinks, as with any other external service in tests.
process.env.DO_NOT_TRACK = '1';

const { copilotKitRoutes } = await import('@/app/api/copilotkit');

function post(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/**
 * Regression coverage for the CopilotKit v2 route pipeline (#314).
 *
 * The v1 `middleware.onBeforeRequest` option made CopilotKit convert
 * `body.messages` before dispatch, which threw for every request without a
 * messages array (connect, stop, malformed run) and surfaced as a 500. These
 * requests exercise the same pipeline without contacting the agent.
 */
describe('CopilotKit routes', () => {
  it('serves agent discovery info', async () => {
    const response = await copilotKitRoutes.request('/copilotkit/info');

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      agents?: Record<string, { name?: string }>;
    };
    expect(body.agents?.default).toBeTruthy();
  });

  it('serves a connect request for a thread with no recorded runs', async () => {
    const response = await copilotKitRoutes.request(
      '/copilotkit/agent/default/connect',
      post({ threadId: 'thread-connect', runId: 'run-connect', messages: [] }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    // The thread has no recorded runs, so the stream completes immediately.
    await response.text();
  });

  it('handles a stop request with an empty body', async () => {
    const response = await copilotKitRoutes.request(
      '/copilotkit/agent/default/stop/thread-stop',
      post({}),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ stopped: false });
  });

  it('rejects a malformed run body with a 400 instead of crashing', async () => {
    const response = await copilotKitRoutes.request(
      '/copilotkit/agent/default/run',
      post({}),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'Invalid request body',
    });
  });

  it('returns 404 for a run on an unknown agent', async () => {
    const response = await copilotKitRoutes.request(
      '/copilotkit/agent/unknown/run',
      post({ threadId: 'thread-1', runId: 'run-1', messages: [] }),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: 'Agent not found' });
  });
});
