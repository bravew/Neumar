import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('DesignMode DTCG tokens', () => {
  let tempHome = '';
  let workDir = '';

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-dtcg-home-'));
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-dtcg-work-'));
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

  it('imports DTCG JSON as an installed design system with CSS and Tailwind bindings', async () => {
    const { designSystemTokensToDtcgDocument, importDtcgDesignSystem } =
      await import('@/shared/services/design-mode/dtcg-tokens');

    const designSystem = await importDtcgDesignSystem({
      id: 'brand-kit',
      title: 'Brand Kit',
      document: {
        color: {
          $type: 'color',
          accent: {
            $value: '#123456',
            $description: 'Primary action color',
            $extensions: { neuma: { cssName: '--accent' } },
          },
          accentHover: {
            $value: '{color.accent}',
            $extensions: { neuma: { cssName: '--accent-hover' } },
          },
        },
        space: {
          $type: 'dimension',
          4: {
            $value: { value: 16, unit: 'px' },
            $extensions: { neuma: { cssName: '--space-4' } },
          },
        },
      },
    });

    expect(designSystem).toMatchObject({
      id: 'brand-kit',
      title: 'Brand Kit',
      origin: 'installed',
      editable: true,
    });

    const root = path.join(workDir, '.neuma/design-systems/brand-kit');
    const css = await fs.readFile(path.join(root, 'tokens.css'), 'utf-8');
    expect(css).toContain('--accent: #123456;');
    expect(css).toContain('--accent-hover: var(--accent);');
    expect(css).toContain('--space-4: 16px;');
    expect(css).toContain('@theme');
    expect(css).toContain('--color-accent: var(--accent);');
    expect(css).toContain('--spacing-4: var(--space-4);');

    const snapshot = JSON.parse(
      await fs.readFile(path.join(root, 'tokens.dtcg.json'), 'utf-8'),
    ) as {
      color: {
        accent: { $extensions: { neuma: { cssName: string } } };
      };
    };
    expect(snapshot.color.accent.$extensions.neuma.cssName).toBe('--accent');

    const exported = designSystemTokensToDtcgDocument(designSystem) as {
      color: {
        accent: { $value: string };
        'accent-hover': { $value: string };
      };
    };
    expect(exported.color.accent.$value).toBe('#123456');
    expect(exported.color['accent-hover'].$value).toBe('{color.accent}');
  });

  it('exposes DTCG import and export routes', async () => {
    const { designRoutes } = await import('@/app/api/design');

    const imported = await designRoutes.request('/design-systems/import/dtcg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'route-kit',
        title: 'Route Kit',
        tokens: {
          color: {
            $type: 'color',
            accent: {
              $value: '#abcdef',
              $extensions: { neuma: { cssName: '--accent' } },
            },
          },
        },
      }),
    });

    expect(imported.status).toBe(201);
    await expect(imported.json()).resolves.toMatchObject({
      designSystem: { id: 'route-kit', title: 'Route Kit' },
    });

    const exported = await designRoutes.request(
      '/design-systems/route-kit/tokens.dtcg.json',
    );
    expect(exported.status).toBe(200);
    expect(exported.headers.get('content-disposition')).toContain(
      'route-kit.tokens.dtcg.json',
    );
    const body = (await exported.json()) as {
      color: { accent: { $value: string } };
    };
    expect(body.color.accent.$value).toBe('#abcdef');
  });

  it('rejects unknown aliases, alias cycles, and unsafe CSS values', async () => {
    const { normalizeDtcgTokens } =
      await import('@/shared/services/design-mode/dtcg-tokens');

    expect(() =>
      normalizeDtcgTokens({
        color: {
          a: { $value: '{color.missing}' },
        },
      }),
    ).toThrow(/Unknown DTCG alias/);

    expect(() =>
      normalizeDtcgTokens({
        color: {
          a: { $value: '{color.b}' },
          b: { $value: '{color.a}' },
        },
      }),
    ).toThrow(/DTCG alias cycle/);

    expect(() =>
      normalizeDtcgTokens({
        color: {
          accent: { $value: 'url(https://example.com/image.png)' },
        },
      }),
    ).toThrow(/Unsafe CSS token value/);

    expect(() =>
      normalizeDtcgTokens({
        color: {
          accent: { $value: 'var(--missing)' },
        },
      }),
    ).toThrow(/DTCG aliases must use/);

    expect(() =>
      normalizeDtcgTokens({
        color: {
          accent: {
            $value: '#123456',
            $extensions: { neuma: { cssName: '--bad;name' } },
          },
        },
      }),
    ).toThrow(/Invalid CSS custom property name/);
  });
});
