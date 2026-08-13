import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { deleteJson, expect4xx, postJson } from '../helpers/http-client';
import {
  spawnApiInstance,
  stopApiInstance,
  type ApiInstance,
} from '../helpers/spawn-api';

describe('Workspace Boundary E2E', () => {
  let api: ApiInstance;
  let insideFile: string;

  beforeAll(async () => {
    api = await spawnApiInstance('workspace-boundary');
    insideFile = join(api.homeDir, 'inside.txt');
    await writeFile(insideFile, 'hello from inside HOME', 'utf-8');
  }, 60_000);

  afterAll(async () => {
    await stopApiInstance(api);
  });

  describe('reads inside allowed roots succeed', () => {
    it('reads a file under tempHome', async () => {
      const { status, json } = await postJson(api.baseUrl, '/files/read', {
        path: insideFile,
      });
      expect(status).toBe(200);
      const body = json as { success: boolean; content: string };
      expect(body.success).toBe(true);
      expect(body.content).toContain('hello from inside HOME');
    });

    it('lists tempHome directory', async () => {
      const { status, json } = await postJson(api.baseUrl, '/files/readdir', {
        path: api.homeDir,
      });
      expect(status).toBe(200);
      const body = json as { success: boolean; files: unknown[] };
      expect(body.success).toBe(true);
      expect(Array.isArray(body.files)).toBe(true);
    });
  });

  describe('reads outside allowed roots are rejected', () => {
    it('rejects /etc/passwd with 403', async () => {
      const { status, json } = await postJson(api.baseUrl, '/files/read', {
        path: '/etc/passwd',
      });
      expect(status).toBe(403);
      expect((json as { error: string }).error).toMatch(/access denied/i);
    });

    it('rejects /etc readdir with 403', async () => {
      const { status } = await postJson(api.baseUrl, '/files/readdir', {
        path: '/etc',
      });
      expect(status).toBe(403);
    });

    it('rejects path traversal that resolves outside HOME', async () => {
      const escaping = join(
        api.homeDir,
        '..',
        '..',
        '..',
        '..',
        'etc',
        'passwd',
      );
      const { status } = await postJson(api.baseUrl, '/files/read', {
        path: escaping,
      });
      expect(status).toBe(403);
    });

    it('rejects /usr/bin readdir with 403', async () => {
      const { status } = await postJson(api.baseUrl, '/files/readdir', {
        path: '/usr/bin',
      });
      expect(status).toBe(403);
    });
  });

  describe('input validation', () => {
    it('rejects empty path with 400', async () => {
      const { status } = await postJson(api.baseUrl, '/files/read', {
        path: '',
      });
      expect(status).toBe(400);
    });

    it('rejects missing path', async () => {
      const { status } = await postJson(api.baseUrl, '/files/read', {});
      expect4xx(status);
    });
  });

  describe('delete-dir is gated on the boundary', () => {
    // delete-dir is stricter than the general isAllowedPath: it admits only
    // ~/<appDir>/sessions/, regardless of whether the target is otherwise
    // inside HOME.

    it('refuses to delete /etc — and /etc is still readable', async () => {
      const { status } = await deleteJson(api.baseUrl, '/files/delete-dir', {
        path: '/etc',
      });
      expect(status).toBe(403);
      const passwd = await readFile('/etc/passwd', 'utf-8').catch(() => null);
      expect(passwd).not.toBeNull();
    });

    it('refuses HOME-scoped dirs outside ~/<app>/sessions/', async () => {
      const sandbox = join(api.homeDir, 'to-delete');
      await mkdir(sandbox, { recursive: true });
      const victim = join(sandbox, 'a.txt');
      await writeFile(victim, 'x', 'utf-8');

      const { status } = await deleteJson(api.baseUrl, '/files/delete-dir', {
        path: sandbox,
      });
      expect(status).toBe(403);

      const stillThere = await readFile(victim, 'utf-8').catch(() => null);
      expect(stillThere).toBe('x');
      await rm(sandbox, { recursive: true, force: true }).catch(() => {});
    });
  });
});
