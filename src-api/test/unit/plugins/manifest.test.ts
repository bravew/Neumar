import { describe, expect, it } from 'vitest';

import {
  parseManifest,
  PLUGIN_NAME_RE,
  SEMVER_RE,
} from '@/shared/plugins/manifest';

describe('PluginManifestSchema', () => {
  const valid = {
    name: 'demo-plugin',
    version: '1.2.3',
    description: 'A demo plugin',
  };

  it('accepts the minimal valid manifest', () => {
    const result = parseManifest(JSON.stringify(valid));
    expect(result.ok).toBe(true);
    expect(result.manifest?.name).toBe('demo-plugin');
    // skills root defaults to "skills" when not specified
    expect(result.manifest?.skills).toBe('skills');
  });

  it('rejects names that are not lower-kebab-case', () => {
    const bad = parseManifest(JSON.stringify({ ...valid, name: 'BadName' }));
    expect(bad.ok).toBe(false);
    expect(bad.issues.join(' ')).toMatch(/lower-kebab-case/);
  });

  it('rejects non-semver versions', () => {
    const bad = parseManifest(JSON.stringify({ ...valid, version: '1.2' }));
    expect(bad.ok).toBe(false);
    expect(bad.issues.join(' ')).toMatch(/semver/);
  });

  it('accepts pre-release semver', () => {
    const ok = parseManifest(
      JSON.stringify({ ...valid, version: '1.2.3-beta.1' }),
    );
    expect(ok.ok).toBe(true);
  });

  it('defaults a missing version to 0.0.0 (Claude Code allows omitting it)', () => {
    const withoutVersion = { ...valid } as Record<string, unknown>;
    delete withoutVersion.version;
    const result = parseManifest(JSON.stringify(withoutVersion));
    expect(result.ok).toBe(true);
    expect(result.manifest?.version).toBe('0.0.0');
  });

  it('accepts an author object with email', () => {
    const ok = parseManifest(
      JSON.stringify({
        ...valid,
        author: { name: 'Anna', email: 'anna@example.com' },
      }),
    );
    expect(ok.ok).toBe(true);
  });

  it('rejects unknown top-level keys (.strict())', () => {
    const bad = parseManifest(JSON.stringify({ ...valid, junk: true }));
    expect(bad.ok).toBe(false);
  });

  it('passes through unknown metadata sub-keys', () => {
    const ok = parseManifest(
      JSON.stringify({
        ...valid,
        metadata: { vendor: { foo: 'bar' } },
      }),
    );
    expect(ok.ok).toBe(true);
  });

  it('accepts metadata.neuma.requires.anyBins', () => {
    const ok = parseManifest(
      JSON.stringify({
        ...valid,
        metadata: { neuma: { requires: { anyBins: ['ffmpeg', 'rg'] } } },
      }),
    );
    expect(ok.ok).toBe(true);
  });

  it('accepts Neuma surface targeting and video manifest pointers', () => {
    const ok = parseManifest(
      JSON.stringify({
        ...valid,
        metadata: {
          neuma: {
            surfaces: ['video'],
            videoManifest: 'video-plugin.json',
          },
        },
      }),
    );
    expect(ok.ok).toBe(true);
    expect(ok.manifest?.metadata?.neuma?.surfaces).toEqual(['video']);
    expect(ok.manifest?.metadata?.neuma?.videoManifest).toBe(
      'video-plugin.json',
    );
  });

  it('rejects domain manifest pointers that escape the plugin folder', () => {
    const bad = parseManifest(
      JSON.stringify({
        ...valid,
        metadata: {
          neuma: {
            surfaces: ['video'],
            videoManifest: '../video-plugin.json',
          },
        },
      }),
    );
    expect(bad.ok).toBe(false);
    expect(bad.issues.join(' ')).toMatch(/plugin-relative/);
  });

  it('accepts metadata.neuma.configSchema fields', () => {
    const ok = parseManifest(
      JSON.stringify({
        ...valid,
        metadata: {
          neuma: {
            configSchema: [
              {
                key: 'apiToken',
                type: 'secret',
                label: 'API token',
                sensitive: true,
                order: 1,
              },
              {
                key: 'mode',
                type: 'enum',
                options: [
                  { label: 'Fast', value: 'fast' },
                  { label: 'Careful', value: 'careful' },
                ],
                default: 'fast',
              },
            ],
          },
        },
      }),
    );
    expect(ok.ok).toBe(true);
    expect(ok.manifest?.metadata?.neuma?.configSchema).toHaveLength(2);
  });

  it('returns a useful issue list on invalid JSON', () => {
    const bad = parseManifest('{ not valid json');
    expect(bad.ok).toBe(false);
    expect(bad.issues[0]).toMatch(/Invalid JSON/);
  });
});

describe('regex sanity', () => {
  it('PLUGIN_NAME_RE accepts the standard shape', () => {
    expect(PLUGIN_NAME_RE.test('foo')).toBe(true);
    expect(PLUGIN_NAME_RE.test('foo-bar')).toBe(true);
    expect(PLUGIN_NAME_RE.test('foo_bar')).toBe(false);
    expect(PLUGIN_NAME_RE.test('Foo')).toBe(false);
  });

  it('PLUGIN_NAME_RE rejects path and traversal shaped names', () => {
    for (const unsafeName of [
      '../demo',
      '.demo',
      'demo.plugin',
      'demo/skill',
      'demo\\skill',
      'demo%2fskill',
    ]) {
      expect(PLUGIN_NAME_RE.test(unsafeName)).toBe(false);
      expect(
        parseManifest(
          JSON.stringify({
            name: unsafeName,
            version: '1.2.3',
            description: 'A demo plugin',
          }),
        ).ok,
      ).toBe(false);
    }
  });

  it('SEMVER_RE accepts valid semver and rejects partial', () => {
    expect(SEMVER_RE.test('1.0.0')).toBe(true);
    expect(SEMVER_RE.test('0.0.0-beta.1')).toBe(true);
    expect(SEMVER_RE.test('1.0.0+build.5')).toBe(true);
    expect(SEMVER_RE.test('1.0')).toBe(false);
    expect(SEMVER_RE.test('v1.0.0')).toBe(false);
  });
});
