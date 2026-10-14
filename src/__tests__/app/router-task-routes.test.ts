import { matchRoutes } from 'react-router-dom';

/**
 * Task route wiring (issue #223).
 *
 * `/task/:taskId` and `/task-v2/:taskId` are both mounted. Retiring V1 is an
 * open maintainer decision (needs-decision on #223), so the documented
 * assumption is the reversible one: keep V1 as is. V2 parity is unproven, and
 * V1 still has callers outside the app (old bookmarks and the docs capture
 * scripts under src-video/).
 *
 * These assertions pin the current wiring so an accidental deletion of V1 fails
 * here. A retirement change must replace them with the redirect test that
 * decision requires.
 */
import { describe, expect, it } from 'vitest';

import { routeLoaderId } from '@/app/route-preload';
import { router } from '@/app/router';

function matchedPaths(pathname: string): (string | undefined)[] {
  const matches = matchRoutes(router.routes as never, pathname);
  return (matches ?? []).map((m) => (m.route as { path?: string }).path);
}

describe('task route wiring', () => {
  it('serves both task routes', () => {
    expect(matchedPaths('/task/abc')).toContain('task/:taskId');
    expect(matchedPaths('/task-v2/abc')).toContain('task-v2/:taskId');
  });

  it('preloads the matching lazy chunk for each route', () => {
    expect(routeLoaderId('/task/abc')).toBe('task');
    expect(routeLoaderId('/task-v2/abc')).toBe('task-v2');
  });
});
