import { describe, expect, it, vi } from 'vitest';

import {
  buildWhatsAppMessagePayload,
  sendWhatsAppCloudMessage,
  type WhatsAppCloudConfig,
} from '@/shared/services/gateway/channels/whatsapp/cloud';

const config: WhatsAppCloudConfig = {
  mode: 'cloud',
  phoneNumberId: 'phone123',
  accessToken: 'token',
  webhookVerifyToken: 'verify',
  appSecret: 'secret',
};

describe('WhatsApp Cloud send', () => {
  it('renders shared button blocks as WhatsApp interactive buttons', () => {
    expect(
      buildWhatsAppMessagePayload('15551234567', {
        text: [
          'Choose',
          '```buttons',
          'Approve | approve',
          'Deny | deny',
          '```',
        ].join('\n'),
      }),
    ).toMatchObject({
      type: 'interactive',
      interactive: {
        type: 'button',
        action: {
          buttons: [
            { reply: { id: 'approve', title: 'Approve' } },
            { reply: { id: 'deny', title: 'Deny' } },
          ],
        },
      },
    });
  });

  it('sends Graph API messages with bearer auth', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), {
          status: 200,
        }),
    ) as unknown as typeof fetch;

    await expect(
      sendWhatsAppCloudMessage({
        config,
        to: '15551234567',
        content: { text: 'hello' },
        fetchFn,
      }),
    ).resolves.toBe('wamid.1');
    expect(fetchFn.mock.calls[0]![0]).toBe(
      'https://graph.facebook.com/v20.0/phone123/messages',
    );
    expect(fetchFn.mock.calls[0]![1]).toMatchObject({
      headers: { Authorization: 'Bearer token' },
    });
  });
});
