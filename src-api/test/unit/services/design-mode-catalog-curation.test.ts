import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getCraft,
  getDesignLiveArtifactTemplate,
  getDesignSystem,
  installDesignSkillPack,
  installDesignSystemPack,
  listDesignLiveArtifactTemplates,
  listDesignSystems,
  listDesignSkills,
  listCraft,
  uninstallDesignSkillPack,
  uninstallDesignSystemPack,
} from '@/shared/services/design-mode/catalogs';

describe('DesignMode curated catalog additions', () => {
  it('loads curated craft modules', async () => {
    const craft = await listCraft();
    const ids = craft.map((item) => item.id);

    expect(ids).toEqual(
      expect.arrayContaining([
        'typography-hierarchy',
        'typography-hierarchy-editorial',
        'laws-of-ux',
        'accessibility-baseline',
        'form-validation',
        'rtl-and-bidi',
      ]),
    );
    await expect(getCraft('accessibility-baseline')).resolves.toMatchObject({
      id: 'accessibility-baseline',
    });
  });

  it('loads curated design systems without Open Design branding', async () => {
    const mission = await getDesignSystem('mission-control');
    const urdu = await getDesignSystem('urdu-modern');
    const defaultSystem = await getDesignSystem('default');

    expect(mission?.title).toMatch(/Mission Control/i);
    expect(urdu?.title).toMatch(/Urdu Modern/i);
    expect(urdu?.body).not.toMatch(/OD Daemon|Open Design/i);
    expect(defaultSystem?.tokenCss).toContain('--accent: #2f6feb');
    expect(defaultSystem?.componentsHtml).toContain('reference components');
    expect(defaultSystem?.tokens).toEqual(expect.arrayContaining(['#2f6feb']));
  });

  it('loads curated live artifact and dashboard skills', async () => {
    const skills = await listDesignSkills();
    const slugs = skills.map((skill) => skill.slug);

    expect(slugs).toEqual(
      expect.arrayContaining([
        'live-artifact',
        'live-dashboard',
        'waitlist-page',
        'github-dashboard',
        'clinical-case-report',
      ]),
    );
    expect(
      skills.find((skill) => skill.slug === 'live-artifact')?.content,
    ).not.toMatch(/Open Design|OD Daemon|OD_NODE_BIN/);
  });

  it('loads curated live artifact templates', async () => {
    const templates = await listDesignLiveArtifactTemplates();
    const operationsBrief = await getDesignLiveArtifactTemplate(
      'otd-operations-brief',
    );

    expect(templates.map((template) => template.id)).toContain(
      'otd-operations-brief',
    );
    expect(operationsBrief).toMatchObject({
      id: 'otd-operations-brief',
      title: 'On-Time Delivery Dashboard',
      category: 'Live Artifacts',
    });
    expect(operationsBrief?.templateHtml).toContain('{{data.');
    expect(operationsBrief?.readme).not.toMatch(/Open Design|OD Daemon/);
  });
});

