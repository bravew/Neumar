import { describe, expect, it } from 'vitest';

import {
  mapLarkStartupError,
  parseLarkTokenConfig,
  probeLarkStartup,
} from '@/shared/channels/lark/diagnostics';

describe('Lark diagnostics', () => {
  it('parses token JSON with Feishu domain selection', () => {
    expect(
      parseLarkTokenConfig(
        JSON.stringify({
          appId: 'cli_a',
          appSecret: 'secret',
          domain: 'feishu',
          verificationToken: 'verify',
          encryptKey: 'encrypt',
        }),
      ),
    ).toEqual({
      appId: 'cli_a',
      appSecret: 'secret',
      domain: 'feishu',
      verificationToken: 'verify',
      encryptKey: 'encrypt',
    });
  });

  it('maps common SDK failures to setup hints', () => {
    expect(
      mapLarkStartupError(new Error('99991663 not published')).message,
    ).toBe('App not published — submit to admin or run as Test mode.');
    expect(mapLarkStartupError(new Error('permission denied')).message).toBe(
      'Missing scope `im:message`. Add it in the developer console.',
    );
  });

  it('probes tenant auth using the configured app credentials', async () => {
    const calls: unknown[] = [];
    await probeLarkStartup({
      appId: 'cli_a',
      appSecret: 'secret',
      client: {
        auth: {
          tenantAccessToken: {
            async internal(payload: unknown) {
              calls.push(payload);
            },
          },
        },
      },
    });

    expect(calls).toEqual([
      { data: { app_id: 'cli_a', app_secret: 'secret' } },
    ]);
  });
});
