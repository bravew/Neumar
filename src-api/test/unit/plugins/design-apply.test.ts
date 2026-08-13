import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { closeDatabase } from '@/shared/db';
import {
  upsertInstalledPlugin,
  upsertPluginConfigValue,
} from '@/shared/db/plugins';
import { applyDesignPlugin } from '@/shared/plugins/design';

const tempDirs: string[] = [];

afterEach(async () => {
  closeDatabase();
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      rm(dir, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe('applyDesignPlugin', () => {
  it('builds a design snapshot from plugin systems and local skills', async () => {
    const suffix = randomUUID().slice(0, 8);
    const pluginName = `design-helper-${suffix}`;
    const pluginId = `user/${pluginName}`;
    const pluginDir = join(tmpdir(), `${pluginName}-${randomUUID()}`);
    tempDirs.push(pluginDir);

    await mkdir(join(pluginDir, '.claude-plugin'), { recursive: true });
    await mkdir(join(pluginDir, 'packs', 'nebula'), { recursive: true });
    await mkdir(join(pluginDir, 'design-systems', 'aurora'), {
      recursive: true,
    });
    await mkdir(join(pluginDir, 'skills', 'prototype'), { recursive: true });

    const manifest = {
      name: pluginName,
      version: '1.0.0',
      description: 'Design helper plugin',
      skills: 'skills',
      metadata: {
        neuma: {
          surfaces: ['design'],
          designManifest: 'design-plugin.json',
          configSchema: [
            {
              key: 'density',
              type: 'enum',
              options: [
                { label: 'Compact', value: 'compact' },
                { label: 'Spacious', value: 'spacious' },
              ],
              default: 'compact',
            },
          ],
        },
      },
    };

    await writeFile(
      join(pluginDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify(manifest, null, 2),
    );
    await writeFile(
      join(pluginDir, 'design-plugin.json'),
      JSON.stringify(
        {
          title: 'Design helper flow',
          promptGuide: 'Apply the plugin design systems before composing UI.',
          skills: ['prototype'],
          capabilities: ['fs:write'],
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
    await writeFile(
      join(pluginDir, 'packs', 'nebula', 'DESIGN.md'),
      '# Nebula System\n\n> Category: Plugin\n\nUse sharp contrast.',
    );
    await writeFile(
      join(pluginDir, 'packs', 'nebula', 'tokens.css'),
      ':root { --accent: #445566; }',
    );
    await writeFile(
      join(pluginDir, 'design-systems', 'aurora', 'DESIGN.md'),
      '# Aurora System\n\n> Category: Plugin\n\nUse quiet motion.',
    );
    await writeFile(
      join(pluginDir, 'skills', 'prototype', 'SKILL.md'),
      [
        '---',
        'name: prototype',
        'description: Build plugin-backed prototypes.',
        '---',
        '',
        'Prefer the plugin design system over generic defaults.',
      ].join('\n'),
    );

    upsertInstalledPlugin({
      id: pluginId,
      name: pluginName,
      version: '1.0.0',
      source: 'local',
      installPath: pluginDir,
      scope: 'user',
      enabled: true,
      manifest,
      trustTier: 'local',
    });
    upsertPluginConfigValue({
      pluginId,
      key: 'density',
      value: 'spacious',
    });

    const applied = await applyDesignPlugin(pluginId, {
      inputs: { surface: 'prototype' },
      createdAt: '2026-07-04T12:00:00.000Z',
    });

    expect(applied.pinnedSkills).toEqual([`${pluginName}:prototype`]);
    expect(applied.snapshot.domain).toBe('design');
    expect(applied.snapshot.payload.promptGuide).toContain(
      'plugin design systems',
    );
    expect(applied.snapshot.payload.designSystems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'nebula',
          title: 'Nebula System',
          tokenCss: ':root { --accent: #445566; }',
        }),
        expect.objectContaining({
          id: 'aurora',
          title: 'Aurora System',
        }),
      ]),
    );
    expect(applied.snapshot.payload.skills[0]).toMatchObject({
      name: `${pluginName}:prototype`,
      bareName: 'prototype',
    });
    expect(applied.snapshot.payload.deniedCapabilities).toContain('fs:write');
    expect(applied.snapshot.config).toMatchObject({
      keys: ['density'],
      publicValues: { density: 'spacious' },
    });
    expect(applied.systemContext).toContain(
      'Active Design Plugin: Design helper flow',
    );
    expect(applied.systemContext).toContain(
      `<plugin-skill name="${pluginName}:prototype">`,
    );
    expect(applied.systemContext).toContain('"surface": "prototype"');
  });
});
