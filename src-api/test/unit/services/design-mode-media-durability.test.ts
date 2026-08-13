import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('DesignMode media durability', () => {
  let tempHome = '';
  let workDir = '';

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-media-home-'));
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-media-work-'));
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

  it('marks persisted running DesignMode tasks failed on daemon restart', async () => {
    const { getDatabase } = await import('@/shared/db');
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { reconcileRunningDesignMediaTasks } =
      await import('@/shared/services/design-mode/media-dispatcher');
    const project = await createDesignProject({
      title: 'Durable task',
      surface: 'image',
    });
    getDatabase()
      .prepare(
        `INSERT INTO tasks (id, prompt, title, status, project_id, started_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      )
      .run(
        'dmtask_recover',
        'make an image',
        'DesignMode image',
        'running',
        project.id,
        new Date().toISOString(),
      );

    expect(reconcileRunningDesignMediaTasks()).toBe(1);
    const row = getDatabase()
      .prepare('SELECT status FROM tasks WHERE id = ?')
      .get('dmtask_recover') as { status: string };
    expect(row.status).toBe('failed');
  });
});
