import { describe, expect, it } from 'vitest';

import {
  checkWebCodecsRenderHostAvailability,
  resolveWebCodecsRenderHostUrl,
} from '@/shared/video/webcodecs-renderer';

function restoreEnv(
  snapshot: Partial<
    Record<
      'NEUMA_VIDEO_RENDER_HOST_URL' | 'NEUMA_WEB_RENDER_HOST_URL' | 'NODE_ENV',
      string
    >
  >,
): void {
  for (const key of Object.keys(snapshot) as (keyof typeof snapshot)[]) {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('webcodecs render host', () => {
  it('normalizes configured base URLs to the render-host route', () => {
    const snapshot = {
      NEUMA_VIDEO_RENDER_HOST_URL: process.env.NEUMA_VIDEO_RENDER_HOST_URL,
      NEUMA_WEB_RENDER_HOST_URL: process.env.NEUMA_WEB_RENDER_HOST_URL,
      NODE_ENV: process.env.NODE_ENV,
    };
    try {
      process.env.NEUMA_VIDEO_RENDER_HOST_URL = 'http://localhost:3420';
      delete process.env.NEUMA_WEB_RENDER_HOST_URL;

      expect(resolveWebCodecsRenderHostUrl()).toBe(
        'http://localhost:3420/video-render-host',
      );

      process.env.NEUMA_VIDEO_RENDER_HOST_URL =
        'http://localhost:3420/video-render-host?ready=1';
      expect(resolveWebCodecsRenderHostUrl()).toBe(
        'http://localhost:3420/video-render-host?ready=1',
      );
    } finally {
      restoreEnv(snapshot);
    }
  });

  it('does not auto-probe the implicit dev host in production', async () => {
    const snapshot = {
      NEUMA_VIDEO_RENDER_HOST_URL: process.env.NEUMA_VIDEO_RENDER_HOST_URL,
      NEUMA_WEB_RENDER_HOST_URL: process.env.NEUMA_WEB_RENDER_HOST_URL,
      NODE_ENV: process.env.NODE_ENV,
    };
    try {
      delete process.env.NEUMA_VIDEO_RENDER_HOST_URL;
      delete process.env.NEUMA_WEB_RENDER_HOST_URL;
      process.env.NODE_ENV = 'production';

      const availability = await checkWebCodecsRenderHostAvailability();

      expect(availability).toMatchObject({
        available: false,
        source: 'dev-default',
        url: 'http://127.0.0.1:3420/video-render-host',
      });
      expect(availability.reason).toContain('NODE_ENV=production');
    } finally {
      restoreEnv(snapshot);
    }
  });
});
