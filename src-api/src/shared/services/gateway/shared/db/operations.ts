/**
 * Gateway Database Operations
 *
 * CRUD helpers for gateway_* tables.
 */

import { getDatabase } from '@/shared/db';

import type {
  GatewayAuditEntry,
  GatewayChannel,
  GatewayIdentity,
  GatewayIdentityChannel,
  GatewayMessage,
  GatewaySession,
  GatewaySubscription,
  RoutingRule,
  PermissionTier,
} from '../../channels/types';

// ============================================================================
// Channel Operations
// ============================================================================

export function getChannelConfig(id: string): GatewayChannel | null {
  const db = getDatabase();
  return (
    (db
      .prepare('SELECT * FROM gateway_channels WHERE id = ?')
      .get(id) as GatewayChannel) ?? null
  );
}

export function getAllChannels(): GatewayChannel[] {
  const db = getDatabase();
  return db
    .prepare('SELECT * FROM gateway_channels ORDER BY id')
    .all() as GatewayChannel[];
}

export function upsertChannel(
  id: string,
  config: string,
  enabled: number,
): void {
  const db = getDatabase();
  db.prepare(
    `
    INSERT INTO gateway_channels (id, config, enabled, created_at, updated_at)
    VALUES (?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(id) DO UPDATE SET config = excluded.config, enabled = excluded.enabled, updated_at = datetime('now')
  `,
  ).run(id, config, enabled);
}

export function updateChannelStatus(
  id: string,
  status:
    | 'connected'
    | 'degraded'
    | 'quarantined'
    | 'disabled'
    | 'disconnected'
    | 'error',
  error?: string,
): void {
  const db = getDatabase();
  if (status === 'connected') {
    db.prepare(
      `
      UPDATE gateway_channels SET status = ?, last_error = NULL, last_connected_at = datetime('now'), updated_at = datetime('now') WHERE id = ?
    `,
    ).run(status, id);
  } else {
    db.prepare(
      `
      UPDATE gateway_channels SET status = ?, last_error = ?, updated_at = datetime('now') WHERE id = ?
    `,
    ).run(status, error ?? null, id);
  }
}

// ============================================================================
// Routing Rule Operations
// ============================================================================

export function getEnabledRoutingRules(): RoutingRule[] {
  const db = getDatabase();
  return db
    .prepare(
      `
    SELECT * FROM routing_rules
    WHERE enabled = 1
    ORDER BY priority DESC, updated_at DESC
  `,
    )
    .all() as RoutingRule[];
}

export function getAllRoutingRules(): RoutingRule[] {
  const db = getDatabase();
  return db
    .prepare(
      'SELECT * FROM routing_rules ORDER BY priority DESC, updated_at DESC',
    )
    .all() as RoutingRule[];
}

export function getRoutingRule(id: string): RoutingRule | null {
  const db = getDatabase();
  return (
    (db
      .prepare('SELECT * FROM routing_rules WHERE id = ?')
      .get(id) as RoutingRule) ?? null
  );
}

export interface RoutingRuleInput {
  workspace_id?: string;
  channel_id?: string;
  chat_pattern?: string;
  intent?: RoutingRule['intent'];
  profile_id: string;
  model_override?: string | null;
  priority?: number;
  enabled?: number;
}

export function createRoutingRule(
  id: string,
  input: RoutingRuleInput,
): RoutingRule {
  const db = getDatabase();
  db.prepare(
    `
    INSERT INTO routing_rules
      (id, workspace_id, channel_id, chat_pattern, intent, profile_id,
       model_override, priority, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `,
  ).run(
    id,
    input.workspace_id ?? '*',
    input.channel_id ?? '*',
    input.chat_pattern ?? '*',
    input.intent ?? '*',
    input.profile_id,
    input.model_override ?? null,
    input.priority ?? 100,
    input.enabled ?? 1,
  );
  return getRoutingRule(id)!;
}

const ROUTING_RULE_COLUMNS = new Set([
  'workspace_id',
  'channel_id',
  'chat_pattern',
  'intent',
  'profile_id',
  'model_override',
  'priority',
  'enabled',
]);

export function updateRoutingRule(
  id: string,
  updates: Partial<RoutingRuleInput>,
): RoutingRule | null {
  const db = getDatabase();
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, val] of Object.entries(updates)) {
    if (!ROUTING_RULE_COLUMNS.has(key)) continue;
    sets.push(`${key} = ?`);
    values.push(val ?? null);
  }
  if (sets.length === 0) return getRoutingRule(id);
  sets.push("updated_at = datetime('now')");
  values.push(id);
  db.prepare(`UPDATE routing_rules SET ${sets.join(', ')} WHERE id = ?`).run(
    ...values,
  );
  return getRoutingRule(id);
}

export function deleteRoutingRule(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM routing_rules WHERE id = ?').run(id);
  return result.changes > 0;
}

// ============================================================================
// Identity Operations
// ============================================================================

