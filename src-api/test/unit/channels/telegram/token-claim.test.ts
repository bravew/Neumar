import { beforeEach, describe, expect, it } from 'vitest';

import {
  claimTelegramToken,
  releaseTelegramToken,
  resetTelegramTokenClaimsForTest,
} from '@/shared/channels/telegram/token-claim';

describe('telegram token claim guard', () => {
  beforeEach(() => {
    resetTelegramTokenClaimsForTest();
  });

  it('allows only one claim per token until release', () => {
    expect(claimTelegramToken('secret-token')).toBe(true);
    expect(claimTelegramToken('secret-token')).toBe(false);

    releaseTelegramToken('secret-token');
    expect(claimTelegramToken('secret-token')).toBe(true);
  });

  it('tracks different tokens independently', () => {
    expect(claimTelegramToken('token-a')).toBe(true);
    expect(claimTelegramToken('token-b')).toBe(true);
  });
});
