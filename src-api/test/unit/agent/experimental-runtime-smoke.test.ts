import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFileP = promisify(execFile);

describe('experimental runtime real-binary smoke tests', () => {
  it.skipIf(process.env.NEUMA_SMOKE_KIMI !== '1')(
    'starts the installed Kimi binary',
    async () => {
      const { stdout } = await execFileP(
        process.env.KIMI_PATH ?? 'kimi',
        ['--version'],
        {
          timeout: 10_000,
        },
      );
      expect(stdout.trim()).not.toBe('');
    },
  );

  it.skipIf(process.env.NEUMA_SMOKE_ATOMCODE !== '1')(
    'starts the installed AtomCode binary',
    async () => {
      const { stdout } = await execFileP(
        process.env.ATOMCODE_PATH ?? 'atomcode',
        ['--version'],
        {
          timeout: 10_000,
        },
      );
      expect(stdout.trim()).not.toBe('');
    },
  );
});
