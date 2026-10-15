import { matchRoutes } from 'react-router-dom';

/**
 * Task route wiring (issue #223).
 *
 * The maintainer approved keeping `/task/:taskId` alongside `/task-v2/:taskId`:
 * https://github.com/bravew/Neumar/issues/223#issuecomment-6176446031
 * Video docs/capture tooling still uses V1, and complete V2 parity has not been
 * established. These assertions guard the approved wiring against accidental
 * deletion; no redirect or retirement is included.
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
