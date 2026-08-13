import { describe, expect, it, vi } from 'vitest';

import {
  sendWhatsAppCloudMessage,
  type WhatsAppCloudConfig,
} from '@/shared/services/gateway/channels/whatsapp/cloud';

describe('WhatsApp Cloud retries', () => {
  it('retries 429 responses with capped backoff path', async () => {
    const config: WhatsAppCloudConfig = {
      mode: 'cloud',
      phoneNumberId: 'phone123',
      accessToken: 'token',
      webhookVerifyToken: 'verify',
      appSecret: 'secret',
    };
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ messages: [{ id: 'wamid.2' }] }), {
          status: 200,
        }),
      ) as unknown as typeof fetch;

    await expect(
      sendWhatsAppCloudMessage({
        config,
        to: '15551234567',
        content: { text: 'hello' },
        fetchFn,
        retryDelayMs: 0,
      }),
    ).resolves.toBe('wamid.2');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
