import { describe, expect, it } from 'vitest';

import { normalizeWhatsAppWebhook } from '@/shared/services/gateway/channels/whatsapp/cloud';

describe('WhatsApp inbound normalization', () => {
  it('normalizes text, interactive replies, media, and statuses', () => {
    const messages = normalizeWhatsAppWebhook({
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [{ wa_id: '15551234567', profile: { name: 'Ada' } }],
                messages: [
                  {
                    id: 'wamid.text',
                    from: '15551234567',
                    timestamp: '1700000000',
                    type: 'text',
                    text: { body: 'hello' },
                  },
                  {
                    id: 'wamid.interactive',
                    from: '15551234567',
                    timestamp: '1700000000',
                    type: 'interactive',
                    interactive: {
                      button_reply: { id: 'approve', title: 'Approve' },
                    },
                  },
                  {
                    id: 'wamid.image',
                    from: '15551234567',
                    timestamp: '1700000000',
                    type: 'image',
                    image: { id: 'media1', mime_type: 'image/jpeg' },
                  },
                ],
                statuses: [
                  {
                    id: 'wamid.text',
                    recipient_id: '15551234567',
                    status: 'read',
                    timestamp: '1700000001',
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(messages).toHaveLength(4);
    expect(messages[0]).toMatchObject({
      senderName: 'Ada',
      content: 'hello',
      contentType: 'text',
    });
    expect(messages[1]).toMatchObject({ content: 'approve' });
    expect(messages[2]).toMatchObject({
      content: '[image]',
      contentType: 'image',
      attachments: [
        {
          url: 'https://graph.facebook.com/v20.0/media1',
          contentType: 'image/jpeg',
        },
      ],
    });
    expect(messages[3]).toMatchObject({ content: 'status: read' });
  });
});
