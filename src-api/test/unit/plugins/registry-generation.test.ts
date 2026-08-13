import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseMarketplace } from '@/shared/plugins/marketplace-schema';

const testDir = dirname(fileURLToPath(import.meta.url));
const registryFile = join(
  testDir,
  '..',
  '..',
  '..',
  '..',
  'plugins',
  'registry',
  'official',
  'marketplace.json',
);

describe('generated official plugin registry', () => {
  it('validates against the marketplace wire schema', async () => {
    const raw = await readFile(registryFile, 'utf-8');
    const parsed = parseMarketplace(raw);
    expect(parsed.issues).toEqual([]);
    expect(parsed.ok).toBe(true);

    const marketplace = parsed.marketplace!;
    expect(marketplace.plugins.length).toBeGreaterThanOrEqual(200);

    for (const plugin of marketplace.plugins) {
      // Bundled entries must resolve inside the repo's plugin root.
      expect(plugin.source.startsWith('./')).toBe(true);
      expect(plugin.source).not.toContain('..');
      // Pre-install capability disclosure is mandatory for official entries.
      const neuma = (
        plugin as { metadata?: { neuma?: { capabilitiesSummary?: string[] } } }
      ).metadata?.neuma;
      expect(Array.isArray(neuma?.capabilitiesSummary)).toBe(true);
      expect(neuma!.capabilitiesSummary!.length).toBeGreaterThan(0);
    }

    // The three consolidated categories all publish entries.
    const categories = new Set(marketplace.plugins.map((p) => p.category));
    expect(categories).toContain('design-systems');
    expect(categories).toContain('design-skills');
    expect(categories).toContain('video-templates');
  });
});
