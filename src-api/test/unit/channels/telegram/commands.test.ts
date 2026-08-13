import { describe, expect, it } from 'vitest';

import {
  TELEGRAM_COMMANDS,
  registerTelegramCommands,
} from '@/shared/channels/telegram/commands';

describe('Telegram commands', () => {
  it('declares the command menu surface', () => {
    expect(TELEGRAM_COMMANDS.map((command) => command.command)).toEqual([
      'start',
      'pair',
      'new',
      'status',
      'budget',
      'stop',
      'help',
    ]);
  });

  it('registers private chat commands and the commands menu button', async () => {
    const calls: unknown[] = [];
    await registerTelegramCommands({
      api: {
        async setMyCommands(commands, options) {
          calls.push(['setMyCommands', commands, options]);
        },
        async setChatMenuButton(options) {
          calls.push(['setChatMenuButton', options]);
        },
      },
    });

    expect(calls).toEqual([
      [
        'setMyCommands',
        TELEGRAM_COMMANDS,
        { scope: { type: 'all_private_chats' } },
      ],
      ['setChatMenuButton', { menu_button: { type: 'commands' } }],
    ]);
  });
});
