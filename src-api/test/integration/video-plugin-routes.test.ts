import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { videoRoutes } from '@/app/api/video';
import { invalidateVideoPluginRouteCache } from '@/app/api/video-plugins';

import { closeDatabase } from '@/shared/db';
import { setSetting } from '@/shared/db/operations';
import { setPluginEnabled } from '@/shared/db/plugins';

beforeEach(() => {
  setSetting('video.plugins', 'true');
  setPluginEnabled('bundled/social-reel', true);
  invalidateVideoPluginRouteCache();
});

afterEach(() => {
  invalidateVideoPluginRouteCache();
  closeDatabase();
});

describe('video plugin routes', () => {
  it('lists video plugins under the video namespace', async () => {
    const response = await videoRoutes.request('/plugins?query=reel');
    const payload = (await response.json()) as {
      plugins?: Array<{ id: string; suggestedPrompt: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload.plugins?.[0]).toMatchObject({
      id: 'social-reel',
      suggestedPrompt: 'Make a social reel about reel.',
    });
  });

  it('applies a plugin without mutating project state', async () => {
    const body = JSON.stringify({ inputs: { topic: 'launch' } });
    const first = await videoRoutes.request('/plugins/social-reel/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const second = await videoRoutes.request('/plugins/social-reel/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const firstPayload = await first.json();
    const secondPayload = await second.json();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(firstPayload).toEqual(secondPayload);
    expect(firstPayload).toMatchObject({
      prompt: 'Make a social reel about launch.',
      context: {
        pluginId: 'social-reel',
        pluginInputs: { topic: 'launch' },
      },
      gate: {
        restricted: false,
        promptGuideIncluded: true,
      },
    });
  });
});
