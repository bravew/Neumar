import crypto from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  normalizeBlueBubblesWebhook,
  verifyBlueBubblesWebhook,
} from '@/shared/services/gateway/channels/imessage/webhook';

describe('BlueBubbles webhook helpers', () => {
  it('verifies sha256 HMAC signatures', () => {
    const body = JSON.stringify({ guid: 'm1' });
    const signature =
      'sha256=' +
      crypto.createHmac('sha256', 'secret').update(body).digest('hex');

    expect(
      verifyBlueBubblesWebhook({ body, secret: 'secret', signature }),
    ).toBe(true);
    expect(
      verifyBlueBubblesWebhook({ body, secret: 'secret', signature: 'bad' }),
    ).toBe(false);
  });

  it('normalizes new messages and tapbacks', () => {
    expect(
      normalizeBlueBubblesWebhook('new-message', {
        guid: 'm1',
        text: 'hello',
        chats: [{ guid: 'chat1' }],
        handle: { address: '+15551234567' },
        dateCreated: 1_700_000_000_000,
      }),
    ).toMatchObject({
      channelId: 'imessage',
      chatId: 'chat1',
      senderId: '+15551234567',
      content: 'hello',
      contentType: 'text',
      messageId: 'm1',
    });

    expect(
      normalizeBlueBubblesWebhook('message-update', {
        guid: 'm2',
        chats: [{ guid: 'chat1' }],
        associatedMessageType: 2001,
        associatedMessageGuid: 'm1',
      }),
    ).toMatchObject({
      content: 'reaction_added: like',
      replyToId: 'm1',
    });
  });
});
