import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('DesignMode discovery language directive', () => {
  let tempHome = '';
  let workDir = '';

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-locale-home-'));
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-locale-work-'));
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

  it('adds the active locale to resolved brief/discovery prompts', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { resolveProjectPrompt } =
      await import('@/shared/services/design-mode/prompt-composer');
    const project = await createDesignProject({
      title: 'Localized brief',
      surface: 'prototype',
      brief: {
        prompt: 'Ask discovery questions.',
        locale: 'zh-CN',
        chatLocale: 'zh-CN',
      },
    });

    const resolved = await resolveProjectPrompt(project, 'Create the form.');

    expect(resolved.sections.map((section) => section.id)).toContain(
      'discovery-language',
    );
    expect(resolved.system).toContain('active chat language is zh-CN');
    expect(resolved.system).toContain('title, description, question labels');
    expect(resolved.system).toContain('structure examples only');
  });
});
