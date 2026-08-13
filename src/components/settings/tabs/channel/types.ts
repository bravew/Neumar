export type Platform =
  | 'telegram'
  | 'lark'
  | 'discord'
  | 'slack'
  | 'imessage'
  | 'whatsapp';
export type PermissionTier = 'viewer' | 'operator' | 'admin';
export type PanelTab = 'config' | 'users' | 'audit';
export type ChannelRuntimeClass = 'official' | 'bridge' | 'experimental';

export interface ChannelCapabilities {
  supportsEditMessage: boolean;
  supportsThreads: boolean;
  supportsButtons: boolean;
  supportsSelects: boolean;
  supportsModals: boolean;
  supportsDatePicker: boolean;
  supportsReactions: boolean;
  supportsTyping: boolean;
  supportsUnfurlControl: boolean;
  supportsFileUpload: boolean;
  maxMessageLength: number;
  maxAttachmentBytes: number;
  maxAttachmentsPerMessage: number;
  supportsMarkdown: 'none' | 'basic' | 'full';
  runtimeClass: ChannelRuntimeClass;
}

export interface ChannelStatus {
  platform: string;
  name: string | null;
  state: 'running' | 'stopped' | 'initializing' | 'created' | 'stopping';
  capabilities?: ChannelCapabilities;
  runtimeClass?: ChannelRuntimeClass;
}

export interface ChannelUser {
  id: string;
  platform_user_id: string;
  display_name: string | null;
  approved_at: string | null;
  permission_tier: PermissionTier;
  token_budget: number;
}

export interface AuditEntry {
  id: string;
  action: string;
  channel_user_id: string | null;
  platform: string;
  details: string;
  created_at: string;
}

export interface PlatformConfig {
  /** UUID config ID — unique per bot instance */
  id: string;
  platform: Platform;
  /** Human-readable bot name */
  name: string | null;
  token: string | null;
  mode: string;
  rate_limit: number;
  enabled: boolean;
  configured: boolean;
  guardrails_provider: string | null;
  guardrails_fail_mode: 'open' | 'closed' | null;
  model: string | null;
  /** When true, only respond to @-mentions in guild channels (Discord). */
  mention_only: boolean;
  /** Agent profile ID — when set, the channel uses this profile's soul/system_prompt. */
  agent_profile_id: string | null;
  /** 'open' = auto-approve new users; 'gated' = require /pair code. */
  access_mode: 'open' | 'gated';
  /**
   * Slack App Home — comma-separated allowlist of credential connector keys
   * (e.g. `github,linear`). `null` / empty = all connectors allowed.
   */
  cred_connectors_allowlist: string | null;
  /**
   * Slack App Home — admin policy for user-added MCP servers.
   *   `open`           = users self-add (default)
   *   `admin-approved` = rows insert pending; admin reviews
   *   `disabled`       = MCP section hidden on Home
   */
  user_mcp_policy: 'open' | 'admin-approved' | 'disabled';
}

export const PLATFORMS: Platform[] = [
  'telegram',
  'lark',
  'discord',
  'slack',
  'imessage',
  'whatsapp',
];

export const PLATFORM_LABELS: Record<Platform, string> = {
  telegram: 'Telegram',
  lark: 'Lark / Feishu',
  discord: 'Discord',
  slack: 'Slack',
  imessage: 'iMessage',
  whatsapp: 'WhatsApp',
};

export const PLATFORM_DOC_URLS: Record<Platform, string> = {
  telegram: 'https://core.telegram.org/bots/tutorial',
  lark: 'https://open.larksuite.com/document/home/index',
  discord: 'https://discord.com/developers/docs/quick-start/getting-started',
  slack: 'https://docs.slack.dev/authentication/tokens/#bot',
  imessage: 'https://bluebubbles.app/install/',
  whatsapp: 'https://www.whatsapp.com/legal/terms-of-service',
};

export const DEFAULT_CONFIG: PlatformConfig = {
  id: '',
  platform: 'telegram',
  name: null,
  token: null,
  mode: 'polling',
  rate_limit: 10,
  enabled: false,
  configured: false,
  guardrails_provider: null,
  guardrails_fail_mode: null,
  model: null,
  mention_only: false,
  agent_profile_id: null,
  access_mode: 'open',
  cred_connectors_allowlist: null,
  user_mcp_policy: 'open',
};

/**
 * Connectors offered in the Slack App Home credential modal. Mirrors the
 * backend registry at `src-api/src/shared/channels/slack/home/credentials.ts`.
 * Keep both in sync — adding a connector requires entries on both sides.
 */
export type McpPolicy = PlatformConfig['user_mcp_policy'];

export const SLACK_HOME_CONNECTORS: ReadonlyArray<{
  key: string;
  label: string;
}> = [
  { key: 'linear', label: 'Linear' },
  { key: 'anthropic', label: 'Anthropic API' },
  { key: 'openai', label: 'OpenAI API' },
];

/**
 * Parse a CSV allowlist string.
 *   • `null` → `null` = "all connectors allowed" (default — registry can grow).
 *   • `""`   → empty `Set` = "block every connector" (admin opted out).
 *   • CSV    → `Set` of allowed keys.
 */
export function parseConnectorAllowlist(
  raw: string | null,
): Set<string> | null {
  if (raw === null) return null;
  const items = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set(items);
}

/**
 * Convert a checked-set back to wire format.
 *   • All checked  → `null`  ("all allowed", future-proof if registry grows).
 *   • None checked → `""`    (explicit "block all" sentinel).
 *   • Some checked → CSV.
 */
export function stringifyConnectorAllowlist(
  selected: Set<string>,
  total: number,
): string | null {
  if (selected.size >= total) return null;
  if (selected.size === 0) return '';
  return Array.from(selected).join(',');
}

export const INPUT_CLASS =
  'border-input bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-offset-1';
