import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveMcpStdioLaunch } from '../../helpers/spawn-mcp-stdio';

const API_DIR = join(import.meta.dirname, '../../..');

describe('resolveMcpStdioLaunch', () => {
  const previous = {
    bin: process.env.NEUMAR_MCP_BIN,
    bundle: process.env.NEUMAR_MCP_USE_BUNDLE,
    dist: process.env.NEUMAR_MCP_USE_DIST,
  };

  afterEach(() => {
    restore('NEUMAR_MCP_BIN', previous.bin);
    restore('NEUMAR_MCP_USE_BUNDLE', previous.bundle);
    restore('NEUMAR_MCP_USE_DIST', previous.dist);
  });

  it('does not fall through to tsx when NEUMAR_MCP_USE_BUNDLE=1', () => {
    delete process.env.NEUMAR_MCP_BIN;
    process.env.NEUMAR_MCP_USE_BUNDLE = '1';
    const bundle = join(API_DIR, 'dist', 'bundle.cjs');
    if (existsSync(bundle)) {
      expect(resolveMcpStdioLaunch().label).toBe('bundle');
    } else {
      expect(() => resolveMcpStdioLaunch()).toThrow(/bundle\.cjs is missing/);
    }
  });

  it('does not fall through to tsx when NEUMAR_MCP_USE_DIST=1', () => {
    delete process.env.NEUMAR_MCP_BIN;
    delete process.env.NEUMAR_MCP_USE_BUNDLE;
    process.env.NEUMAR_MCP_USE_DIST = '1';
    const dist = join(API_DIR, 'dist', 'index.js');
    if (existsSync(dist)) {
      expect(resolveMcpStdioLaunch().label).toBe('dist');
    } else {
      expect(() => resolveMcpStdioLaunch()).toThrow(/index\.js is missing/);
    }
  });
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
