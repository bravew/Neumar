/**
 * Migration 003: Multi-bot instance support
 *
 * Re-keys the channel system from platform string to configId (UUID) so that
 * multiple independent bot instances can run on the same platform.
 *
 * Changes:
 * - Adds `name` column to channel_config for human-readable bot labels
 * - Adds `config_id` column to channel_users, channel_sessions, channel_messages,
 *   channel_audit_log, and channel_pairing_codes
 * - Backfills config_id from existing platform-matched configs
 * - Re-keys unique indexes from (platform, ...) to (config_id, ...)
 */

import type Database from 'better-sqlite3';

import type { Migration } from './runner';
import { addColumnIfMissing } from './utils';

export const migration: Migration = {
  version: 29,
  description:
    'Multi-bot instance support: re-key channels from platform to configId',
  up(db: Database.Database) {
    // 1. Add name column to channel_config
    addColumnIfMissing(db, 'channel_config', 'name', 'TEXT DEFAULT NULL');

    // 2. Add config_id to dependent tables
    const tables = [
      'channel_users',
      'channel_sessions',
      'channel_messages',
      'channel_audit_log',
      'channel_pairing_codes',
    ];
    for (const table of tables) {
      addColumnIfMissing(db, table, 'config_id', 'TEXT DEFAULT NULL');
    }

    // 3. Backfill config_id from existing platform-matched configs
    // Each table has a `platform` column; join against channel_config to get the id.
    for (const table of tables) {
      db.exec(`
        UPDATE ${table} SET config_id = (
          SELECT id FROM channel_config
          WHERE channel_config.platform = ${table}.platform
          LIMIT 1
        )
        WHERE config_id IS NULL
      `);
    }

    // 4. Re-key unique indexes from (platform, ...) to (config_id, ...)

    // channel_users: (platform, platform_user_id) -> (config_id, platform_user_id)
    db.exec(`DROP INDEX IF EXISTS idx_channel_users_platform`);
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_users_config
       ON channel_users(config_id, platform_user_id)`,
    );

    // channel_sessions: (platform, session_key) -> (config_id, session_key)
    db.exec(`DROP INDEX IF EXISTS idx_channel_sessions_key`);
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_sessions_config_key
       ON channel_sessions(config_id, session_key)`,
    );

    // channel_messages: (platform, platform_message_id) -> (config_id, platform_message_id)
    db.exec(`DROP INDEX IF EXISTS idx_channel_messages_dedup`);
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_messages_config_dedup
       ON channel_messages(config_id, platform_message_id)
       WHERE platform_message_id IS NOT NULL`,
    );

    // 5. Index on channel_config.platform for getChannelConfigsByPlatform lookups
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_channel_config_platform
       ON channel_config(platform)`,
    );
  },
};
