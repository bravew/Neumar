/**
 * Command Handlers
 *
 * Execute gateway slash commands (permission-gated).
 */

import type {
  ChannelAdapter,
  GatewayIdentity,
  GatewaySession,
  OutboundContent,
  ParsedCommand,
} from '../channels/types';
import { getBudgetMessage } from '../shared/auth/token-budget';
import * as db from '../shared/db/operations';
import { sendWithRetry } from './outbound-pipeline';

export async function handleCommand(
  cmd: ParsedCommand,
  identity: GatewayIdentity,
  session: GatewaySession,
  adapter: ChannelAdapter,
): Promise<void> {
  const reply = async (text: string, buttons?: OutboundContent['buttons']) => {
    await sendWithRetry(adapter, session.channel_chat_id, {
      text,
      format: adapter.capabilities.supportsMarkdown ? 'markdown' : 'plain',
      buttons,
    });
  };

  switch (cmd.name) {
    case 'help':
      await reply(getHelpText());
      break;

    case 'status':
      await reply(getStatusText());
      break;

    case 'budget':
      await reply(getBudgetMessage(identity));
      break;

    case 'task': {
      const subcommand = cmd.args[0];
      switch (subcommand) {
        case 'list':
          await reply(
            'Use the app to view task list (chat-based task listing coming soon).',
          );
          break;
        case 'status':
          await reply(
            'Use the app to view task status (chat-based task status coming soon).',
          );
          break;
        case 'create':
          await reply(
            'Task creation from chat coming soon. For now, just send a message to start a conversation.',
          );
          break;
        case 'stop':
          await reply('Task stop from chat coming soon.');
          break;
        default: {
          // Sanitize user input to prevent markdown injection in channel messages
          const safeSubcommand = (subcommand ?? '(none)').replace(
            /[[\](){}*_~`>#+\-=|!]/g,
            '',
          );
          await reply(
            `Unknown task subcommand: ${safeSubcommand}. Try /task list, /task status, /task create, /task stop.`,
          );
        }
      }
      break;
    }

    case 'approve': {
      // Tool approval handling will be implemented with the tool-approval-handler
      await reply('Tool approval from chat coming soon.');
      break;
    }

    case 'deny': {
      await reply('Tool denial from chat coming soon.');
      break;
    }

    case 'subscribe': {
      const eventType = cmd.args[0] ?? '*';
      const id = crypto.randomUUID();
      db.createSubscription(
        id,
        identity.id,
        session.channel_id,
        session.channel_chat_id,
        eventType,
      );
      db.writeAuditLog(
        crypto.randomUUID(),
        identity.id,
        session.channel_id,
        'subscribe',
        { eventType },
      );
      await reply(`Subscribed to ${eventType} notifications.`);
      break;
    }

    case 'unsubscribe': {
      const subs = db.getIdentitySubscriptions(identity.id);
      const eventType = cmd.args[0];
      const matching = eventType
        ? subs.filter((s) => s.event_type === eventType)
        : subs;
      for (const sub of matching) {
        db.deleteSubscription(sub.id);
      }
      db.writeAuditLog(
        crypto.randomUUID(),
        identity.id,
        session.channel_id,
        'unsubscribe',
        { eventType, count: matching.length },
      );
      await reply(`Unsubscribed from ${matching.length} notification(s).`);
      break;
    }

    default:
      await reply(
        `Unknown command: /${cmd.name}. Type /help for available commands.`,
      );
  }
}

function getHelpText(): string {
  return [
    '**Available Commands:**',
    '',
    '`/help` — Show this help message',
    '`/status` — Agent and channel health',
    '`/budget` — View token budget status',
    '`/task list` — List recent tasks',
    '`/task status [id]` — Check task status',
    '`/task create <description>` — Create a new task',
    '`/task stop [id]` — Stop a running task',
    '`/approve [id]` — Approve pending tool use',
    '`/deny [id]` — Deny pending tool use',
    '`/subscribe <event>` — Subscribe to notifications',
    '`/unsubscribe [event]` — Unsubscribe',
    '',
    'Or just send a message to chat with the AI agent.',
  ].join('\n');
}

function getStatusText(): string {
  return 'Gateway is running. Use the settings page for detailed metrics.';
}
