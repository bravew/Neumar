import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  _resetMarketplaceCache,
  fetchAllRegistries,
  getConfiguredRegistries,
  MarketplaceIndexSchema,
  DEFAULT_MARKETPLACE_URL,
} from '@/shared/plugins/marketplace';

vi.mock('@/shared/db/operations', () => ({
  getSetting: vi.fn(() => null),
}));

// Registry URLs are DB-backed (migration 045); an empty source list drives
// the default-registry fallback without touching a real database.
vi.mock('@/shared/db/marketplace-sources', () => ({
  listMarketplaceSources: vi.fn(() => []),
}));

vi.mock('@/config/constants', () => ({
  getAppDir: () => '/tmp/neuma-test-app-dir',
}));

// Phase 7: marketplace fetches now go through safeFetch (DNS-pinned, redirect
// validated). Mock at the module boundary so we can drive HTTP responses
// without spinning up a server.
const safeFetchMock = vi.fn();
vi.mock('@/shared/network-policy/fetch', async () => {
  const actual = await vi.importActual<
    typeof import('@/shared/network-policy/fetch')
  >('@/shared/network-policy/fetch');
  return {
    ...actual,
    safeFetch: (...args: unknown[]) => safeFetchMock(...args),
  };
});

function mockSafeOk(body: unknown, status = 200) {
  const buf = Buffer.from(
    typeof body === 'string' ? body : JSON.stringify(body),
    'utf8',
  );
  safeFetchMock.mockResolvedValueOnce({
    status,
    headers: { 'content-type': 'application/json' },
    body: buf,
    finalUrl: 'https://example/',
    redirectChain: ['https://example/'],
  });
}

function mockSafeStatus(status: number) {
  safeFetchMock.mockResolvedValueOnce({
    status,
    headers: {},
    body: Buffer.alloc(0),
    finalUrl: 'https://example/',
    redirectChain: ['https://example/'],
  });
}

const validIndex = {
  name: 'demo-registry',
  plugins: [
    {
      name: 'demo-plugin',
      description: 'A demo',
      source: 'github:demo/repo',
    },
  ],
};

describe('MarketplaceIndexSchema', () => {
  it('accepts a minimal valid index', () => {
    expect(MarketplaceIndexSchema.safeParse(validIndex).success).toBe(true);
  });

  it('tolerates unknown top-level keys (wire compatibility)', () => {
    const extended = { ...validIndex, junk: 1, metadata: { version: '1.0' } };
    expect(MarketplaceIndexSchema.safeParse(extended).success).toBe(true);
  });

  it('accepts relative-path and upstream object sources', () => {
    const ok = {
      ...validIndex,
      plugins: [
        { name: 'a', description: 'd', source: './plugins/a' },
        {
          name: 'b',
          description: 'd',
          source: { source: 'github', repo: 'demo/repo' },
        },
      ],
    };
    expect(MarketplaceIndexSchema.safeParse(ok).success).toBe(true);
  });

  it('rejects object sources without a source discriminator', () => {
    const bad = {
      ...validIndex,
      plugins: [{ name: 'x', description: 'y', source: { repo: 'demo/repo' } }],
    };
    expect(MarketplaceIndexSchema.safeParse(bad).success).toBe(false);
  });
});

describe('getConfiguredRegistries', () => {
  it('falls back to the default registry when nothing is configured', () => {
    expect(getConfiguredRegistries()).toEqual([DEFAULT_MARKETPLACE_URL]);
  });
});

describe('fetchAllRegistries', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    _resetMarketplaceCache();
    originalFetch = globalThis.fetch;
    safeFetchMock.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns parsed indexes for a successful HTTPS fetch', async () => {
    mockSafeOk(validIndex);
    const results = await fetchAllRegistries();
    expect(results).toHaveLength(1);
    expect(results[0]?.error).toBeUndefined();
    expect(results[0]?.index?.plugins[0]?.name).toBe('demo-plugin');
    expect(results[0]?.fromCache).toBe(false);
  });

  it('serves the cached index on a subsequent call', async () => {
    mockSafeOk(validIndex);
    await fetchAllRegistries();
    const second = await fetchAllRegistries();
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
    expect(second[0]?.fromCache).toBe(true);
  });

  it('reports HTTP failures as errors without throwing', async () => {
    mockSafeStatus(502);
    const results = await fetchAllRegistries();
    expect(results[0]?.error).toMatch(/HTTP 502/);
  });

  it('reports invalid JSON without throwing', async () => {
    mockSafeOk('{ not json');
    const results = await fetchAllRegistries();
    expect(results[0]?.error).toMatch(/invalid JSON/);
  });

  it('reports schema mismatches', async () => {
    mockSafeOk({ name: 'x' });
    const results = await fetchAllRegistries();
    expect(results[0]?.error).toMatch(/invalid marketplace.json/);
  });
});