describe('DesignMode catalog install state', () => {
  let tempHome = '';
  let workDir = '';

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-catalog-home-'));
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-catalog-work-'));
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

  it('installs, shadows, and uninstalls bundled catalog packs safely', async () => {
    await expect(installDesignSystemPack('../escape')).rejects.toThrow(
      /Invalid design system source/,
    );

    const installedSystem = await installDesignSystemPack('mission-control');
    expect(installedSystem).toMatchObject({
      id: 'mission-control',
      origin: 'installed',
      canUninstall: true,
    });
    // installCatalogPack stamps installedAt in meta.json; the record must
    // surface it so catalog `newest` ordering has a real timestamp.
    expect(Date.parse(installedSystem.installedAt ?? '')).not.toBeNaN();
    await expect(getDesignSystem('mission-control')).resolves.toMatchObject({
      origin: 'installed',
    });

    await uninstallDesignSystemPack('mission-control');
    await expect(getDesignSystem('mission-control')).resolves.toMatchObject({
      origin: 'bundled',
      canUninstall: false,
    });

    const installedSkill = await installDesignSkillPack('dashboard');
    expect(installedSkill).toMatchObject({
      id: 'bundled:dashboard',
      slug: 'dashboard',
      origin: 'installed',
      canUninstall: true,
    });
    expect(
      (await listDesignSkills()).find((skill) => skill.slug === 'dashboard'),
    ).toMatchObject({ origin: 'installed' });

    await uninstallDesignSkillPack('dashboard');
    expect(
      (await listDesignSkills()).find((skill) => skill.slug === 'dashboard'),
    ).toMatchObject({ origin: 'builtin', canUninstall: false });
  });

  it('includes structured design-system sidecars in resolved prompts', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { readProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const { resolveProjectPrompt } =
      await import('@/shared/services/design-mode/prompt-composer');

    const project = await createDesignProject({
      title: 'Token prompt',
      surface: 'prototype',
      designSystemId: 'default',
    });
    const resolved = await resolveProjectPrompt(project, 'Use the tokens.');

    expect(resolved.system).toContain('Active design system tokens');
    expect(resolved.system).toContain('```css');
    expect(resolved.system).toContain('Reference fixture');
    expect(resolved.system).toContain('```html');
    expect(resolved.system).toContain(
      'Paste the unscoped `:root { ... }` block verbatim',
    );
    expect(resolved.system).toContain('--accent: #2f6feb');
    expect(
      resolved.sections.find(
        (section) => section.id === 'design-system-components',
      ),
    ).toMatchObject({ cache_control: { type: 'ephemeral' } });
    expect(
      resolved.sections.find(
        (section) => section.id === 'design-system-tokens',
      ),
    ).not.toHaveProperty('cache_control');
    await expect(
      readProjectTextFile(project.id, 'design-system/tokens.css'),
    ).resolves.toMatchObject({
      content: expect.stringContaining('--accent: #2f6feb'),
    });
    await expect(
      readProjectTextFile(project.id, 'design-system/components.html'),
    ).resolves.toMatchObject({
      content: expect.stringContaining('reference components'),
    });
  });

  it('throws when a design-system sidecar path is a directory', async () => {
    const root = path.join(workDir, '.neuma/design-systems/broken-sidecar');
    await fs.mkdir(path.join(root, 'tokens.css'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'DESIGN.md'),
      '# Broken sidecar\n\n> Category: Test\n',
    );

    await expect(getDesignSystem('broken-sidecar')).rejects.toMatchObject({
      code: 'EISDIR',
    });
  });

  it('loads a design-system with only tokens.css present', async () => {
    const root = path.join(workDir, '.neuma/design-systems/tokens-only');
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(
      path.join(root, 'DESIGN.md'),
      '# Tokens only\n\n> Category: Test\n',
    );
    await fs.writeFile(
      path.join(root, 'tokens.css'),
      ':root { --accent: #123456; }',
    );

    await expect(getDesignSystem('tokens-only')).resolves.toMatchObject({
      id: 'tokens-only',
      tokenCss: ':root { --accent: #123456; }',
      componentsHtml: undefined,
    });

    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { resolveProjectPrompt } =
      await import('@/shared/services/design-mode/prompt-composer');
    const project = await createDesignProject({
      title: 'Tokens only',
      surface: 'prototype',
      designSystemId: 'tokens-only',
    });
    const resolved = await resolveProjectPrompt(project, 'Use these tokens.');

    expect(
      resolved.sections.find(
        (section) => section.id === 'design-system-tokens',
      ),
    ).toMatchObject({ cache_control: { type: 'ephemeral' } });
    expect(resolved.sections.map((section) => section.id)).not.toContain(
      'design-system-components',
    );
  });

  it('loads design systems and skills from design-surface plugins only', async () => {
    const { getAppDir } = await import('@/config/constants');
    const designPluginName = `design-kit-${randomUUID().slice(0, 8)}`;
    const taskPluginName = `task-kit-${randomUUID().slice(0, 8)}`;
    const pluginsRoot = path.join(getAppDir(), 'plugins');
    const designPluginRoot = path.join(pluginsRoot, designPluginName);
    const taskPluginRoot = path.join(pluginsRoot, taskPluginName);

    await fs.mkdir(path.join(designPluginRoot, '.claude-plugin'), {
      recursive: true,
    });
    await fs.mkdir(path.join(designPluginRoot, 'packs', 'nebula'), {
      recursive: true,
    });
    await fs.mkdir(path.join(designPluginRoot, 'design-systems', 'aurora'), {
      recursive: true,
    });
    await fs.mkdir(path.join(designPluginRoot, 'skills', 'prototype'), {
      recursive: true,
    });
    await fs.mkdir(path.join(taskPluginRoot, '.claude-plugin'), {
      recursive: true,
    });
    await fs.mkdir(path.join(taskPluginRoot, 'skills', 'task-only'), {
      recursive: true,
    });

    await fs.writeFile(
      path.join(designPluginRoot, '.claude-plugin', 'plugin.json'),
      JSON.stringify(
        {
          name: designPluginName,
          version: '1.0.0',
          description: 'Design plugin',
          skills: 'skills',
          metadata: {
            neuma: {
              surfaces: ['design'],
              designManifest: 'design-plugin.json',
            },
          },
        },
        null,
        2,
      ),
    );
    await fs.writeFile(
      path.join(designPluginRoot, 'design-plugin.json'),
      JSON.stringify(
        {
          designSystems: [
            {
              id: 'nebula',
              path: 'packs/nebula/DESIGN.md',
            },
          ],
        },
        null,
        2,
      ),
    );
    await fs.writeFile(
      path.join(designPluginRoot, 'packs', 'nebula', 'DESIGN.md'),
      '# Nebula System\n\n> Category: Plugin\n\nUse sharp contrast.',
    );
    await fs.writeFile(
      path.join(designPluginRoot, 'packs', 'nebula', 'tokens.css'),
      ':root { --accent: #445566; }',
    );
    await fs.writeFile(
      path.join(designPluginRoot, 'packs', 'nebula', 'components.html'),
      '<button class="primary">Plugin reference</button>',
    );
    await fs.writeFile(
      path.join(designPluginRoot, 'design-systems', 'aurora', 'DESIGN.md'),
      '# Aurora System\n\n> Category: Plugin\n\nUse soft gradients sparingly.',
    );
    await fs.writeFile(
      path.join(designPluginRoot, 'skills', 'prototype', 'SKILL.md'),
      [
        '---',
        'name: prototype',
        'description: Build plugin-backed prototypes.',
        'od:',
        '  surface: prototype',
        '---',
        '',
        'Use the plugin design systems when selected.',
      ].join('\n'),
    );

    await fs.writeFile(
      path.join(taskPluginRoot, '.claude-plugin', 'plugin.json'),
      JSON.stringify(
        {
          name: taskPluginName,
          version: '1.0.0',
          description: 'Task plugin',
          skills: 'skills',
          metadata: {
            neuma: {
              surfaces: ['task'],
            },
          },
        },
        null,
        2,
      ),
    );
    await fs.writeFile(
      path.join(taskPluginRoot, 'skills', 'task-only', 'SKILL.md'),
      [
        '---',
        'name: task-only',
        'description: This is not a design skill.',
        '---',
        '',
        'Do not expose this to Design Mode.',
      ].join('\n'),
    );

    const systems = await listDesignSystems();
    expect(systems.map((system) => system.id)).toEqual(
      expect.arrayContaining([
        `${designPluginName}.nebula`,
        `${designPluginName}.aurora`,
      ]),
    );

    const nebula = await getDesignSystem(`${designPluginName}.nebula`);
    expect(nebula).toMatchObject({
      id: `${designPluginName}.nebula`,
      title: 'Nebula System',
      origin: 'installed',
      editable: false,
      canUninstall: false,
      version: '1.0.0',
      tokenCss: ':root { --accent: #445566; }',
      componentsHtml: '<button class="primary">Plugin reference</button>',
    });

    const skills = await listDesignSkills();
    expect(skills.map((skill) => skill.id)).toContain(
      `${designPluginName}:prototype`,
    );
    expect(skills.map((skill) => skill.id)).not.toContain(
      `${taskPluginName}:task-only`,
    );
  });
});
