import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { filesRoutes } from '@/app/api/files';

import { closeDatabase } from '@/shared/db';

describe('workspace migration includes video projects', () => {
  let oldWorkDir: string;
  let newWorkDir: string;

  beforeEach(async () => {
    closeDatabase();
    oldWorkDir = await fs.mkdtemp(
      path.join('/tmp', 'files-migrate-workspace-old-'),
    );
    newWorkDir = await fs.mkdtemp(
      path.join('/tmp', 'files-migrate-workspace-new-'),
    );
  });

  afterEach(async () => {
    closeDatabase();
    await fs.rm(oldWorkDir, { recursive: true, force: true });
    await fs.rm(newWorkDir, { recursive: true, force: true });
  });

  it('moves videos/ alongside sessions/ instead of leaving it behind', async () => {
    const videoProjectDir = path.join(oldWorkDir, 'videos', 'proj-1');
    await fs.mkdir(videoProjectDir, { recursive: true });
    await fs.writeFile(
      path.join(videoProjectDir, 'project.json'),
      JSON.stringify({ id: 'proj-1' }),
    );
    const sessionsDir = path.join(oldWorkDir, 'sessions', 'task-1');
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(path.join(sessionsDir, 'note.txt'), 'hello');

    const res = await filesRoutes.request('/migrate-sessions-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldWorkDir, newWorkDir }),
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('event: done');
    expect(body).toContain('"success":true');

    // The video project must land at the new workspace root, not be left
    // behind — it used to be silently excluded from MIGRATABLE_FOLDERS.
    await expect(
      fs.readFile(
        path.join(newWorkDir, 'videos', 'proj-1', 'project.json'),
        'utf8',
      ),
    ).resolves.toContain('proj-1');
    await expect(
      fs.access(path.join(oldWorkDir, 'videos')),
    ).rejects.toMatchObject({ code: 'ENOENT' });

    // Existing folders keep moving the same way.
    await expect(
      fs.readFile(
        path.join(newWorkDir, 'sessions', 'task-1', 'note.txt'),
        'utf8',
      ),
    ).resolves.toBe('hello');
  });
});
