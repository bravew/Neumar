/**
 * Gateway Database Schema
 *
 * DDL for gateway_* tables. Called during database initialization.
 */

import type Database from 'better-sqlite3';

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('GatewaySchema');

export function initializeGatewaySchema(database: Database.Database): void {
  logger.info('Initializing gateway tables...');

  database.exec(`
    CREATE TABLE IF NOT EXISTS gateway_channels (
      id TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 0,
      config TEXT NOT NULL DEFAULT '{}',
      status TEXT DEFAULT 'disconnected',
      last_error TEXT,
      last_connected_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS gateway_identities (
      id TEXT PRIMARY KEY,
      user_alias TEXT,
      permission_tier TEXT DEFAULT 'viewer',
      token_budget INTEGER DEFAULT 0,
      tokens_used_today INTEGER DEFAULT 0,
      budget_reset_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS gateway_identity_channels (
      id TEXT PRIMARY KEY,
      identity_id TEXT NOT NULL REFERENCES gateway_identities(id),
      channel_id TEXT NOT NULL,
      channel_user_id TEXT NOT NULL,
      channel_username TEXT,
      metadata TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(channel_id, channel_user_id)
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS gateway_sessions (
      id TEXT PRIMARY KEY,
      identity_id TEXT NOT NULL REFERENCES gateway_identities(id),
      channel_id TEXT NOT NULL,
      channel_chat_id TEXT NOT NULL,
      api_session_id TEXT,
      api_task_id TEXT,
      linked_session_id TEXT,
      status TEXT DEFAULT 'active',
      context_summary TEXT,
      last_message_at TEXT,
      last_error TEXT,
      error_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_gw_session_identity
      ON gateway_sessions(identity_id);
    CREATE INDEX IF NOT EXISTS idx_gw_session_channel
      ON gateway_sessions(channel_id, channel_chat_id);
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS gateway_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES gateway_sessions(id),
      direction TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      channel_message_id TEXT,
      content TEXT NOT NULL,
      content_type TEXT DEFAULT 'text',
      metadata TEXT DEFAULT '{}',
      token_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'delivered',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_gw_msg_session
      ON gateway_messages(session_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_gw_msg_dedup
      ON gateway_messages(channel_id, channel_message_id)
      WHERE channel_message_id IS NOT NULL;
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS gateway_subscriptions (
      id TEXT PRIMARY KEY,
      identity_id TEXT NOT NULL REFERENCES gateway_identities(id),
      channel_id TEXT NOT NULL,
      channel_chat_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      filter TEXT DEFAULT '{}',
      enabled INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_gw_sub_event
      ON gateway_subscriptions(event_type, enabled);
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS gateway_audit_log (
      id TEXT PRIMARY KEY,
      identity_id TEXT,
      channel_id TEXT,
      action TEXT NOT NULL,
      details TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_gw_audit_time
      ON gateway_audit_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_gw_audit_identity
      ON gateway_audit_log(identity_id, created_at);
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS routing_rules (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL DEFAULT '*',
      channel_id TEXT NOT NULL DEFAULT '*',
      chat_pattern TEXT NOT NULL DEFAULT '*',
      intent TEXT NOT NULL DEFAULT '*',
      profile_id TEXT NOT NULL,
      model_override TEXT,
      priority INTEGER NOT NULL DEFAULT 100,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_routing_rules_lookup
      ON routing_rules(enabled, workspace_id, channel_id, intent, priority);
  `);

  logger.info('Gateway tables initialized');
}
