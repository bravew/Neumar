import { describe, expect, it } from 'vitest';

import { toNormalizedMessage } from '@/shared/channels/discord/message-adapter';

function attachmentCollection() {
  return { values: function* values() {} };
}

describe('Discord message normalization', () => {
  it('uses the DM channel as the conversation id', () => {
    const normalized = toNormalizedMessage(
      {
        id: 'm1',
        content: 'hello',
        guildId: null,
        channelId: 'dm-channel',
        channel: { id: 'dm-channel' },
        author: { id: 'user1', username: 'ada' },
        attachments: attachmentCollection(),
      },
      'bot1',
      'cfg1',
    );

    expect(normalized.conversationId).toBe('dm-channel');
    expect(normalized.sessionKey).toBe('dm-channel');
  });

  it('uses forum parent and thread id for forum thread conversations', () => {
    const normalized = toNormalizedMessage(
      {
        id: 'm2',
        content: '<@bot1> ship it',
        guildId: 'guild1',
        channelId: 'thread1',
        channel: {
          id: 'thread1',
          parentId: 'forum1',
          parent: { type: 15 },
          isThread: () => true,
        },
        author: { id: 'user1', username: 'ada' },
        attachments: attachmentCollection(),
      },
      'bot1',
      'cfg1',
    );

    expect(normalized.conversationId).toBe('forum:forum1:thread1');
    expect(normalized.sessionKey).toBe('forum:forum1:thread1');
    expect(normalized.text).toBe('ship it');
  });
});
