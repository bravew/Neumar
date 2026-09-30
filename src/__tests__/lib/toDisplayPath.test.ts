import { describe, expect, it } from 'vitest';

import { toDisplayPath } from '@/shared/lib/toDisplayPath';

describe('toDisplayPath', () => {
  it.each([
    {
      name: 'inside the session root',
      absPath: '/sessions/abc/output/name.ext',
      sessionRoot: '/sessions/abc',
      expected: 'output/name.ext',
    },
    {
      name: 'outside the session root',
      absPath: '/other/name.ext',
      sessionRoot: '/sessions/abc',
      expected: '/other/name.ext',
    },
    {
      name: 'windows separators',
      absPath: 'C:\\sessions\\abc\\output\\name.ext',
      sessionRoot: 'C:\\sessions\\abc',
      expected: 'output/name.ext',
    },
    {
      name: 'trailing slash on the session root',
      absPath: '/sessions/abc/output/name.ext',
      sessionRoot: '/sessions/abc/',
      expected: 'output/name.ext',
    },
    {
      name: 'missing session root',
      absPath: '/sessions/abc/output/name.ext',
      sessionRoot: undefined,
      expected: '/sessions/abc/output/name.ext',
    },
  ])('$name', ({ absPath, sessionRoot, expected }) => {
    expect(toDisplayPath(absPath, sessionRoot)).toBe(expected);
  });
});
