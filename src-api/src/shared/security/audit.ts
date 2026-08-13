/**
 * Security audit sink.
 *
 * Two destinations, both redacted:
 *   1. JSONL append at `~/<APP_DATA_DIR>/security/events.jsonl` — durable,
 *      out-of-band of the SQLite database, useful for forensic export.
 *   2. SQLite `security_events` row — short summary for in-app review.
 *
 * Raw sensitive payloads are NEVER persisted. Callers pass a payload hash
 * (e.g. SHA-256) plus a redacted snippet that has already been run through
 * `redactValue()` from the shared logger. The audit layer never re-derives
 * a hash from raw bytes the caller has not chosen to expose.
 */

import { existsSync, mkdirSync } from 'fs';
import { appendFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';

import { APP_DATA_DIR } from '@/config/branding';

import { getDatabase } from '@/shared/db';
import { createLogger, redactValue } from '@/shared/utils/logger';

const logger = createLogger('SecurityAudit');

const SECURITY_DIR = join(homedir(), APP_DATA_DIR, 'security');
const EVENTS_JSONL = join(SECURITY_DIR, 'events.jsonl');

export type SecurityEventSeverity = 'info' | 'warn' | 'error' | 'critical';

export type SecurityEventType =
  | 'sandbox.reduced_isolation'
  | 'sandbox.marketplace_blocked'
  | 'network.deny'
  | 'network.allow'
  | 'network.redirect_blocked'
  | 'network.canary_leak'
  | 'tool_output.block'
  | 'tool_output.warn'
  | 'tool_output.hitl_required'
  | 'tool_output.allow'
  | 'canary.mint'
  | 'canary.leak'
  | 'tauri.scope_violation'
  | (string & {});

export interface SecurityEventInput {
  sessionId?: string;
  taskId?: string;
  eventType: SecurityEventType;
  severity: SecurityEventSeverity;
  /** Component that detected the event, e.g. 'NetworkPolicy', 'OpenAICompatAdapter'. */
  source: string;
  /** Outcome verb: 'block', 'allow', 'warn', 'redact', 'audit'. */
  action: string;
  /** SHA-256 (or other) hash of the offending payload, hex. Optional. */
  payloadHash?: string;
  /**
   * Short, already-redacted snippet for human triage.
   * Must NEVER contain raw secrets, raw canary tokens, or full PII.
   * Caller is responsible for redaction; we pass through verbatim.
   */
  redactedSnippet?: string;
  /** Free-form structured metadata; ran through redactValue() before persisting. */
  metadata?: Record<string, unknown>;
}

let dirEnsured = false;
function ensureDir() {
  if (dirEnsured) return;
  try {
    if (!existsSync(SECURITY_DIR)) {
      mkdirSync(SECURITY_DIR, { recursive: true });
    }
    dirEnsured = true;
  } catch (err) {
    logger.warn('Failed to ensure security audit directory', { err });
  }
}

const SNIPPET_MAX = 512;

function clampSnippet(value: string | undefined): string | null {
  if (!value) return null;
  return value.length > SNIPPET_MAX ? value.slice(0, SNIPPET_MAX) + '…' : value;
}

/**
 * Record a security event. Fire-and-forget for the JSONL side; the SQLite
 * insert is synchronous but small.
 */
export function recordSecurityEvent(event: SecurityEventInput): void {
  const ts = new Date().toISOString();
  const snippet = clampSnippet(event.redactedSnippet);
  const safeMetadata =
    event.metadata !== undefined ? redactValue(event.metadata) : undefined;

  // SQLite summary
  try {
    const db = getDatabase();
    db.prepare(
      `INSERT INTO security_events
        (created_at, session_id, task_id, event_type, severity, source, action, payload_hash, redacted_snippet, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      ts,
      event.sessionId ?? null,
      event.taskId ?? null,
      event.eventType,
      event.severity,
      event.source,
      event.action,
      event.payloadHash ?? null,
      snippet,
      safeMetadata !== undefined ? JSON.stringify(safeMetadata) : null,
    );
  } catch (err) {
    logger.error('Failed to insert security_events row', { err });
  }

  // JSONL durable record
  ensureDir();
  const line =
    JSON.stringify({
      ts,
      sessionId: event.sessionId,
      taskId: event.taskId,
      eventType: event.eventType,
      severity: event.severity,
      source: event.source,
      action: event.action,
      payloadHash: event.payloadHash,
      redactedSnippet: snippet,
      metadata: safeMetadata,
    }) + '\n';

  appendFile(EVENTS_JSONL, line).catch((err) => {
    logger.warn('Failed to append security events JSONL', { err });
  });
}

export interface NetworkPolicyAuditInput {
  sessionId?: string;
  taskId?: string;
  decision:
    | 'allow'
    | 'deny'
    | 'redirect_blocked'
    | 'canary_blocked'
    | 'timeout';
  reason?: string;
  method?: string;
  host?: string;
  port?: number;
  scheme?: string;
  resolvedIp?: string;
  redirectChain?: string[];
  canaryHit?: boolean;
  metadata?: Record<string, unknown>;
}

export function recordNetworkPolicyAudit(input: NetworkPolicyAuditInput): void {
  const safeMetadata =
    input.metadata !== undefined ? redactValue(input.metadata) : undefined;
  try {
    const db = getDatabase();
    db.prepare(
      `INSERT INTO network_policy_audit
        (created_at, session_id, task_id, decision, reason, method, host, port, scheme, resolved_ip, redirect_chain, canary_hit, metadata_json)
       VALUES (datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.sessionId ?? null,
      input.taskId ?? null,
      input.decision,
      input.reason ?? null,
      input.method ?? null,
      input.host ?? null,
      input.port ?? null,
      input.scheme ?? null,
      input.resolvedIp ?? null,
      input.redirectChain ? JSON.stringify(input.redirectChain) : null,
      input.canaryHit ? 1 : 0,
      safeMetadata !== undefined ? JSON.stringify(safeMetadata) : null,
    );
  } catch (err) {
    logger.error('Failed to insert network_policy_audit row', { err });
  }
}

export const SECURITY_EVENTS_JSONL_PATH = EVENTS_JSONL;
