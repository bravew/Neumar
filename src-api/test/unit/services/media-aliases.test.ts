import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('DesignMode media aliases', () => {
  let tempHome = '';

  beforeEach(async () => {
    vi.resetModules();
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'media-alias-home-'));
    vi.stubEnv('HOME', tempHome);
    const { saveSetting } = await import('@/shared/db/operations');
    saveSetting('designMode', JSON.stringify({ media: { aliases: {} } }));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    const { closeDatabase } = await import('@/shared/db');
    closeDatabase();
    await fs.rm(tempHome, { recursive: true, force: true });
  });

  it('uses env aliases before settings aliases', async () => {
    vi.stubEnv(
      'DESIGNMODE_MEDIA_MODEL_ALIASES',
      JSON.stringify({ 'seedream-5.0': 'doubao-seedream-5-0' }),
    );
    const { saveSetting } = await import('@/shared/db/operations');
    saveSetting(
      'designMode',
      JSON.stringify({
        media: { aliases: { 'seedream-5.0': 'settings-model' } },
      }),
    );

    const { loadMediaModelAliases, resolveMediaModel } =
      await import('@/shared/services/design-mode/media-aliases');

    const aliases = loadMediaModelAliases();
    expect(aliases).toEqual({ 'seedream-5.0': 'doubao-seedream-5-0' });
    expect(resolveMediaModel('seedream-5.0', aliases)).toBe(
      'doubao-seedream-5-0',
    );
  });

  it('falls back to settings when env JSON is malformed', async () => {
    vi.stubEnv('DESIGNMODE_MEDIA_MODEL_ALIASES', '{bad');
    const { saveSetting } = await import('@/shared/db/operations');
    saveSetting(
      'designMode',
      JSON.stringify({ media: { aliases: { requested: 'resolved' } } }),
    );

    const { loadMediaModelAliases } =
      await import('@/shared/services/design-mode/media-aliases');

    expect(loadMediaModelAliases()).toEqual({ requested: 'resolved' });
  });

  it('returns the original id when no alias exists', async () => {
    const { resolveMediaModel } =
      await import('@/shared/services/design-mode/media-aliases');

    expect(resolveMediaModel('gpt-image-2', {})).toBe('gpt-image-2');
  });
});
