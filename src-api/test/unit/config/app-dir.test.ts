import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_DATA_DIR } from '../../../src/config/branding';

describe('NEUMAR_APP_DATA_DIR moves every store (#166)', () => {
  let dataDir: string;
  const original = process.env.NEUMAR_APP_DATA_DIR;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'neumar-app-dir-'));
    process.env.NEUMAR_APP_DATA_DIR = dataDir;
    vi.resetModules();
  });

  afterEach(async () => {
    const db = await import('../../../src/shared/db/index');
    db.closeDatabase();
    if (original === undefined) delete process.env.NEUMAR_APP_DATA_DIR;
    else process.env.NEUMAR_APP_DATA_DIR = original;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('both app-dir helpers follow the override', async () => {
    const { getAppDir } = await import('../../../src/config/constants');
    const { getAppDataDir } = await import('../../../src/shared/utils/paths');
    expect(getAppDir()).toBe(dataDir);
    expect(getAppDataDir()).toBe(dataDir);
  });

  it('opens the database inside it', async () => {
    const db = await import('../../../src/shared/db/index');
    db.closeDatabase();
    db.getDatabase();
    expect(existsSync(join(dataDir, 'database.db'))).toBe(true);
  });

  it('resolves the default ~/.<slug> workDir to it', async () => {
    const ops = await import('../../../src/shared/db/operations');
    ops.saveSetting('workDir', `~/${APP_DATA_DIR}`);
    expect(ops.getSetting('workDir')).toBe(dataDir);
    ops.saveSetting('workDir', `~/${APP_DATA_DIR}/sessions`);
    expect(ops.getSetting('workDir')).toBe(join(dataDir, 'sessions'));
    // Other home paths still mean the home directory.
    ops.saveSetting('workDir', '~/Projects');
    expect(ops.getSetting('workDir')).toBe(join(homedir(), 'Projects'));
  });
});

describe('without the override', () => {
  it('expands ~/.<slug> under the home directory as before', async () => {
    const original = process.env.NEUMAR_APP_DATA_DIR;
    delete process.env.NEUMAR_APP_DATA_DIR;
    try {
      const { expandAppPath, resolveAppDir } =
        await import('../../../src/config/app-dir');
      expect(resolveAppDir()).toBe(join(homedir(), APP_DATA_DIR));
      expect(expandAppPath(`~/${APP_DATA_DIR}`)).toBe(
        join(homedir(), APP_DATA_DIR),
      );
      expect(expandAppPath('/abs/path')).toBe('/abs/path');
    } finally {
      if (original !== undefined) process.env.NEUMAR_APP_DATA_DIR = original;
    }
  });
});
