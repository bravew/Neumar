import { REST, Routes } from 'discord.js';

const STRING_OPTION = 3;

export const COMMAND_DEFS = [
  {
    name: 'pair',
    description: 'Link your account',
    options: [
      {
        name: 'code',
        description: 'Pairing code',
        type: STRING_OPTION,
        required: false,
      },
    ],
  },
  { name: 'new', description: 'Start a new task' },
  { name: 'status', description: 'Show status' },
  { name: 'budget', description: 'Show budget' },
  { name: 'stop', description: 'Stop the current task' },
  { name: 'help', description: 'Help' },
] as const;

export async function registerDiscordCommands(params: {
  token: string;
  applicationId: string;
  guildId?: string;
}): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(params.token);
  const route = params.guildId
    ? Routes.applicationGuildCommands(params.applicationId, params.guildId)
    : Routes.applicationCommands(params.applicationId);
  await rest.put(route, { body: COMMAND_DEFS });
}

export function commandToMessageText(
  commandName: string,
  options: Array<{ name: string; value: unknown }> = [],
): string {
  const args = options
    .map((option) => String(option.value ?? '').trim())
    .filter(Boolean);
  return `/${commandName}${args.length ? ` ${args.join(' ')}` : ''}`;
}
