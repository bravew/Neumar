export const TELEGRAM_COMMANDS = [
  { command: 'start', description: 'Start' },
  { command: 'pair', description: 'Link your account' },
  { command: 'new', description: 'Start a new task' },
  { command: 'status', description: 'Show status' },
  { command: 'budget', description: 'Show budget' },
  { command: 'stop', description: 'Stop the current task' },
  { command: 'help', description: 'Help' },
] as const;

export async function registerTelegramCommands(bot: {
  api: {
    setMyCommands(
      commands: typeof TELEGRAM_COMMANDS,
      options?: unknown,
    ): Promise<unknown>;
    setChatMenuButton(options: unknown): Promise<unknown>;
  };
}): Promise<void> {
  await bot.api.setMyCommands(TELEGRAM_COMMANDS, {
    scope: { type: 'all_private_chats' },
  });
  await bot.api.setChatMenuButton({
    menu_button: { type: 'commands' },
  });
}
