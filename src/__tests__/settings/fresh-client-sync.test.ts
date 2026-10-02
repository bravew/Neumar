import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_SLUG } from '@/config/branding';

/** The local API's settings table, as stored strings. */
const server = new Map<string, string>();
const posted = new Map<string, string>();
/** Reads fail while writes still land, as in a transient read failure. */
let readsFail = false;

function stubApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      const match = url.match(/\/db\/settings(?:\/([^/?]+))?$/);
      if (!match) return Response.json({}, { status: 404 });
      if (readsFail && init?.method !== 'POST') {
        throw new TypeError('Failed to fetch');
      }
      const key = match[1] ? decodeURIComponent(match[1]) : undefined;
      if (init?.method === 'POST' && key) {
        const body = JSON.parse(String(init.body)) as { value: string };
        posted.set(key, body.value);
        server.set(key, body.value);
        return Response.json({ success: true });
      }
      if (!key) return Response.json(Object.fromEntries(server));
      const value = server.get(key);
      return value === undefined
        ? Response.json({ error: 'Setting not found' }, { status: 404 })
        : Response.json({ key, value });
    }),
  );
}

function stubLocalStorage(initial: Record<string, string>) {
  const values = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => values.clear(),
  });
}

async function startClient() {
  // A fresh module per test: the settings cache and sync flag are module state.
  vi.resetModules();
  const settings = await import('@/shared/db/settings');
  const loaded = await settings.initializeSettings();
  // The startup sync is fire-and-forget.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return loaded;
}

describe('a fresh client does not overwrite the server (#165)', () => {
  beforeEach(() => {
    server.clear();
    posted.clear();
    readsFail = false;
    server.set('defaultModel', JSON.stringify('claude-opus-5-5'));
    server.set('planMode', JSON.stringify('auto'));
    stubApi();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('adopts server values for synced keys it never stored', async () => {
    // What a Playwright init script leaves behind: only ui and language.
    stubLocalStorage({
      [`${APP_SLUG}_settings`]: JSON.stringify({
        ui: { simpleShell: true },
        language: 'en-US',
      }),
    });
    const loaded = await startClient();
    expect(loaded.defaultModel).toBe('claude-opus-5-5');
    expect(loaded.planMode).toBe('auto');
    expect(server.get('defaultModel')).toBe(JSON.stringify('claude-opus-5-5'));
    expect(server.get('planMode')).toBe(JSON.stringify('auto'));
  });

  it('keeps its own stored values and still syncs them', async () => {
    stubLocalStorage({
      [`${APP_SLUG}_settings`]: JSON.stringify({ defaultModel: 'mine' }),
    });
    const loaded = await startClient();
    expect(loaded.defaultModel).toBe('mine');
    expect(posted.get('defaultModel')).toBe(JSON.stringify('mine'));
  });

  it('does not push defaults when the server could not be read', async () => {
    readsFail = true;
    stubLocalStorage({
      [`${APP_SLUG}_settings`]: JSON.stringify({ language: 'en-US' }),
    });
    await startClient();
    expect(posted.size).toBe(0);
    expect(server.get('planMode')).toBe(JSON.stringify('auto'));
  });
});
