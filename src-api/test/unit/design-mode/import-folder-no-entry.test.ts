import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { designRoutes } from '@/app/api/design';

describe('DesignMode import without HTML entry', () => {
  let tempHome = '';
  let workDir = '';

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-import-home-'));
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-import-work-'));
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

  it('warns instead of blocking direct folder uploads with no HTML file', async () => {
    const response = await designRoutes.request('/projects/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Notes only',
        surface: 'prototype',
        files: [{ path: 'notes/brief.md', content: '# Brief' }],
      }),
    });

    expect(response.status).toBe(201);
    const data = (await response.json()) as {
      report: Array<{ rule: string; status: string; message: string }>;
    };
    expect(data.report).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: 'entry-html', status: 'warn' }),
      ]),
    );
  });
});
