/**
 * Per-bot toggles for the Slack App Home surface.
 *
 * Adds two columns to `channel_config`:
 *
 *   • `cred_connectors_allowlist` — comma-separated list of credential
 *     connector keys (e.g. `github,linear,anthropic`). Empty/NULL means
 *     "all connectors". Only applied to Slack-platform configs.
 *   • `user_mcp_policy` — one of `open` (default — users self-add MCP
 *     servers), `admin-approved` (rows land in
 *     `pending_admin_approval=1`), or `disabled` (MCP section hidden on
 *     Home).
 *
 * Both fields surface on `PUT /channels/configs/:id` via the existing
 * `upsertChannelConfigSchema` and are read at `loadHomeState` time.
 */

import type Database from 'better-sqlite3';

import type { Migration } from './runner';
import { addColumnIfMissing } from './utils';

export const migration: Migration = {
  version: 71,
  description: 'Slack App Home per-bot toggles (connectors + mcp policy)',
  up(db: Database.Database) {
    addColumnIfMissing(
      db,
      'channel_config',
      'cred_connectors_allowlist',
      'TEXT DEFAULT NULL',
    );
    addColumnIfMissing(
      db,
      'channel_config',
      'user_mcp_policy',
      "TEXT DEFAULT 'open'",
    );
  },
};
