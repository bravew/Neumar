/**
 * Read-side helpers for the App Home view. Centralised here so the view
 * builder stays a pure function of plain data.
 */

import { getChannelConfigById } from '@/shared/db/operations';
import {
  type RoutingMode,
  type SlackUserCredentialRow,
  type SlackUserLink,
  type SlackUserMcpRow,
  getSlackUserLink,
  listSlackUserCredentials,
  listSlackUserMcp,
} from '@/shared/db/operations-slack-home';
import type { SlackUserMcpPolicy } from '@/shared/db/types';

import {
  type CredentialConnector,
  listCredentialConnectors,
} from './credentials';

export interface HomeCredentialRow {
  connector: CredentialConnector;
  credential: SlackUserCredentialRow | null;
}

export interface HomeState {
  slackTeamId: string;
  slackUserId: string;
  configId: string;
  appVersion: string;
  /** Per-bot human-readable name (`channel_config.name`). Falls back to "Neumar". */
  botName: string;
  /** When `null`, the user is unpaired — the view shows the connect prompt. */
  link: SlackUserLink | null;
  /** Credentials list — every connector decorated with the user's saved row if any. */
  credentials: HomeCredentialRow[];
  /** MCP servers owned by this user. */
  mcp: SlackUserMcpRow[];
  /** Per-bot policy for user-added MCP servers. Drives the MCP section. */
  mcpPolicy: SlackUserMcpPolicy;
}

export interface HomeStateInput {
  slackTeamId: string;
  slackUserId: string;
  configId: string;
  appVersion: string;
}

export function loadHomeState(input: HomeStateInput): HomeState {
  const link = getSlackUserLink(input.slackTeamId, input.slackUserId);
  const botConfig = getChannelConfigById(input.configId);
  const allowlist = parseAllowlist(
    botConfig?.cred_connectors_allowlist ?? null,
  );
  const mcpPolicy: SlackUserMcpPolicy = botConfig?.user_mcp_policy ?? 'open';
  const botName = botConfig?.name?.trim() || 'Neumar';

  if (!link) {
    return {
      ...input,
      botName,
      link: null,
      credentials: [],
      mcp: [],
      mcpPolicy,
    };
  }

  const stored = listSlackUserCredentials(input.slackTeamId, input.slackUserId);
  const byProvider = new Map(stored.map((c) => [c.provider, c]));
  const allConnectors = listCredentialConnectors();
  const filtered = allowlist
    ? allConnectors.filter((c) => allowlist.has(c.key))
    : allConnectors;
  const credentials: HomeCredentialRow[] = filtered.map((connector) => ({
    connector,
    credential: byProvider.get(connector.key) ?? null,
  }));

  const mcp =
    mcpPolicy === 'disabled'
      ? []
      : listSlackUserMcp(input.slackTeamId, input.slackUserId);
  return { ...input, botName, link, credentials, mcp, mcpPolicy };
}

/**
 * Parse a CSV allowlist string.
 *   • `null` → `null` = "all connectors allowed" (default).
 *   • `""`   → empty `Set` = "block every connector" (admin opted out).
 *   • CSV    → `Set` of allowed keys.
 *
 * Distinguishing empty-string from null is what lets an admin who unchecks
 * every box actually block all credential entry — without it, "no items"
 * silently meant "all allowed".
 */
function parseAllowlist(raw: string | null): Set<string> | null {
  if (raw === null) return null;
  const items = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set(items);
}

/**
 * Routing mode options. Wording mirrors Anthropic's Claude-for-Slack
 * "Code Only / Code + Chat" pattern but adapts to our chat-or-task split.
 * The default ("Smart routing") matches Claude's "Code + Chat" — let the
 * agent decide per message; the user can still force task mode for the
 * cases where they know it's heavy.
 */
export const ROUTING_MODE_OPTIONS: ReadonlyArray<{
  value: RoutingMode;
  label: string;
  description: string;
}> = [
  {
    value: 'auto',
    label: 'Smart routing',
    description: 'Let the agent decide chat vs task per message',
  },
  {
    value: 'chat',
    label: 'Chat only',
    description: 'Answer in the thread, never spawn a long-running task',
  },
  {
    value: 'task',
    label: 'Tasks only',
    description: 'Treat every message as a task to execute',
  },
];
