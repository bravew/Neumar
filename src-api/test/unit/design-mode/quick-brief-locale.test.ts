import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('DesignMode quick brief locale', () => {
  let tempHome = '';
  let workDir = '';

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-brief-home-'));
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-brief-work-'));
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

  it('keeps the active locale while preserving task-type routing guidance', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { resolveProjectPrompt } =
      await import('@/shared/services/design-mode/prompt-composer');
    const project = await createDesignProject({
      title: 'Localized landing',
      surface: 'prototype',
      intent: 'landing-page',
      brief: {
        prompt: 'Build a localized landing page.',
        locale: 'fr-FR',
        chatLocale: 'fr-FR',
        createdFromPanel: true,
      },
    });

    const resolved = await resolveProjectPrompt(project, 'Continue.');

    expect(project.intent).toBe('landing-page');
    expect(resolved.system).toContain('active chat language is fr-FR');
    expect(resolved.sections.map((section) => section.id)).toEqual(
      expect.arrayContaining(['discovery-language', 'screen-file-first']),
    );
    expect(resolved.system).toContain('artifacts/mobile.html');
  });
});
