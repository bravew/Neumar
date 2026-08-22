import { beforeEach, describe, expect, it } from 'vitest';

import {
  _resetVideoEngineRegistry,
  UnknownVideoEngineError,
  createHtmlAdapter,
  createRemotionAdapter,
  ensureBuiltinVideoEnginesRegistered,
  getVideoEngine,
  listVideoEngines,
  registerVideoEngine,
} from '@/shared/video/engines';

describe('video engine registry', () => {
  beforeEach(() => {
    _resetVideoEngineRegistry();
  });

  it('throws a typed error for unknown engines (no silent fallback)', () => {
    expect(() => getVideoEngine('does-not-exist')).toThrow(
      UnknownVideoEngineError,
    );
  });

  it('registers built-in adapters with honest install status', async () => {
    ensureBuiltinVideoEnginesRegistered();
    const engines = await listVideoEngines();
    const byId = Object.fromEntries(engines.map((e) => [e.id, e]));
    expect(byId.remotion?.installed).toBe(true);
    // The html engine's status depends on whether the Chromium binary is
    // actually downloaded on this host, so assert the contract rather than a
    // fixed value: available, or unavailable with a typed reason.
    expect(typeof byId.html?.installed).toBe('boolean');
    if (!byId.html?.installed) {
      expect(byId.html?.availability).toMatchObject({
        installed: false,
        reason: 'browser-missing',
      });
    }
    expect(byId.hyperframes?.availability).toBeDefined();
  });

  it('supports replacing an adapter at runtime', () => {
    const a = createRemotionAdapter();
    registerVideoEngine(a);
    expect(getVideoEngine('remotion').name).toBe('Remotion');
    const html = createHtmlAdapter();
    registerVideoEngine(html);
    expect(getVideoEngine('html').id).toBe('html');
  });

  it('ensureBuiltinVideoEnginesRegistered re-registers after a reset', async () => {
    ensureBuiltinVideoEnginesRegistered();
    expect((await listVideoEngines()).length).toBe(3);
    _resetVideoEngineRegistry();
    expect((await listVideoEngines()).length).toBe(0);
    ensureBuiltinVideoEnginesRegistered();
    expect((await listVideoEngines()).length).toBe(3);
  });
});
