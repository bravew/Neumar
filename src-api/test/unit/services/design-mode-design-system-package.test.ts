import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  validateGeneratedDesignSystemPackage,
  type DesignSystemPackageValidationIssue,
} from '@/shared/services/design-mode/design-system-package';

describe('DesignMode generated design-system package validation', () => {
  let tempRoot = '';

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-ds-package-'));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('accepts a generated package that matches the Neuma catalog contract', async () => {
    const root = await writePackage('brand-kit', {
      manifest: validManifest('brand-kit'),
      tokensCss: [
        ':root {',
        '  --accent: #123456;',
        '}',
        '@theme {',
        '  --color-accent: var(--accent);',
        '}',
      ].join('\n'),
      designTokensJson: {
        color: {
          accent: {
            $type: 'color',
            $value: '#123456',
            $extensions: { neuma: { cssName: '--accent' } },
          },
        },
      },
    });

    const report = await validateGeneratedDesignSystemPackage(root);

    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.manifest).toMatchObject({
      id: 'brand-kit',
      name: 'Brand Kit',
      schemaVersion: 'neuma-design-system-package/v1',
    });
    expect(report.files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        'DESIGN.md',
        'manifest.json',
        'tokens.css',
        'components.html',
        'design-tokens.json',
        'USAGE.md',
        'source/evidence.md',
      ]),
    );
  });

  it('reports invalid identity, missing provenance, and token sidecar issues', async () => {
    const root = await writePackage('brand-kit', {
      manifest: {
        ...validManifest('wrong-kit'),
        description: '',
        files: { design: 'README.md' },
        source: {},
      },
      tokensCss: 'body { color: red; }',
      designTokensJson: {},
      omitEvidence: true,
    });

    const report = await validateGeneratedDesignSystemPackage(root, {
      expectedId: 'brand-kit',
    });

    expect(report.ok).toBe(false);
    expect(issueCodes(report.issues)).toEqual(
      expect.arrayContaining([
        'manifest_id_mismatch',
        'missing_manifest_description',
        'manifest_file_mismatch',
        'missing_manifest_source',
        'missing_required_file',
        'missing_css_tokens',
        'empty_design_tokens',
      ]),
    );
  });

  it('accepts the curated bundled package schema for existing systems', async () => {
    const bundledRoot = path.resolve('plugins/builtin/design-systems/default');

    const report = await validateGeneratedDesignSystemPackage(bundledRoot, {
      expectedId: 'default',
    });

    expect(report.ok).toBe(true);
    expect(report.manifest?.schemaVersion).toBe('od-design-system-project/v1');
  });

  async function writePackage(
    id: string,
    options: {
      designTokensJson: unknown;
      manifest: Record<string, unknown>;
      omitEvidence?: boolean;
      tokensCss: string;
    },
  ) {
    const root = path.join(tempRoot, id);
    await fs.mkdir(path.join(root, 'source'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'DESIGN.md'),
      '# Brand Kit\n\n> Category: Generated\n> Generated from approved references.\n',
    );
    await fs.writeFile(
      path.join(root, 'manifest.json'),
      JSON.stringify(options.manifest, null, 2),
    );
    await fs.writeFile(path.join(root, 'tokens.css'), options.tokensCss);
    await fs.writeFile(
      path.join(root, 'components.html'),
      '<section><button>Action</button></section>',
    );
    await fs.writeFile(
      path.join(root, 'design-tokens.json'),
      JSON.stringify(options.designTokensJson, null, 2),
    );
    await fs.writeFile(
      path.join(root, 'USAGE.md'),
      'Use the generated tokens.',
    );
    if (!options.omitEvidence) {
      await fs.writeFile(
        path.join(root, 'source/evidence.md'),
        'Generated from user-provided brand references.',
      );
    }
    return root;
  }
});

function validManifest(id: string) {
  return {
    schemaVersion: 'neuma-design-system-package/v1',
    id,
    name: 'Brand Kit',
    category: 'Generated',
    description: 'Generated brand design-system package.',
    source: {
      type: 'generated_brand',
      origin: 'User-provided references',
    },
    files: {
      design: 'DESIGN.md',
      tokens: 'tokens.css',
      components: 'components.html',
      designTokens: 'design-tokens.json',
    },
  };
}

function issueCodes(issues: DesignSystemPackageValidationIssue[]) {
  return issues.map((issue) => issue.code);
}
