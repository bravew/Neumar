import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('DesignMode folder import', () => {
  let tempHome = '';
  let workDir = '';

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-folder-home-'));
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-folder-work-'));
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

  it('creates a linked project without copying source files', async () => {
    const source = await fs.mkdtemp(path.join(workDir, 'neuma-source-'));
    await fs.mkdir(path.join(source, 'src'));
    await fs.writeFile(path.join(source, 'src/index.html'), '<main/>');
    const { importDesignFolder } =
      await import('@/shared/services/design-mode/import-folder/link');
    const { listProjectFiles } =
      await import('@/shared/services/design-mode/fs');

    const result = await importDesignFolder({ path: source });
    const projectFiles = await listProjectFiles(result.project.id);

    expect(result.summary.fileCount).toBe(1);
    expect(result.project.linkedContextDirs).toEqual([result.summary.path]);
    expect(projectFiles.map((file) => file.path)).not.toContain(
      'src/index.html',
    );
    await fs.rm(source, { recursive: true, force: true });
  });

  it('accepts a linked folder with no HTML entry file', async () => {
    const source = await fs.mkdtemp(path.join(workDir, 'neuma-source-'));
    await fs.mkdir(path.join(source, 'notes'));
    await fs.writeFile(path.join(source, 'notes/brief.md'), '# Brief');
    const { importDesignFolder } =
      await import('@/shared/services/design-mode/import-folder/link');

    const result = await importDesignFolder({
      path: source,
      title: 'Notes only',
    });

    expect(result.summary.fileCount).toBe(1);
    expect(result.project.title).toBe('Notes only');
    expect(result.project.linkedContextDirs).toEqual([result.summary.path]);
    await fs.rm(source, { recursive: true, force: true });
  });

  it('rejects files larger than the folder import limit', async () => {
    const source = await fs.mkdtemp(path.join(workDir, 'neuma-source-'));
    const huge = await fs.open(path.join(source, 'huge.bin'), 'w');
    await huge.truncate(101 * 1024 * 1024);
    await huge.close();
    const { validateImportFolder } =
      await import('@/shared/services/design-mode/import-folder/validate');

    await expect(validateImportFolder(source)).rejects.toThrow(/100 MB/);
    await fs.rm(source, { recursive: true, force: true });
  });

  it('rejects the filesystem root as an import folder', async () => {
    const { validateImportFolder } =
      await import('@/shared/services/design-mode/import-folder/validate');

    await expect(
      validateImportFolder(path.parse(workDir).root),
    ).rejects.toThrow(/filesystem root/i);
  });
});
