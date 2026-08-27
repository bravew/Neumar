import { describe, expect, it } from 'vitest';

import { buildSdkSandboxSettings } from '@/extensions/agent/claude';

describe('Claude SDK execution policy', () => {
  it('keeps SDK OS sandboxing enabled by default', () => {
    const settings = buildSdkSandboxSettings('/tmp/session');

    expect(settings?.sandbox.enabled).toBe(true);
  });

  it('omits all SDK sandbox settings for host-native execution', () => {
    expect(
      buildSdkSandboxSettings(
        '/tmp/session',
        '/tmp/workspace',
        false,
        ['/tmp/media'],
        'host-native',
      ),
    ).toBeUndefined();
  });
});
