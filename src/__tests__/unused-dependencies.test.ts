import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readManifest(relativePath: string): Manifest {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), relativePath), 'utf8'),
  ) as Manifest;
}

// Packages removed in #220 after an audit found no import, require, config, or
// script reference in the workspace. Re-adding one needs a real consumer.
const REMOVED: Record<string, string[]> = {
  'package.json': [
    '@assistant-ui/react-markdown',
    '@copilotkit/shared',
    'tw-animate-css',
    'vite-plugin-static-copy',
  ],
  'src-api/package.json': ['@types/pdf-parse'],
};

describe('removed unused dependencies', () => {
  for (const [manifestPath, names] of Object.entries(REMOVED)) {
    it(`${manifestPath} does not declare packages with no consumer`, () => {
      const manifest = readManifest(manifestPath);
      const declared = {
        ...manifest.dependencies,
        ...manifest.devDependencies,
      };
      expect(names.filter((name) => name in declared)).toEqual([]);
    });
  }
});
