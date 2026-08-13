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
import { pluginConfigSecretName } from '@/shared/plugins/config';
import { applyTaskPlugin } from '@/shared/plugins/task';
import { storeSecret } from '@/shared/security/secrets';

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

describe('applyTaskPlugin', () => {
  it('builds a redacted task snapshot and prompt context from plugin-local skills', async () => {
    const suffix = randomUUID().slice(0, 8);
    const pluginName = `task-helper-${suffix}`;
    const pluginId = `user/${pluginName}`;
    const pluginDir = join(tmpdir(), `${pluginName}-${randomUUID()}`);
    tempDirs.push(pluginDir);

    await mkdir(join(pluginDir, '.claude-plugin'), { recursive: true });
    await mkdir(join(pluginDir, 'skills', 'review'), { recursive: true });

    const manifest = {
      name: pluginName,
      version: '1.0.0',
      description: 'Task helper plugin',
      skills: 'skills',
      metadata: {
        neuma: {
          surfaces: ['task'],
          taskManifest: 'task-plugin.json',
          configSchema: [
            {
              key: 'mode',
              type: 'enum',
              options: [
                { label: 'Fast', value: 'fast' },
                { label: 'Careful', value: 'careful' },
              ],
              default: 'fast',
            },
            {
              key: 'apiToken',
              type: 'secret',
              sensitive: true,
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
      join(pluginDir, 'task-plugin.json'),
      JSON.stringify(
        {
          title: 'DAV task flow',
          description: 'Drive task work through a plugin-defined flow.',
          promptGuide: 'Use the DAV review checklist before changing files.',
          skills: ['review'],
          capabilities: ['fs:write'],
          pipeline: {
            stages: [
              {
                id: 'review',
                title: 'Review',
                instructions: 'Inspect inputs before implementation.',
                skills: ['review'],
              },
            ],
          },
        },
        null,
        2,
      ),
    );
    await writeFile(
      join(pluginDir, 'skills', 'review', 'SKILL.md'),
      [
        '---',
        'name: review',
        'description: Review task inputs before editing.',
        '---',
        '',
        'Prefer plugin-local guidance over generic defaults.',
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
      key: 'mode',
      value: 'careful',
    });
    const secretName = pluginConfigSecretName(pluginId, 'apiToken');
    await storeSecret(secretName, 'super-secret-token');
    upsertPluginConfigValue({
      pluginId,
      key: 'apiToken',
      secretName,
      sensitive: true,
    });

    const applied = await applyTaskPlugin(pluginId, {
      inputs: { topic: 'plugin architecture' },
      createdAt: '2026-07-04T12:00:00.000Z',
    });

    expect(applied.pinnedSkills).toEqual([`${pluginName}:review`]);
    expect(applied.snapshot.domain).toBe('task');
    expect(applied.snapshot.plugin).toMatchObject({
      id: pluginId,
      name: pluginName,
      version: '1.0.0',
      trustTier: 'local',
    });
    expect(applied.snapshot.payload.promptGuide).toContain(
      'DAV review checklist',
    );
    expect(applied.snapshot.payload.skills[0]).toMatchObject({
      name: `${pluginName}:review`,
      bareName: 'review',
    });
    expect(applied.snapshot.payload.skills[0]?.body).toContain(
      'Prefer plugin-local guidance',
    );
    expect(applied.snapshot.payload.deniedCapabilities).toContain('fs:write');
    expect(applied.snapshot.config).toMatchObject({
      keys: ['apiToken', 'mode'],
      sensitiveKeys: ['apiToken'],
      publicValues: { mode: 'careful' },
    });
    expect(JSON.stringify(applied.snapshot)).not.toContain(
      'super-secret-token',
    );
    expect(applied.systemContext).toContain(
      'Active Task Plugin: DAV task flow',
    );
    expect(applied.systemContext).toContain(
      `<plugin-skill name="${pluginName}:review">`,
    );
    expect(applied.systemContext).toContain('"topic": "plugin architecture"');
    expect(applied.systemContext).not.toContain('super-secret-token');
  });
});
