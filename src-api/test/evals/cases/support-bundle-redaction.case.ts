import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readBoundedLogTail } from '@/shared/observability/support-bundle';

import type { EvalCase } from '../types';

const SECRET = 'sk-test-support-bundle-secret-1234567890';
const RAW_PATH = '/Users/example/private/project/file.ts';

const evalCase: EvalCase = {
  id: 'support-bundle-redaction',
  name: 'Support bundle log tails are bounded and redact secrets and paths',
  tier: 'gate',
  touchfiles: [
    'src-api/src/shared/observability/support-bundle.ts',
    'src-api/src/shared/utils/logger.ts',
  ],
  budget: { maxUsd: 0, timeoutMs: 5_000 },
  run: async () => {
    const directory = await mkdtemp(join(tmpdir(), 'neuma-support-eval-'));
    try {
      const file = join(directory, 'app-08-08.log');
      await writeFile(
        file,
        `${'discard\n'.repeat(100)}${SECRET} ${RAW_PATH}\n`,
      );
      const tail = await readBoundedLogTail(file, {
        maxBytes: 256,
        maxLineBytes: 128,
      });
      const secretLeaks = tail.includes(SECRET);
      const pathLeaks = tail.includes(RAW_PATH);
      const bounded = Buffer.byteLength(tail, 'utf8') <= 384;
      const passed = !secretLeaks && !pathLeaks && bounded;
      return {
        passed,
        score: passed ? 1 : 0,
        notes: passed
          ? 'bounded tail is redacted'
          : 'support tail safety failed',
        metrics: {
          byteSize: Buffer.byteLength(tail, 'utf8'),
          secretLeaks,
          pathLeaks,
        },
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
};

export default evalCase;
