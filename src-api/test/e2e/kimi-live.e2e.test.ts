import { describe, expect, it } from 'vitest';

import { kimiPlugin } from '@/extensions/agent/kimi';

const ACTIVE = process.env.KIMI_LIVE_TEST === '1';

describe.skipIf(!ACTIVE)('Kimi Code live ACP smoke', () => {
  it('creates an authenticated ACP session and discovers a model', async () => {
    const report = await kimiPlugin.testEnvironment?.({
      provider: 'kimi',
      workDir: process.cwd(),
      providerConfig: process.env.KIMI_PATH
        ? { binaryPath: process.env.KIMI_PATH }
        : {},
    });
    expect(report).toMatchObject({
      healthy: true,
      binaryFound: true,
      authValid: true,
      helloProbeOk: true,
      errors: [],
    });
    expect(report?.models?.length).toBeGreaterThan(0);
  }, 30_000);
});
