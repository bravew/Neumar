/**
 * POST /plugins/:id/apply over the chat surface (issue #223).
 *
 * Chat has no apply step: an enabled plugin's skills reach every run, and the
 * marketplace "Use" action routes to Home with the plugin pre-attached. The
 * route therefore answers 501, and this test pins the message so it keeps
 * naming the supported path instead of a follow-up checkpoint that does not
 * exist.
 *
 * The route is exercised through `pluginsRoutes.request()`, the same boundary
 * the HTTP daemon mounts at `/plugins`, so a change to the route registration
 * or the surface branch fails here rather than only in a unit of the apply
 * helper.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { closeDatabase } from '@/shared/db';

vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

afterEach(() => {
  closeDatabase();
});

function applyChatSurface(pluginId: string): Promise<Response> {
  return import('@/app/api/plugins').then(({ pluginsRoutes }) =>
    pluginsRoutes.request(`/${encodeURIComponent(pluginId)}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ surface: 'chat' }),
    }),
  );
}

describe('POST /plugins/:id/apply (chat surface)', () => {
  it('answers 501 and points at the path that actually works', async () => {
    const res = await applyChatSurface('user/hallmark');

    expect(res.status).toBe(501);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('not_available_over_http');
    expect(body.message).toMatch(/Home/);
    expect(body.message).not.toMatch(/follow-up checkpoint/i);
  });

  it('answers 501 before it looks the plugin up', async () => {
    // The branch must not depend on an installed plugin: the request below
    // names an id that is not installed, and a 404 here would mean the surface
    // check moved behind the lookup.
    const res = await applyChatSurface('does-not-exist');
    expect(res.status).toBe(501);
  });
});
