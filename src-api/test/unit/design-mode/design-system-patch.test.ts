import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('DesignMode design-system PATCH', () => {
  let tempHome = '';
  let workDir = '';

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-ds-home-'));
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-ds-work-'));
    vi.stubEnv('HOME', tempHome);
    const { saveSetting } = await import('@/shared/db/operations');
    saveSetting('workDir', workDir);
  });

  afterEach(async () => {
    const { closeDatabase } = await import('@/shared/db');
    closeDatabase();
    vi.unstubAllEnvs();
    await fs.rm(tempHome, { recursive: true, force: true });
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('renames workspace-backed custom systems and keeps them editable', async () => {
    const root = path.join(workDir, '.neuma/design-systems/custom-system');
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(
      path.join(root, 'DESIGN.md'),
      '# Custom System\n\n> Category: Local\n\nOriginal body.',
    );
    await fs.writeFile(
      path.join(root, 'meta.json'),
      JSON.stringify({ id: 'custom-system', sourceKind: 'custom' }),
    );

    const { getDesignSystem, patchDesignSystem } =
      await import('@/shared/services/design-mode/catalogs');
    const renamed = await patchDesignSystem('custom-system', {
      title: 'Renamed System',
    });

    expect(renamed).toMatchObject({
      id: 'custom-system',
      title: 'Renamed System',
      origin: 'installed',
      editable: true,
    });
    await expect(getDesignSystem('custom-system')).resolves.toMatchObject({
      title: 'Renamed System',
      editable: true,
    });
    await expect(
      fs.readFile(path.join(root, 'DESIGN.md'), 'utf-8'),
    ).resolves.toContain('# Renamed System');
  });

  it('rejects bundled systems as read-only', async () => {
    const { DesignSystemReadOnlyError, patchDesignSystem } =
      await import('@/shared/services/design-mode/catalogs');

    await expect(
      patchDesignSystem('default', { title: 'Do not rename' }),
    ).rejects.toBeInstanceOf(DesignSystemReadOnlyError);
  });
});
