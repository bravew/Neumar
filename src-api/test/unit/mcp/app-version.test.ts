import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { getApiVersion } from '@/shared/utils/app-version';

describe('getApiVersion', () => {
  it('reads the version from src-api/package.json', () => {
    const pkg = JSON.parse(
      readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), '../../../package.json'),
        'utf8',
      ),
    ) as { version: string };
    expect(getApiVersion()).toBe(pkg.version);
    expect(getApiVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
