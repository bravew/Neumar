import { describe, expect, it } from 'vitest';

import { AdapterToolRegistry } from '@/shared/mcp/adapter-tool-registry';

describe('AdapterToolRegistry', () => {
  it('register / descriptors / search round-trip', () => {
    const reg = new AdapterToolRegistry();
    reg.register(
      { name: 'fs.read', description: 'Read file', source: 'builtin' },
      async () => ({ inputSchema: {}, handler: async () => 'ok' }),
    );
    reg.register(
      { name: 'fs.write', description: 'Write file', source: 'builtin' },
      async () => ({ inputSchema: {}, handler: async () => 'ok' }),
    );
    expect(reg.size()).toBe(2);
    expect(
      reg
        .descriptors()
        .map((d) => d.name)
        .sort(),
    ).toEqual(['fs.read', 'fs.write']);
    const result = reg.search({ query: 'read', top_k: 5 });
    expect(result.matches[0]?.name).toBe('fs.read');
  });

  it('register is idempotent on name (replaces materializer)', () => {
    const reg = new AdapterToolRegistry();
    reg.register(
      { name: 'x', description: 'one', source: 'builtin' },
      async () => null,
    );
    reg.register(
      { name: 'x', description: 'two', source: 'builtin' },
      async () => ({ inputSchema: { v: 2 }, handler: async () => 'v2' }),
    );
    expect(reg.size()).toBe(1);
    expect(reg.descriptors()[0]?.description).toBe('two');
  });

  it('materialize returns null for unknown tools', async () => {
    const reg = new AdapterToolRegistry();
    expect(await reg.materialize('missing')).toBeNull();
  });

  it('materialize returns the registered schema + handler', async () => {
    const reg = new AdapterToolRegistry();
    reg.register(
      { name: 'web.fetch', description: 'Fetch URL', source: 'builtin' },
      async (name) => ({
        inputSchema: { name },
        handler: async () => `called ${name}`,
      }),
    );
    const materialized = await reg.materialize('web.fetch');
    expect(materialized).not.toBeNull();
    expect(await materialized!.handler({})).toBe('called web.fetch');
  });
});
