import { describe, expect, it } from 'vitest';

import { surfaceRoute, USE_PLUGIN_PARAM } from '@/shared/plugins/use-plugin';

describe('surfaceRoute', () => {
  it('routes video plugins to Video Mode', () => {
    expect(surfaceRoute(['video'])).toBe('/video');
    expect(surfaceRoute(['design', 'video'])).toBe('/video');
  });

  it('routes design plugins to Design Mode', () => {
    expect(surfaceRoute(['design'])).toBe('/design');
  });

  it('falls back to the main chat for other or missing surfaces', () => {
    expect(surfaceRoute(['task'])).toBe('/');
    expect(surfaceRoute([])).toBe('/');
    expect(surfaceRoute(undefined)).toBe('/');
    expect(surfaceRoute(null)).toBe('/');
  });

  it('exposes a stable query-param key', () => {
    expect(USE_PLUGIN_PARAM).toBe('plugin');
  });
});
