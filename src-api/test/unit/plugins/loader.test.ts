import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetBundledSkillsDirCache } from '@/config/constants';

import {
  getPluginLoaderGeneration,
  loadAllSkills,
  loadPluginsFromRoot,
  stopPluginHotReload,
} from '@/shared/plugins';

const tempDirs: string[] = [];

async function createTempPluginRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'neuma-plugin-loader-'));
  tempDirs.push(root);
  const pluginDir = join(root, 'demo-plugin');
  await mkdir(join(pluginDir, '.codex-plugin'), { recursive: true });
  await mkdir(join(pluginDir, 'skills', 'demo-skill'), { recursive: true });
  await writeFile(
    join(pluginDir, '.codex-plugin', 'plugin.json'),
    JSON.stringify({
      name: 'demo-plugin',
      version: '1.0.0',
      description: 'Demo plugin',
      skills: 'skills',
    }),
  );
  return root;
}

describe('plugin loader', () => {
  const originalBundled = process.env.NEUMAR_BUNDLED_SKILLS_DIR;

  beforeEach(() => {
    process.env.NEUMAR_BUNDLED_SKILLS_DIR = '';
    resetBundledSkillsDirCache();
  });

  afterEach(async () => {
    if (originalBundled === undefined) {
      delete process.env.NEUMAR_BUNDLED_SKILLS_DIR;
    } else {
      process.env.NEUMAR_BUNDLED_SKILLS_DIR = originalBundled;
    }
    resetBundledSkillsDirCache();
    await stopPluginHotReload();
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it('parses official skill frontmatter fields and stripped body', async () => {
    const root = await createTempPluginRoot();
    await writeFile(
      join(root, 'demo-plugin', 'skills', 'demo-skill', 'SKILL.md'),
      `---
name: demo
description: > 
  Demo skill
version: 1.2.3
argument-hint: FILE
category: coding
emoji: tool
tags:
  - code
  - review
modes:
  - task
  - video
subcommands:
  - audit
---

Skill body
`,
    );

    const skills = await loadAllSkills({ projectDir: root, watch: false });
    expect(skills).toHaveLength(1);
    expect(skills[0]!.metadata).toMatchObject({
      name: 'demo',
      version: '1.2.3',
      argumentHint: 'FILE',
      category: 'coding',
      emoji: 'tool',
      tags: ['code', 'review'],
      modes: ['task', 'video'],
    });
    expect(skills[0]!.body).toBe('Skill body\n');
  });

  it('loads plugins nested one level under category directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'neuma-plugin-loader-'));
    tempDirs.push(root);

    // Flat plugin directly under the root.
    const flatDir = join(root, 'flat-plugin');
    await mkdir(join(flatDir, '.claude-plugin'), { recursive: true });
    await writeFile(
      join(flatDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'flat-plugin',
        version: '1.0.0',
        description: 'Flat plugin',
      }),
    );

    // Categorized plugin one level down (e.g. video-templates/<plugin>).
    const nestedDir = join(root, 'video-templates', 'nested-plugin');
    await mkdir(join(nestedDir, '.claude-plugin'), { recursive: true });
    await mkdir(join(nestedDir, 'skills', 'nested-skill'), {
      recursive: true,
    });
    await writeFile(
      join(nestedDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'nested-plugin',
        version: '1.0.0',
        description: 'Nested plugin',
        skills: 'skills',
      }),
    );
    await writeFile(
      join(nestedDir, 'skills', 'nested-skill', 'SKILL.md'),
      `---
name: nested-skill
description: Nested skill
---

Body
`,
    );

    // A category dir containing no plugins stays invisible; two levels of
    // nesting is out of contract.
    await mkdir(join(root, 'empty-category', 'too', 'deep-plugin'), {
      recursive: true,
    });

    const plugins = await loadPluginsFromRoot(root, 'bundled');
    expect(plugins.map((p) => p.manifest.name).sort()).toEqual([
      'flat-plugin',
      'nested-plugin',
    ]);
    const nested = plugins.find((p) => p.manifest.name === 'nested-plugin');
    expect(nested?.scope).toBe('bundled');
    expect(nested?.skills.map((s) => s.name)).toEqual([
      'nested-plugin:nested-skill',
    ]);
  });

  it('includes a user/project surface-restricted plugin (explicit opt-in)', async () => {
    // A user-installed plugin declaring a surface still contributes its skills
    // to the agent — only BUNDLED catalog content is withheld. Regression for
    // an enabled Open Design video plugin whose skill was silently dropped.
    const root = await mkdtemp(join(tmpdir(), 'neuma-plugin-loader-'));
    tempDirs.push(root);

    const surfacedDir = join(root, 'video-only');
    await mkdir(join(surfacedDir, '.claude-plugin'), { recursive: true });
    await mkdir(join(surfacedDir, 'skills', 'video-skill'), {
      recursive: true,
    });
    await writeFile(
      join(surfacedDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'video-only',
        version: '1.0.0',
        description: 'Video surface plugin',
        metadata: { neuma: { surfaces: ['video'] } },
      }),
    );
    await writeFile(
      join(surfacedDir, 'skills', 'video-skill', 'SKILL.md'),
      `---
name: video-skill
description: Surface-tagged skill from a user install
---

Body
`,
    );

    const skills = await loadAllSkills({ projectDir: root, watch: false });
    expect(skills.map((s) => s.name)).toContain('video-only:video-skill');
  });

  it('loads an open-design plugin with a root-level SKILL.md via the adapter', async () => {
    const root = await mkdtemp(join(tmpdir(), 'neuma-plugin-loader-'));
    tempDirs.push(root);
    const pluginDir = join(root, 'hallmark');
    await mkdir(pluginDir, { recursive: true });
    // Open Design layout: open-design.json + SKILL.md at the plugin root.
    await writeFile(
      join(pluginDir, 'open-design.json'),
      JSON.stringify({
        $schema: 'https://open-design.ai/schemas/plugin.v1.json',
        specVersion: '1.0.0',
        name: 'community-hallmark',
        title: 'Hallmark',
        version: '1.0.0',
        description: 'Anti-AI-slop design skill.',
        compat: { agentSkills: [{ path: './SKILL.md' }] },
        od: { kind: 'skill', mode: 'prototype' },
      }),
    );
    await writeFile(
      join(pluginDir, 'SKILL.md'),
      `---
name: hallmark
description: Anti-AI-slop design skill
---

Body
`,
    );

    const plugins = await loadPluginsFromRoot(root, 'user');
    const hallmark = plugins.find(
      (p) => p.manifest.name === 'community-hallmark',
    );
    expect(hallmark).toBeDefined();
    expect(hallmark?.manifest.metadata?.neuma?.surfaces).toEqual(['design']);
    // The root SKILL.md is discovered via metadata.neuma.skillFiles.
    expect(hallmark?.skills.map((s) => s.name)).toEqual([
      'community-hallmark:hallmark',
    ]);
  });

  it('skips skills when the manifest skills dir escapes the plugin root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'neuma-plugin-loader-'));
    tempDirs.push(root);
    const pluginDir = join(root, 'escape-plugin');
    await mkdir(join(pluginDir, '.claude-plugin'), { recursive: true });
    await writeFile(
      join(pluginDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'escape-plugin',
        version: '1.0.0',
        description: 'Escaping skills root',
        skills: '../outside',
      }),
    );
    await mkdir(join(root, 'outside', 'stolen-skill'), { recursive: true });
    await writeFile(
      join(root, 'outside', 'stolen-skill', 'SKILL.md'),
      `---
name: stolen-skill
description: Should not load
---

Body
`,
    );

    const plugins = await loadPluginsFromRoot(root, 'user');
    const escapePlugin = plugins.find(
      (p) => p.manifest.name === 'escape-plugin',
    );
    expect(escapePlugin).toBeDefined();
    expect(escapePlugin?.skills).toEqual([]);
  });

  it('loads a bare bundled skill once and lets a higher tier replace it', async () => {
    const bundled = await mkdtemp(join(tmpdir(), 'neuma-bare-bundled-'));
    const app = await mkdtemp(join(tmpdir(), 'neuma-bare-app-'));
    const claude = await mkdtemp(join(tmpdir(), 'neuma-bare-claude-'));
    tempDirs.push(bundled, app, claude);

    async function writeBare(
      root: string,
      name: string,
      body: string,
      modes: string,
    ) {
      const dir = join(root, name);
      await mkdir(join(dir, 'scripts'), { recursive: true });
      await writeFile(join(dir, 'scripts', 'cut.py'), `# ${body}\n`);
      await writeFile(
        join(dir, 'SKILL.md'),
        `---
name: ${name}
description: ${body}
modes:
${modes}
---

${body}
`,
      );
    }

    await writeBare(
      bundled,
      'ffmpeg',
      'bundled ffmpeg',
      '  - task\n  - design\n  - video',
    );
    await writeBare(bundled, 'other', 'bundled other', '  - task');
    await writeBare(join(app, 'skills'), 'ffmpeg', 'app ffmpeg', '  - task');
    await writeBare(
      join(claude, '.claude', 'skills'),
      'other',
      'claude other',
      '  - video',
    );

    process.env.NEUMAR_BUNDLED_SKILLS_DIR = bundled;
    process.env.NEUMAR_APP_DATA_DIR = app;
    resetBundledSkillsDirCache();
    const home = process.env.HOME;
    process.env.HOME = claude;

    try {
      const skills = await loadAllSkills({ watch: false });
      const ffmpeg = skills.filter((skill) => skill.bareName === 'ffmpeg');
      const other = skills.filter((skill) => skill.bareName === 'other');

      expect(ffmpeg).toHaveLength(1);
      expect(ffmpeg[0]).toMatchObject({
        name: 'ffmpeg',
        bareName: 'ffmpeg',
        plugin: null,
        path: join(app, 'skills', 'ffmpeg'),
        metadata: { modes: ['task'] },
      });
      expect(other).toHaveLength(1);
      expect(other[0]).toMatchObject({
        name: 'other',
        plugin: null,
        path: join(claude, '.claude', 'skills', 'other'),
        metadata: { modes: ['video'] },
      });
    } finally {
      if (home === undefined) delete process.env.HOME;
      else process.env.HOME = home;
      delete process.env.NEUMAR_APP_DATA_DIR;
    }
  });

  it('invalidates loader generation when watched skill files change', async () => {
    const root = await createTempPluginRoot();
    const skillPath = join(
      root,
      'demo-plugin',
      'skills',
      'demo-skill',
      'SKILL.md',
    );
    await writeFile(
      skillPath,
      `---
name: demo
description: Demo skill
---

Initial
`,
    );

    await loadAllSkills({ projectDir: root, watch: true });
    const before = getPluginLoaderGeneration();
    await writeFile(
      skillPath,
      `---
name: demo
description: Demo skill changed
---

Updated
`,
    );

    // Poll for the watcher → debounce → invalidate chain to complete.
    // chokidar's awaitWriteFinish (250ms) + debounce (250ms) plus CI FS jitter
    // means a fixed sleep is flaky; wait up to ~5s instead.
    const deadline = Date.now() + 5000;
    while (getPluginLoaderGeneration() === before && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(getPluginLoaderGeneration()).toBeGreaterThan(before);
  }, 10_000);
});
