import crypto from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  verifyWhatsAppChallenge,
  verifyWhatsAppSignature,
} from '@/shared/services/gateway/channels/whatsapp/cloud';

describe('WhatsApp webhook verification', () => {
  it('returns the challenge for a matching verify token', () => {
    const query = new URLSearchParams({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'verify',
      'hub.challenge': 'abc123',
    });

    expect(verifyWhatsAppChallenge(query, 'verify')).toBe('abc123');
    expect(verifyWhatsAppChallenge(query, 'wrong')).toBeNull();
  });

  it('verifies X-Hub-Signature-256 values', () => {
    const body = JSON.stringify({ object: 'whatsapp_business_account' });
    const signature =
      'sha256=' +
      crypto.createHmac('sha256', 'secret').update(body).digest('hex');

    expect(
      verifyWhatsAppSignature({ body, appSecret: 'secret', signature }),
    ).toBe(true);
    expect(
      verifyWhatsAppSignature({ body, appSecret: 'secret', signature: 'bad' }),
    ).toBe(false);
  });
});
