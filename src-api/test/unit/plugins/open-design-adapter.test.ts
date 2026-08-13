import { describe, expect, it } from 'vitest';

import {
  adaptOpenDesignManifest,
  adaptOpenDesignMarketplace,
  isOpenDesignManifest,
  isOpenDesignMarketplace,
  parseOpenDesignSource,
} from '@/shared/plugins/adapters/open-design';
import { parseManifest } from '@/shared/plugins/manifest';
import { parseMarketplace } from '@/shared/plugins/marketplace-schema';

describe('open design manifest adapter', () => {
  const odManifest = {
    $schema: 'https://open-design.ai/schemas/plugin.v1.json',
    specVersion: '1.0.0',
    name: 'code-import',
    title: 'Code import',
    version: '0.1.0',
    description: 'Read a repo structure into the project cwd.',
    license: 'MIT',
    author: { name: 'Open Design', url: 'https://github.com/nexu-io' },
    tags: ['atom', 'first-party'],
    compat: { agentSkills: [{ path: './SKILL.md' }] },
    od: {
      kind: 'atom',
      mode: 'import',
      capabilities: ['prompt:inject', 'fs:read'],
    },
  };

  it('detects open-design manifests', () => {
    expect(isOpenDesignManifest(odManifest)).toBe(true);
    expect(
      isOpenDesignManifest({ name: 'x', version: '1.0.0', description: 'y' }),
    ).toBe(false);
  });

  it('adapts to a valid Neuma manifest with design surface and skill files', () => {
    const adapted = adaptOpenDesignManifest(odManifest);
    const result = parseManifest(JSON.stringify(adapted));
    expect(result.issues).toEqual([]);
    expect(result.manifest?.name).toBe('code-import');
    expect(result.manifest?.displayName).toBe('Code import');
    expect(result.manifest?.metadata?.neuma?.surfaces).toEqual(['design']);
    expect(result.manifest?.metadata?.neuma?.skillFiles).toEqual(['.']);
  });

  it('parseManifest transparently adapts open-design json', () => {
    const result = parseManifest(JSON.stringify(odManifest));
    expect(result.ok).toBe(true);
    expect(result.manifest?.metadata?.neuma?.skillFiles).toEqual(['.']);
  });

  it('maps video modes to the video surface', () => {
    const adapted = adaptOpenDesignManifest({
      ...odManifest,
      od: { mode: 'video' },
    });
    const result = parseManifest(JSON.stringify(adapted));
    expect(result.manifest?.metadata?.neuma?.surfaces).toEqual(['video']);
  });

  it('clamps a long description so verbose plugins still validate', () => {
    // Open Design descriptions routinely exceed the old 500-char cap.
    const longDescription = 'x'.repeat(3000);
    const adapted = adaptOpenDesignManifest({
      ...odManifest,
      description: longDescription,
    });
    const result = parseManifest(JSON.stringify(adapted));
    expect(result.ok).toBe(true);
    expect(result.manifest!.description.length).toBeLessThanOrEqual(2000);
  });

  it('accepts a native manifest with a 900-char description (raised cap)', () => {
    const result = parseManifest(
      JSON.stringify({
        name: 'verbose',
        version: '1.0.0',
        description: 'y'.repeat(900),
      }),
    );
    expect(result.ok).toBe(true);
  });
});

describe('open design marketplace adapter', () => {
  const odCatalog = {
    $schema: 'https://open-design.ai/schemas/marketplace.v1.json',
    specVersion: '1.0.0',
    name: 'open-design-official',
    version: '0.1.0',
    owner: { name: 'Open Design', url: 'https://open-design.ai' },
    trust: 'official',
    plugins: [
      {
        name: 'open-design/build-test',
        title: 'Build test',
        version: '0.1.0',
        source:
          'github:nexu-io/open-design@main/plugins/_official/atoms/build-test',
        description: 'Run build / typecheck / lint / test.',
        capabilitiesSummary: ['prompt:inject', 'subprocess'],
        tags: ['atom', 'first-party'],
        license: 'MIT',
        mode: 'critique',
      },
    ],
  };

  it('detects open-design catalogs', () => {
    expect(isOpenDesignMarketplace(odCatalog)).toBe(true);
    expect(isOpenDesignMarketplace({ name: 'x', plugins: [] })).toBe(false);
  });

  it('parses the github:owner/repo@ref/subdir source form', () => {
    expect(
      parseOpenDesignSource(
        'github:nexu-io/open-design@main/plugins/_official/atoms/build-test',
      ),
    ).toEqual({
      source: 'github',
      repo: 'nexu-io/open-design',
      ref: 'main',
      path: 'plugins/_official/atoms/build-test',
    });
    expect(parseOpenDesignSource('github:owner/repo')).toEqual({
      source: 'github',
      repo: 'owner/repo',
    });
  });

  it('adapts to a valid Neuma marketplace with normalized sources', () => {
    const adapted = adaptOpenDesignMarketplace(odCatalog);
    const result = parseMarketplace(JSON.stringify(adapted));
    expect(result.issues).toEqual([]);
    const entry = result.marketplace?.plugins[0];
    expect(entry?.name).toBe('open-design/build-test');
    expect(entry?.displayName).toBe('Build test');
    expect(entry?.source).toMatchObject({
      source: 'github',
      repo: 'nexu-io/open-design',
      path: 'plugins/_official/atoms/build-test',
    });
    expect(
      (entry as { metadata?: { neuma?: { capabilitiesSummary?: string[] } } })
        .metadata?.neuma?.capabilitiesSummary,
    ).toEqual(['prompt:inject', 'subprocess']);
  });
});