export function getIdentity(id: string): GatewayIdentity | null {
  const db = getDatabase();
  return (
    (db
      .prepare('SELECT * FROM gateway_identities WHERE id = ?')
      .get(id) as GatewayIdentity) ?? null
  );
}

export function getAllIdentities(): GatewayIdentity[] {
  const db = getDatabase();
  return db
    .prepare('SELECT * FROM gateway_identities ORDER BY created_at DESC')
    .all() as GatewayIdentity[];
}

export function createIdentity(
  id: string,
  alias: string | null,
  tier: PermissionTier,
  tokenBudget: number,
): GatewayIdentity {
  const db = getDatabase();
  db.prepare(
    `
    INSERT INTO gateway_identities (id, user_alias, permission_tier, token_budget, created_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `,
  ).run(id, alias, tier, tokenBudget);
  return getIdentity(id)!;
}

const IDENTITY_ALLOWED_COLUMNS = new Set([
  'user_alias',
  'permission_tier',
  'token_budget',
]);

export function updateIdentity(
  id: string,
  updates: {
    user_alias?: string | null;
    permission_tier?: PermissionTier;
    token_budget?: number;
  },
): void {
  const db = getDatabase();
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, val] of Object.entries(updates)) {
    if (!IDENTITY_ALLOWED_COLUMNS.has(key)) continue;
    sets.push(`${key} = ?`);
    values.push(val ?? null);
  }
  if (sets.length === 0) return;
  values.push(id);
  db.prepare(
    `UPDATE gateway_identities SET ${sets.join(', ')} WHERE id = ?`,
  ).run(...values);
}

export function deleteIdentity(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM gateway_identity_channels WHERE identity_id = ?').run(
    id,
  );
  db.prepare('DELETE FROM gateway_subscriptions WHERE identity_id = ?').run(id);
  db.prepare('DELETE FROM gateway_identities WHERE id = ?').run(id);
}

export function updateTokenUsage(identityId: string, tokensUsed: number): void {
  const db = getDatabase();
  db.prepare(
    `
    UPDATE gateway_identities SET tokens_used_today = tokens_used_today + ? WHERE id = ?
  `,
  ).run(tokensUsed, identityId);
}

export function resetTokenBudgets(): void {
  const db = getDatabase();
  db.prepare(
    `
    UPDATE gateway_identities SET tokens_used_today = 0, budget_reset_at = datetime('now')
  `,
  ).run();
}

// ============================================================================
// Identity-Channel Link Operations
// ============================================================================

export function getIdentityByChannelUser(
  channelId: string,
  channelUserId: string,
): GatewayIdentity | null {
  const db = getDatabase();
  const link = db
    .prepare(
      `
    SELECT identity_id FROM gateway_identity_channels WHERE channel_id = ? AND channel_user_id = ?
  `,
    )
    .get(channelId, channelUserId) as { identity_id: string } | undefined;
  if (!link) return null;
  return getIdentity(link.identity_id);
}

export function linkIdentityChannel(
  id: string,
  identityId: string,
  channelId: string,
  channelUserId: string,
  channelUsername: string | null,
): void {
  const db = getDatabase();
  db.prepare(
    `
    INSERT INTO gateway_identity_channels (id, identity_id, channel_id, channel_user_id, channel_username, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(channel_id, channel_user_id) DO UPDATE SET identity_id = excluded.identity_id, channel_username = excluded.channel_username
  `,
  ).run(id, identityId, channelId, channelUserId, channelUsername);
}

export function getIdentityChannels(
  identityId: string,
): GatewayIdentityChannel[] {
  const db = getDatabase();
  return db
    .prepare('SELECT * FROM gateway_identity_channels WHERE identity_id = ?')
    .all(identityId) as GatewayIdentityChannel[];
}

// ============================================================================
// Session Operations
// ============================================================================

export function getSession(
  channelId: string,
  chatId: string,
  identityId: string,
): GatewaySession | null {
  const db = getDatabase();
  return (
    (db
      .prepare(
        `
    SELECT * FROM gateway_sessions
    WHERE channel_id = ? AND channel_chat_id = ? AND identity_id = ? AND status = 'active'
    ORDER BY updated_at DESC LIMIT 1
  `,
      )
      .get(channelId, chatId, identityId) as GatewaySession) ?? null
  );
}

export function getSessionById(id: string): GatewaySession | null {
  const db = getDatabase();
  return (
    (db
      .prepare('SELECT * FROM gateway_sessions WHERE id = ?')
      .get(id) as GatewaySession) ?? null
  );
}

export function createSession(
  id: string,
  identityId: string,
  channelId: string,
  chatId: string,
): GatewaySession {
  const db = getDatabase();
  db.prepare(
    `
    INSERT INTO gateway_sessions (id, identity_id, channel_id, channel_chat_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
  `,
  ).run(id, identityId, channelId, chatId);
  return getSessionById(id)!;
}

const SESSION_ALLOWED_COLUMNS = new Set([
  'api_session_id',
  'api_task_id',
  'linked_session_id',
  'status',
  'context_summary',
  'last_message_at',
  'last_error',
  'error_count',
]);

