import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_SLUG } from '@/config/branding';
import {
  getSettingItem,
  initializeSettings,
  resetServerBackedSyncForTests,
  saveSettingItem,
} from '@/shared/db/settings';

const server = new Map<string, string>();
const posts: string[] = [];

function stubApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const key = decodeURIComponent(input.split('/db/settings/')[1] ?? '');
      if (init?.method === 'POST') {
        posts.push(key);
        const body = JSON.parse(String(init.body)) as { value: string };
        server.set(key, body.value);
        return Response.json({ success: true });
      }
      const value = server.get(key);
      return value === undefined
        ? Response.json({ error: 'Setting not found' }, { status: 404 })
        : Response.json({ key, value });
    }),
  );
}

describe('first-run flags are kept with the local API', () => {
  beforeEach(() => {
    server.clear();
    posts.length = 0;
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
      clear: () => {
        values.clear();
      },
    });
    resetServerBackedSyncForTests();
    stubApi();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a fresh client reads onboarding state from the API', async () => {
    // Stored as a plain string, like backup-import writes it.
    server.set('onboardingCompleted', 'true');
    expect(await getSettingItem('onboardingCompleted')).toBe('true');
    // Cached locally so the next launch does not need the API.
    expect(localStorage.getItem(`${APP_SLUG}_onboardingCompleted`)).toBe(
      'true',
    );
  });

  it('saving writes the API copy too', async () => {
    await saveSettingItem('demoSeededAt', '2026-10-01T00:00:00.000Z');
    expect(server.get('demoSeededAt')).toBe('2026-10-01T00:00:00.000Z');
  });

  it('backfills an older install once', async () => {
    localStorage.setItem(`${APP_SLUG}_quickstart_step`, 'completed');
    expect(await getSettingItem('quickstart_step')).toBe('completed');
    await vi.waitFor(() =>
      expect(server.get('quickstart_step')).toBe('completed'),
    );
    await getSettingItem('quickstart_step');
    expect(posts.filter((key) => key === 'quickstart_step')).toHaveLength(1);
  });

  it('leaves other keys on the client', async () => {
    await saveSettingItem('activeProfileId', 'p1');
    expect(await getSettingItem('missingKey')).toBeNull();
    expect(posts).toEqual([]);
  });

  it('startup copies every client-only flag to the API', async () => {
    localStorage.setItem(`${APP_SLUG}_demoSeededAt`, '2026-10-01T05:02:52Z');
    await initializeSettings();
    await vi.waitFor(() =>
      expect(server.get('demoSeededAt')).toBe('2026-10-01T05:02:52Z'),
    );
  });

  it('treats a missing API copy as not done', async () => {
    expect(await getSettingItem('onboardingCompleted')).toBeNull();
  });
});
