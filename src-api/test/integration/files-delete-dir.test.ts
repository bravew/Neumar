import fs from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { filesRoutes } from '@/app/api/files';

import { closeDatabase } from '@/shared/db';
import { setSetting } from '@/shared/db/operations';

describe('DELETE /files/delete-dir', () => {
  let customWorkDir: string;

  beforeEach(async () => {
    closeDatabase();
    customWorkDir = await fs.mkdtemp(
      path.join('/tmp', 'files-delete-dir-workdir-'),
    );
    setSetting('workDir', customWorkDir);
  });

  afterEach(async () => {
    closeDatabase();
    await fs.rm(customWorkDir, { recursive: true, force: true });
  });

  it('deletes a session folder under the configured workDir, not just the default home location', async () => {
    // This used to hardcode ~/<appDir>/sessions as the only allowed base, so
    // any session folder under a custom workDir (an external volume, say)
    // was silently refused with a 403 and never actually got deleted.
    const sessionDir = path.join(customWorkDir, 'sessions', 'session-task-1');
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(path.join(sessionDir, 'note.txt'), 'hello');

    const res = await filesRoutes.request('/delete-dir', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: sessionDir }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    await expect(fs.access(sessionDir)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('still refuses a directory that is not a direct sessions/ child', async () => {
    const other = path.join(customWorkDir, 'not-sessions', 'task-1');
    await fs.mkdir(other, { recursive: true });

    const res = await filesRoutes.request('/delete-dir', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: other }),
    });
    expect(res.status).toBe(403);
    await expect(fs.access(other)).resolves.toBeUndefined();
  });

  it('refuses a sessions folder that is only trusted because it sits under /tmp', async () => {
    // isAllowedPath() includes the OS temp dir for reads. A recursive delete
    // must not follow that broader root when the folder is not the configured
    // workDir's own sessions/ child.
    const outsider = path.join(
      '/tmp',
      'sessions',
      'files-delete-dir-not-workspace',
    );
    await fs.mkdir(outsider, { recursive: true });
    try {
      const res = await filesRoutes.request('/delete-dir', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: outsider }),
      });
      expect(res.status).toBe(403);
      await expect(fs.access(outsider)).resolves.toBeUndefined();
    } finally {
      await fs.rm(outsider, { recursive: true, force: true });
    }
  });
});