export function updateSession(
  id: string,
  updates: Partial<
    Pick<
      GatewaySession,
      | 'api_session_id'
      | 'api_task_id'
      | 'linked_session_id'
      | 'status'
      | 'context_summary'
      | 'last_message_at'
      | 'last_error'
      | 'error_count'
    >
  >,
): void {
  const db = getDatabase();
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, val] of Object.entries(updates)) {
    if (!SESSION_ALLOWED_COLUMNS.has(key)) continue;
    sets.push(`${key} = ?`);
    values.push(val ?? null);
  }
  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");
  values.push(id);
  db.prepare(`UPDATE gateway_sessions SET ${sets.join(', ')} WHERE id = ?`).run(
    ...values,
  );
}

// ============================================================================
// Message Operations
// ============================================================================

export function insertMessage(msg: Omit<GatewayMessage, 'created_at'>): void {
  const db = getDatabase();
  db.prepare(
    `
    INSERT OR IGNORE INTO gateway_messages (id, session_id, direction, channel_id, channel_message_id, content, content_type, metadata, token_count, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `,
  ).run(
    msg.id,
    msg.session_id,
    msg.direction,
    msg.channel_id,
    msg.channel_message_id,
    msg.content,
    msg.content_type,
    msg.metadata,
    msg.token_count,
    msg.status,
  );
}

export function isDuplicateMessage(
  channelId: string,
  channelMessageId: string,
): boolean {
  if (!channelMessageId) return false;
  const db = getDatabase();
  const row = db
    .prepare(
      `
    SELECT 1 FROM gateway_messages WHERE channel_id = ? AND channel_message_id = ? LIMIT 1
  `,
    )
    .get(channelId, channelMessageId);
  return !!row;
}

export function getSessionMessages(
  sessionId: string,
  limit = 50,
): GatewayMessage[] {
  const db = getDatabase();
  return db
    .prepare(
      `
    SELECT * FROM gateway_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?
  `,
    )
    .all(sessionId, limit) as GatewayMessage[];
}

// ============================================================================
// Subscription Operations
// ============================================================================

export function getSubscriptions(eventType: string): GatewaySubscription[] {
  const db = getDatabase();
  return db
    .prepare(
      `
    SELECT * FROM gateway_subscriptions WHERE (event_type = ? OR event_type = '*') AND enabled = 1
  `,
    )
    .all(eventType) as GatewaySubscription[];
}

export function getIdentitySubscriptions(
  identityId: string,
): GatewaySubscription[] {
  const db = getDatabase();
  return db
    .prepare('SELECT * FROM gateway_subscriptions WHERE identity_id = ?')
    .all(identityId) as GatewaySubscription[];
}

export function createSubscription(
  id: string,
  identityId: string,
  channelId: string,
  chatId: string,
  eventType: string,
): void {
  const db = getDatabase();
  db.prepare(
    `
    INSERT INTO gateway_subscriptions (id, identity_id, channel_id, channel_chat_id, event_type, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `,
  ).run(id, identityId, channelId, chatId, eventType);
}

export function deleteSubscription(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM gateway_subscriptions WHERE id = ?').run(id);
}

export function getAllSubscriptions(): GatewaySubscription[] {
  const db = getDatabase();
  return db
    .prepare('SELECT * FROM gateway_subscriptions ORDER BY created_at DESC')
    .all() as GatewaySubscription[];
}

// ============================================================================
// Audit Log Operations
// ============================================================================

export function writeAuditLog(
  id: string,
  identityId: string | null,
  channelId: string | null,
  action: string,
  details: Record<string, unknown> = {},
): void {
  const db = getDatabase();
  db.prepare(
    `
    INSERT INTO gateway_audit_log (id, identity_id, channel_id, action, details, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `,
  ).run(id, identityId, channelId, action, JSON.stringify(details));
}

export function getAuditLog(
  options: {
    page?: number;
    limit?: number;
    identityId?: string;
    action?: string;
  } = {},
): { entries: GatewayAuditEntry[]; total: number } {
  const db = getDatabase();
  const page = options.page ?? 1;
  const limit = options.limit ?? 50;
  const offset = (page - 1) * limit;

  const where: string[] = [];
  const params: unknown[] = [];

  if (options.identityId) {
    where.push('identity_id = ?');
    params.push(options.identityId);
  }
  if (options.action) {
    where.push('action = ?');
    params.push(options.action);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const total = (
    db
      .prepare(`SELECT COUNT(*) as count FROM gateway_audit_log ${whereClause}`)
      .get(...params) as { count: number }
  ).count;

  const entries = db
    .prepare(
      `
    SELECT * FROM gateway_audit_log ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?
  `,
    )
    .all(...params, limit, offset) as GatewayAuditEntry[];

  return { entries, total };
}

export function clearGatewayAuditLog(): number {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM gateway_audit_log').run();
  return result.changes;
}
