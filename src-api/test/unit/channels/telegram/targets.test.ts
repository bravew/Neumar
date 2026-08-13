import { describe, expect, it } from 'vitest';

import {
  parseTelegramTarget,
  telegramSendOptions,
} from '@/shared/channels/telegram/targets';

describe('Telegram targets', () => {
  it('parses bare chat ids', () => {
    expect(parseTelegramTarget('-100123')).toEqual({ chatId: '-100123' });
  });

  it('parses topic targets from legacy and explicit forms', () => {
    expect(parseTelegramTarget('-100123:42')).toEqual({
      chatId: '-100123',
      threadId: 42,
    });
    expect(parseTelegramTarget('-100123:topic:43')).toEqual({
      chatId: '-100123',
      threadId: 43,
    });
  });

  it('creates Bot API thread options for topics', () => {
    expect(telegramSendOptions({ chatId: '-100123' })).toEqual({});
    expect(telegramSendOptions({ chatId: '-100123', threadId: 42 })).toEqual({
      message_thread_id: 42,
    });
  });
});
