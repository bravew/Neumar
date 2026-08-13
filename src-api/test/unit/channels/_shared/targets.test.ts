import { describe, expect, it } from 'vitest';

import { parseChannelTarget } from '@/shared/channels/_shared/targets';

describe('parseChannelTarget', () => {
  it('parses Slack channel and thread targets', () => {
    expect(parseChannelTarget('slack', 'C123')).toEqual({
      provider: 'slack',
      conversationId: 'C123',
    });
    expect(parseChannelTarget('slack', 'C123:171234.567')).toEqual({
      provider: 'slack',
      conversationId: 'C123',
      threadId: '171234.567',
    });
  });

  it('parses Discord channel, DM, and forum targets', () => {
    expect(parseChannelTarget('discord', '123')).toEqual({
      provider: 'discord',
      conversationId: '123',
    });
    expect(parseChannelTarget('discord', 'dm:456')).toEqual({
      provider: 'discord',
      conversationId: 'dm:456',
      userId: '456',
    });
    expect(parseChannelTarget('discord', 'forum:10:20')).toEqual({
      provider: 'discord',
      conversationId: 'forum:10:20',
      threadId: '20',
    });
  });

  it('parses Telegram forum topic targets', () => {
    expect(parseChannelTarget('telegram', '-100123:42')).toEqual({
      provider: 'telegram',
      conversationId: '-100123',
      threadId: '42',
    });
  });

  it('parses Lark chat and user target prefixes', () => {
    expect(parseChannelTarget('lark', 'chat:oc_abc')).toEqual({
      provider: 'lark',
      conversationId: 'oc_abc',
      receiveIdType: 'chat_id',
    });
    expect(parseChannelTarget('lark', 'dm:ou_abc')).toEqual({
      provider: 'lark',
      conversationId: 'ou_abc',
      userId: 'ou_abc',
      receiveIdType: 'open_id',
    });
  });

  it('parses BlueBubbles and WhatsApp targets', () => {
    expect(parseChannelTarget('bluebubbles', 'phone:+15551234567')).toEqual({
      provider: 'bluebubbles',
      conversationId: '+15551234567',
      userId: '+15551234567',
    });
    expect(parseChannelTarget('whatsapp', '12345:+15551234567')).toEqual({
      provider: 'whatsapp',
      conversationId: '+15551234567',
      phoneNumberId: '12345',
      waId: '15551234567',
    });
  });
});
