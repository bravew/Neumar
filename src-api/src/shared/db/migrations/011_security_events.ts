/**
 * Phase 7 — Security audit tables.
 *
 * `security_events` is the canonical redacted audit log for sandbox enforcement,
 * tool-output verdicts, canary hits, and reduced-isolation transitions.
 *
 * `network_policy_audit` records the higher-volume per-request egress decisions
 * separately so security_events stays readable. Both tables hold redacted
 * snippets and payload hashes only — never raw sensitive payload bytes.
 */

import type Database from 'better-sqlite3';

import type { Migration } from './runner';

export const migration: Migration = {
  version: 55,
  description: 'Phase 7 security_events + network_policy_audit',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS security_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        session_id TEXT,
        task_id TEXT,
        event_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        source TEXT NOT NULL,
        action TEXT NOT NULL,
        payload_hash TEXT,
        redacted_snippet TEXT,
        metadata_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_security_events_session
        ON security_events(session_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_security_events_type
        ON security_events(event_type, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_security_events_severity
        ON security_events(severity, created_at DESC);

      CREATE TABLE IF NOT EXISTS network_policy_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        session_id TEXT,
        task_id TEXT,
        decision TEXT NOT NULL,
        reason TEXT,
        method TEXT,
        host TEXT,
        port INTEGER,
        scheme TEXT,
        resolved_ip TEXT,
        redirect_chain TEXT,
        canary_hit INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_network_policy_audit_session
        ON network_policy_audit(session_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_network_policy_audit_decision
        ON network_policy_audit(decision, created_at DESC);
    `);
  },
};
