import { describe, expect, it } from 'vitest';

import { isWrongGraphifyCli } from '@/shared/services/graphify/runner';

describe('graphify runner', () => {
  it('treats a graphify binary without update as the wrong CLI', () => {
    expect(
      isWrongGraphifyCli(
        "error: unknown command 'update'\nRun 'graphify --help' for usage.",
      ),
    ).toBe(true);
    expect(isWrongGraphifyCli('fatal: failed to parse source file')).toBe(
      false,
    );
  });
});
