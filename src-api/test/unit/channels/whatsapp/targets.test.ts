import { describe, expect, it } from 'vitest';

import { normalizeWhatsAppTarget } from '@/shared/services/gateway/channels/whatsapp/cloud';

describe('WhatsApp targets', () => {
  it('normalizes E.164 and phoneNumberId-prefixed targets to wa_id', () => {
    expect(normalizeWhatsAppTarget('+15551234567')).toBe('15551234567');
    expect(normalizeWhatsAppTarget('123456:+15551234567')).toBe('15551234567');
  });

  it('rejects non-phone targets', () => {
    expect(() => normalizeWhatsAppTarget('not-a-phone')).toThrow(
      'WhatsApp target must be E.164',
    );
  });
});
