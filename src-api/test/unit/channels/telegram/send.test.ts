import { describe, expect, it } from 'vitest';

import { TelegramPlugin } from '@/shared/channels/telegram';

describe('TelegramPlugin sendMessage', () => {
  it('sends topic-aware interactive messages with unfurl suppression', async () => {
    const calls: unknown[][] = [];
    const plugin = new TelegramPlugin();
    Object.assign(plugin as unknown as { bot: unknown }, {
      bot: {
        api: {
          async sendMessage(...args: unknown[]) {
            calls.push(args);
            return { message_id: 123 };
          },
        },
      },
    });

    const result = await plugin.sendMessage('-100123:42', {
      text: [
        'Pick one',
        '```select',
        'Priority',
        'High | high',
        'Low | low',
        '```',
      ].join('\n'),
      unfurl: false,
    });

    expect(result).toEqual({ messageId: '123' });
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe('-100123');
    expect(calls[0]![1]).toBe('Pick one');
    expect(calls[0]![2]).toMatchObject({
      parse_mode: 'HTML',
      message_thread_id: 42,
      link_preview_options: { is_disabled: true },
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'High',
              callback_data: expect.stringMatching(/^neuma:sel/),
            },
          ],
          [{ text: 'Low', callback_data: expect.stringMatching(/^neuma:sel/) }],
        ],
      },
    });
  });
});
