import { describe, expect, it } from 'vitest';

import {
  buildEffectivePluginConfig,
  buildPublicPluginConfig,
  pluginConfigSecretName,
  validatePluginConfigPatch,
  type StoredPluginConfigValue,
} from '@/shared/plugins/config';
import { parseManifest, type PluginManifest } from '@/shared/plugins/manifest';

function configManifest(): PluginManifest {
  const result = parseManifest(
    JSON.stringify({
      name: 'demo-plugin',
      version: '1.0.0',
      description: 'Demo plugin',
      metadata: {
        neuma: {
          configSchema: [
            {
              key: 'apiToken',
              type: 'secret',
              label: 'API token',
              sensitive: true,
              required: true,
            },
            {
              key: 'mode',
              type: 'enum',
              default: 'fast',
              options: [
                { label: 'Fast', value: 'fast' },
                { label: 'Careful', value: 'careful' },
              ],
            },
            {
              key: 'retries',
              type: 'number',
              default: 2,
            },
            {
              key: 'enabled',
              type: 'boolean',
              default: true,
            },
            {
              key: 'notes',
              type: 'string',
            },
          ],
        },
      },
    }),
  );
  if (!result.ok || !result.manifest) {
    throw new Error(result.issues.join(', '));
  }
  return result.manifest;
}

describe('plugin configuration helpers', () => {
  it('coerces supported config patch values', () => {
    const result = validatePluginConfigPatch(configManifest(), {
      apiToken: 'secret-value',
      enabled: 'false',
      mode: 'careful',
      retries: '3',
      notes: null,
    });

    expect(result.ok).toBe(true);
    expect(result.entries).toMatchObject([
      { key: 'apiToken', value: 'secret-value', remove: false },
      { key: 'enabled', value: false, remove: false },
      { key: 'mode', value: 'careful', remove: false },
      { key: 'retries', value: 3, remove: false },
      { key: 'notes', value: null, remove: true },
    ]);
  });

  it('rejects unknown fields and invalid enum values', () => {
    const result = validatePluginConfigPatch(configManifest(), {
      mode: 'reckless',
      unknown: true,
    });

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        'mode: must match an enum option',
        'unknown: unknown config field',
      ]),
    );
  });

  it('redacts public secrets and resolves effective values on demand', () => {
    const manifest = configManifest();
    const secretName = pluginConfigSecretName('user/demo-plugin', 'apiToken');
    const stored: StoredPluginConfigValue[] = [
      {
        key: 'apiToken',
        value: null,
        secretName,
        sensitive: true,
        updatedAt: '2026-07-04T00:00:00.000Z',
      },
      {
        key: 'mode',
        value: 'careful',
        secretName: null,
        sensitive: false,
        updatedAt: '2026-07-04T00:00:00.000Z',
      },
    ];

    const publicConfig = buildPublicPluginConfig(
      manifest,
      stored,
      new Map([[secretName, 'abcd']]),
    );
    const token = publicConfig.find((field) => field.key === 'apiToken');
    expect(token).toMatchObject({
      hasSecret: true,
      hasValue: true,
      secretHint: 'abcd',
      value: undefined,
    });

    expect(
      buildEffectivePluginConfig(manifest, stored, (name) =>
        name === secretName ? 'resolved-token' : null,
      ),
    ).toEqual({
      apiToken: 'resolved-token',
      mode: 'careful',
      retries: 2,
      enabled: true,
    });
  });
});
