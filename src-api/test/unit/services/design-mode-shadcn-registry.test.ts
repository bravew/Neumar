import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  safeFetch: vi.fn(),
}));

vi.mock('@/shared/network-policy/fetch', () => ({
  safeFetch: mocks.safeFetch,
}));

describe('DesignMode shadcn registry importer', () => {
  let tempHome = '';
  let workDir = '';

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-shadcn-home-'));
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-shadcn-work-'));
    vi.stubEnv('HOME', tempHome);
    mocks.safeFetch.mockReset();
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

  it('imports a shadcn registry item as an installed design system', async () => {
    const { importShadcnRegistryDesignSystem } =
      await import('@/shared/services/design-mode/shadcn-registry');
    mocks.safeFetch.mockResolvedValueOnce(registryResponse(shadcnRegistryItem));

    const designSystem = await importShadcnRegistryDesignSystem({
      url: 'https://registry.example.com/button.json?token=opaque',
    });

    expect(designSystem).toMatchObject({
      id: 'brand-button',
      title: 'Brand Button',
      category: 'Imported',
      origin: 'installed',
      editable: true,
    });
    expect(mocks.safeFetch).toHaveBeenCalledTimes(1);
    const [url, policy, options] = mocks.safeFetch.mock.calls[0]!;
    expect(url).toBe('https://registry.example.com/button.json?token=opaque');
    expect(policy).toMatchObject({
      egress: [expect.objectContaining({ ports: [443] })],
    });
    expect(options).toMatchObject({
      method: 'GET',
      headers: { accept: 'application/json' },
      maxRedirects: 3,
      maxBytes: 1_000_000,
    });

    const root = path.join(workDir, '.neuma/design-systems/brand-button');
    const meta = JSON.parse(
      await fs.readFile(path.join(root, 'meta.json'), 'utf-8'),
    ) as { sourceUrl: string; requestedUrl: string; sourceKind: string };
    expect(meta).toMatchObject({
      sourceKind: 'shadcn-registry',
      sourceUrl: 'https://registry.example.com/button.json?redacted',
      requestedUrl: 'https://registry.example.com/button.json?redacted',
    });

    const css = await fs.readFile(path.join(root, 'tokens.css'), 'utf-8');
    expect(css).toContain('--brand: #123456;');
    expect(css).toContain('--color-brand: var(--brand);');
    expect(css).toContain('.dark {');
    expect(css).toContain('--brand: #abcdef;');
    expect(css).toContain('--font-heading: Inter, sans-serif;');
    expect(css).toContain('@layer base');

    const markdown = await fs.readFile(path.join(root, 'DESIGN.md'), 'utf-8');
    expect(markdown).toContain('imported from a shadcn registry item');
    expect(markdown).toContain('registry:ui');

    const componentsHtml = await fs.readFile(
      path.join(root, 'components.html'),
      'utf-8',
    );
    expect(componentsHtml).toContain('components/ui/button.tsx');
    expect(componentsHtml).toContain(
      '&lt;button className=&quot;btn&quot;&gt;',
    );
  });

  it('exposes a route that selects an item from a registry root', async () => {
    const { designRoutes } = await import('@/app/api/design');
    mocks.safeFetch.mockResolvedValueOnce(
      registryResponse({
        name: 'acme',
        items: [
          shadcnRegistryItem,
          {
            ...shadcnRegistryItem,
            name: 'brand-card',
            title: 'Brand Card',
          },
        ],
      }),
    );

    const response = await designRoutes.request(
      '/design-systems/import/shadcn-registry',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://registry.example.com/registry.json',
          item: 'brand-card',
          id: 'acme-card',
        }),
      },
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      designSystem: {
        id: 'acme-card',
        title: 'Brand Card',
        origin: 'installed',
      },
    });
  });

  it('requires an item name for registry roots with multiple items', async () => {
    const { importShadcnRegistryDesignSystem } =
      await import('@/shared/services/design-mode/shadcn-registry');
    mocks.safeFetch.mockResolvedValueOnce(
      registryResponse({
        name: 'acme',
        items: [
          shadcnRegistryItem,
          { ...shadcnRegistryItem, name: 'brand-card' },
        ],
      }),
    );

    await expect(
      importShadcnRegistryDesignSystem({
        url: 'https://registry.example.com/registry.json',
      }),
    ).rejects.toThrow(/provide an item name/);
  });

  it('rejects unsafe URLs and CSS before writing catalog files', async () => {
    const { importShadcnRegistryDesignSystem } =
      await import('@/shared/services/design-mode/shadcn-registry');

    await expect(
      importShadcnRegistryDesignSystem({
        url: 'http://127.0.0.1/registry.json',
      }),
    ).rejects.toThrow(/must use HTTPS/);
    expect(mocks.safeFetch).not.toHaveBeenCalled();

    mocks.safeFetch.mockResolvedValueOnce(
      registryResponse({
        ...shadcnRegistryItem,
        cssVars: { light: { brand: 'url(https://example.com/a.png)' } },
      }),
    );
    await expect(
      importShadcnRegistryDesignSystem({
        url: 'https://registry.example.com/button.json',
      }),
    ).rejects.toThrow(/CSS value is unsafe/);
    await expect(
      fs.stat(path.join(workDir, '.neuma/design-systems/brand-button')),
    ).rejects.toMatchObject({ code: 'ENOENT' });

    mocks.safeFetch.mockResolvedValueOnce(
      registryResponse({
        ...shadcnRegistryItem,
        css: '@import "https://example.com/theme.css";',
      }),
    );
    await expect(
      importShadcnRegistryDesignSystem({
        url: 'https://registry.example.com/button.json',
      }),
    ).rejects.toThrow(/Registry css is unsafe/);
    await expect(
      fs.stat(path.join(workDir, '.neuma/design-systems/brand-button')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

const shadcnRegistryItem = {
  name: 'brand-button',
  type: 'registry:ui',
  title: 'Brand Button',
  description: 'Button tokens and references from shadcn.',
  dependencies: ['@radix-ui/react-slot'],
  devDependencies: ['tailwindcss'],
  registryDependencies: ['button'],
  cssVars: {
    theme: {
      'font-heading': 'Inter, sans-serif',
    },
    light: {
      brand: '#123456',
      background: '0 0% 100%',
    },
    dark: {
      brand: '#abcdef',
    },
  },
  css: {
    '@layer base': {
      body: {
        'font-family': 'var(--font-heading)',
      },
    },
  },
  files: [
    {
      path: 'components/ui/button.tsx',
      type: 'registry:ui',
      target: '~/components/ui/button.tsx',
      content: '<button className="btn">Brand</button>',
    },
  ],
};

function registryResponse(document: unknown) {
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: Buffer.from(JSON.stringify(document)),
    finalUrl: 'https://registry.example.com/button.json?token=opaque',
    redirectChain: ['https://registry.example.com/button.json?token=opaque'],
  };
}
