import { describe, expect, it } from 'vitest';

import { routeLoaderId, routePathname } from '@/app/route-preload';

describe('route preload map', () => {
  it('strips hashes and queries before matching', () => {
    expect(routePathname('/library#tasks')).toBe('/library');
    expect(routePathname('/automation?id=abc')).toBe('/automation');
    expect(routePathname('design')).toBe('/design');
  });

  it('maps nav targets and recent rows onto a lazy chunk', () => {
    expect(routeLoaderId('/')).toBe('home');
    expect(routeLoaderId('/library')).toBe('library');
    expect(routeLoaderId('/automation#running')).toBe('automation');
    expect(routeLoaderId('/task-v2/task-1')).toBe('task-v2');
    expect(routeLoaderId('/design/project-1')).toBe('design');
    expect(routeLoaderId('/video/settings/providers')).toBe('video-providers');
    expect(routeLoaderId('/video/project-1')).toBe('video-project');
    expect(routeLoaderId('/video')).toBe('video');
    expect(routeLoaderId('/projects/abc')).toBe('project-detail');
    expect(routeLoaderId('/does-not-exist')).toBeNull();
  });
});
