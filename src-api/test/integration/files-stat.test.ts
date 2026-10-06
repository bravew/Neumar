import fs from 'node:fs/promises';
import path from 'node:path';

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { filesRoutes } from '@/app/api/files';

function stat(filePath: string) {
  const app = new Hono();
  app.route('/files', filesRoutes);
  return app.request('/files/stat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath }),
  });
}

describe('POST /files/stat', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join('/tmp', 'files-stat-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('reports a file with its resolved absolute path and size', async () => {
    const file = path.join(dir, 'clip.mp4');
    await fs.writeFile(file, 'abcd');

    const body = await (await stat(file)).json();

    expect(body).toMatchObject({
      exists: true,
      resolvedPath: file,
      isFile: true,
      isDirectory: false,
      size: 4,
    });
  });

  it('reports a directory so callers do not attach it as a file', async () => {
    const body = await (await stat(dir)).json();

    expect(body).toMatchObject({ exists: true, isFile: false });
    expect(body.isDirectory).toBe(true);
  });

  it('reports a missing file without marking it denied', async () => {
    const body = await (await stat(path.join(dir, 'missing.mp4'))).json();

    expect(body).toEqual({ exists: false });
  });

  it('marks a path outside the trusted roots as denied', async () => {
    const body = await (await stat('/etc/hosts')).json();

    expect(body).toEqual({ exists: false, denied: true });
  });
});
