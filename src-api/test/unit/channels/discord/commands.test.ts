import { describe, expect, it } from 'vitest';

import {
  COMMAND_DEFS,
  commandToMessageText,
} from '@/shared/channels/discord/commands';

describe('Discord commands', () => {
  it('registers the channel command surface', () => {
    expect(COMMAND_DEFS.map((command) => command.name)).toEqual([
      'pair',
      'new',
      'status',
      'budget',
      'stop',
      'help',
    ]);
  });

  it('converts slash command options into existing command text', () => {
    expect(
      commandToMessageText('pair', [
        { name: 'code', value: 'abc123' },
        { name: 'empty', value: '' },
      ]),
    ).toBe('/pair abc123');
  });
});
