/**
 * Slack App Home — per-user pairing, OAuth, and MCP tables.
 *
 * Implements the schema half of dev-doc/plan/2026-04-27-slack-app-home.md.
 * All three tables are added now (rather than once per phase) to avoid
 * schema churn as later phases ship handlers; only `slack_user_links` is
 * read/written by Phase 2 — `slack_user_oauth` and `slack_user_mcp` exist
 * but are unused until Phases 3 and 4.
 *
 * Design notes:
 *   • Composite key `(slack_team_id, slack_user_id)` everywhere — never
 *     index by `slack_user_id` alone (would leak across teams if multi-
 *     tenant install lands later).
 *   • `dek_wrapped` lives on `slack_user_links`; OAuth/MCP rows reference
 *     the user's link record implicitly via the same composite key, so
 *     deleting one link row crypto-shreds every dependent secret.
 *   • `pending_admin_approval` on `slack_user_mcp` supports the
 *     `admin-approved` MCP policy (decision D3).
 *   • `webui_sessions` extended with `(slack_team_id, slack_user_id)` so
 *     `app_uninstalled` / `tokens_revoked` can revoke families in one
 *     DELETE — see decision D1.
 */

import type Database from 'better-sqlite3';

import type { Migration } from './runner';
import { addColumnIfMissing } from './utils';

export const migration: Migration = {
  version: 70,
  description: 'Slack App Home: per-user pairing, OAuth, and MCP tables',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS slack_user_links (
        slack_team_id      TEXT NOT NULL,
        slack_user_id      TEXT NOT NULL,
        config_id          TEXT NOT NULL,
        channel_user_id    TEXT,
        email              TEXT,
        display_name       TEXT,
        routing_mode       TEXT NOT NULL DEFAULT 'auto',
        notify_on_done     INTEGER NOT NULL DEFAULT 1,
        dek_wrapped_iv     TEXT NOT NULL,
        dek_wrapped_ct     TEXT NOT NULL,
        dek_wrapped_tag    TEXT NOT NULL,
        linked_at          TEXT NOT NULL DEFAULT (datetime('now')),
        last_seen_at       TEXT,
        PRIMARY KEY (slack_team_id, slack_user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_slack_user_links_config
        ON slack_user_links(config_id);

      CREATE INDEX IF NOT EXISTS idx_slack_user_links_channel_user
        ON slack_user_links(channel_user_id);

      CREATE TABLE IF NOT EXISTS slack_user_oauth (
        slack_team_id   TEXT NOT NULL,
        slack_user_id   TEXT NOT NULL,
        provider        TEXT NOT NULL,
        account_label   TEXT,
        access_iv       TEXT NOT NULL,
        access_ct       TEXT NOT NULL,
        access_tag      TEXT NOT NULL,
        refresh_iv      TEXT,
        refresh_ct      TEXT,
        refresh_tag     TEXT,
        scopes_json     TEXT,
        expires_at      TEXT,
        connected_at    TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (slack_team_id, slack_user_id, provider)
      );

      CREATE TABLE IF NOT EXISTS slack_user_mcp (
        id                       TEXT PRIMARY KEY,
        slack_team_id            TEXT NOT NULL,
        slack_user_id            TEXT NOT NULL,
        name                     TEXT NOT NULL,
        transport                TEXT NOT NULL,
        url                      TEXT,
        command                  TEXT,
        args_json                TEXT,
        env_iv                   TEXT,
        env_ct                   TEXT,
        env_tag                  TEXT,
        enabled                  INTEGER NOT NULL DEFAULT 1,
        pending_admin_approval   INTEGER NOT NULL DEFAULT 0,
        created_at               TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_slack_user_mcp_user
        ON slack_user_mcp(slack_team_id, slack_user_id);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_slack_user_mcp_unique_name
        ON slack_user_mcp(slack_team_id, slack_user_id, name);
    `);

    addColumnIfMissing(db, 'webui_sessions', 'slack_team_id', 'TEXT');
    addColumnIfMissing(db, 'webui_sessions', 'slack_user_id', 'TEXT');
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_webui_sessions_slack_user
        ON webui_sessions(slack_team_id, slack_user_id);
    `);
  },
};
