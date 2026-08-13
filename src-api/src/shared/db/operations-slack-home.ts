/**
 * DB ops for Slack App Home tables (slack_user_links, slack_user_oauth,
 * slack_user_mcp). Kept in a separate file from `operations.ts` to keep
 * that file's already-heavy import surface stable.
 */

import crypto from 'node:crypto';

import {
  type Sealed,
  decryptWith,
  encryptWith,
  generateDek,
  unwrapDek as unwrapDekHelper,
  wrapDek,
} from '@/shared/security/secret-box';

import { getDatabase } from './index';

export type RoutingMode = 'auto' | 'chat' | 'task';

export interface SlackUserLink {
  slackTeamId: string;
  slackUserId: string;
  configId: string;
  channelUserId: string | null;
  email: string | null;
  displayName: string | null;
  routingMode: RoutingMode;
  notifyOnDone: boolean;
  linkedAt: string;
  lastSeenAt: string | null;
}

interface LinkRow {
  slack_team_id: string;
  slack_user_id: string;
  config_id: string;
  channel_user_id: string | null;
  email: string | null;
  display_name: string | null;
  routing_mode: string;
  notify_on_done: number;
  dek_wrapped_iv: string;
  dek_wrapped_ct: string;
  dek_wrapped_tag: string;
  linked_at: string;
  last_seen_at: string | null;
}

function rowToLink(row: LinkRow): SlackUserLink {
  return {
    slackTeamId: row.slack_team_id,
    slackUserId: row.slack_user_id,
    configId: row.config_id,
    channelUserId: row.channel_user_id,
    email: row.email,
    displayName: row.display_name,
    routingMode: (row.routing_mode as RoutingMode) ?? 'auto',
    notifyOnDone: row.notify_on_done === 1,
    linkedAt: row.linked_at,
    lastSeenAt: row.last_seen_at,
  };
}

export function getSlackUserLink(
  slackTeamId: string,
  slackUserId: string,
): SlackUserLink | null {
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT * FROM slack_user_links
        WHERE slack_team_id = ? AND slack_user_id = ?`,
    )
    .get(slackTeamId, slackUserId) as LinkRow | undefined;
  return row ? rowToLink(row) : null;
}

export interface CreateSlackUserLinkInput {
  slackTeamId: string;
  slackUserId: string;
  configId: string;
  channelUserId?: string | null;
  email?: string | null;
  displayName?: string | null;
}

/**
 * Create a Slack user link with a freshly generated DEK wrapped by the
 * server KEK. Idempotent on `(team, user)` — if a row exists, updates the
 * mutable fields but **does not rotate** the DEK (rotation requires
 * re-encrypting every dependent secret and is out of scope for v1).
 */
export function createSlackUserLink(
  input: CreateSlackUserLinkInput,
): SlackUserLink {
  const db = getDatabase();
  const existing = getSlackUserLink(input.slackTeamId, input.slackUserId);
  if (existing) {
    db.prepare(
      `UPDATE slack_user_links
         SET config_id = ?, channel_user_id = ?, email = ?, display_name = ?,
             last_seen_at = datetime('now')
        WHERE slack_team_id = ? AND slack_user_id = ?`,
    ).run(
      input.configId,
      input.channelUserId ?? null,
      input.email ?? null,
      input.displayName ?? null,
      input.slackTeamId,
      input.slackUserId,
    );
    const updated = getSlackUserLink(input.slackTeamId, input.slackUserId);
    if (!updated) {
      throw new Error('createSlackUserLink: row missing after UPDATE');
    }
    return updated;
  }

  const dek = generateDek();
  const wrapped: Sealed = wrapDek(dek);
  db.prepare(
    `INSERT INTO slack_user_links (
       slack_team_id, slack_user_id, config_id, channel_user_id, email,
       display_name, dek_wrapped_iv, dek_wrapped_ct, dek_wrapped_tag,
       last_seen_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  ).run(
    input.slackTeamId,
    input.slackUserId,
    input.configId,
    input.channelUserId ?? null,
    input.email ?? null,
    input.displayName ?? null,
    wrapped.iv,
    wrapped.ct,
    wrapped.tag,
  );
  const inserted = getSlackUserLink(input.slackTeamId, input.slackUserId);
  if (!inserted) {
    throw new Error('createSlackUserLink: row missing after INSERT');
  }
  return inserted;
}

export function unwrapDekFor(
  slackTeamId: string,
  slackUserId: string,
): Buffer | null {
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT dek_wrapped_iv AS iv, dek_wrapped_ct AS ct, dek_wrapped_tag AS tag
         FROM slack_user_links
        WHERE slack_team_id = ? AND slack_user_id = ?`,
    )
    .get(slackTeamId, slackUserId) as Sealed | undefined;
  if (!row) return null;
  return unwrapDekHelper(row);
}

export function setRoutingMode(
  slackTeamId: string,
  slackUserId: string,
  mode: RoutingMode,
): void {
  const db = getDatabase();
  db.prepare(
    `UPDATE slack_user_links SET routing_mode = ?
      WHERE slack_team_id = ? AND slack_user_id = ?`,
  ).run(mode, slackTeamId, slackUserId);
}

export function setNotifyOnDone(
  slackTeamId: string,
  slackUserId: string,
  enabled: boolean,
): void {
  const db = getDatabase();
  db.prepare(
    `UPDATE slack_user_links SET notify_on_done = ?
      WHERE slack_team_id = ? AND slack_user_id = ?`,
  ).run(enabled ? 1 : 0, slackTeamId, slackUserId);
}

export function touchSlackUserLink(
  slackTeamId: string,
  slackUserId: string,
): void {
  const db = getDatabase();
  db.prepare(
    `UPDATE slack_user_links SET last_seen_at = datetime('now')
      WHERE slack_team_id = ? AND slack_user_id = ?`,
  ).run(slackTeamId, slackUserId);
}

/**
 * Fully delete a user link and crypto-shred every dependent secret.
 * Cascade-deletes oauth + mcp rows; the wrapped DEK on the link row is
 * removed in the same transaction so any leftover ciphertext (e.g. an
 * in-flight backup) is unrecoverable.
 */
export function deleteSlackUserLink(
  slackTeamId: string,
  slackUserId: string,
): boolean {
  const db = getDatabase();
  const tx = db.transaction(() => {
    db.prepare(
      `DELETE FROM slack_user_oauth
        WHERE slack_team_id = ? AND slack_user_id = ?`,
    ).run(slackTeamId, slackUserId);
    db.prepare(
      `DELETE FROM slack_user_mcp
        WHERE slack_team_id = ? AND slack_user_id = ?`,
    ).run(slackTeamId, slackUserId);
    return db
      .prepare(
        `DELETE FROM slack_user_links
          WHERE slack_team_id = ? AND slack_user_id = ?`,
      )
      .run(slackTeamId, slackUserId);
  });
  return tx().changes > 0;
}

/**
 * Wipe every Slack-linked record for a team. Called on `app_uninstalled`.
 */
export function deleteSlackTeam(slackTeamId: string): number {
  const db = getDatabase();
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM slack_user_oauth WHERE slack_team_id = ?`).run(
      slackTeamId,
    );
    db.prepare(`DELETE FROM slack_user_mcp WHERE slack_team_id = ?`).run(
      slackTeamId,
    );
    return db
      .prepare(`DELETE FROM slack_user_links WHERE slack_team_id = ?`)
      .run(slackTeamId);
  });
  return tx().changes;
}

// ───────────────────────────────────────────────────────────────────────
// Per-user credentials (slack_user_oauth)
//
// v1 stores **personal access tokens / API keys** that the user pastes
// directly in the Slack Home modal — no OAuth flow involved. The
// `slack_user_oauth` table name is a misnomer for now; the schema is
// reused because the shape (encrypted access secret + scopes + label per
// provider per user) is identical. Future hosted-OAuth flow (per
// `dev-doc/plan/2026-04-27-slack-app-home-oauth-supabase.md`) will write
// to a separate Supabase table and merge at read time.
//
// The `refresh_*` columns are unused for PATs (always NULL).
// `account_label` carries the human label shown on Home (never the
// token). `scopes_json` is reserved.
// ───────────────────────────────────────────────────────────────────────

export interface SlackUserCredentialRow {
  slackTeamId: string;
  slackUserId: string;
  provider: string;
  accountLabel: string | null;
  /** Last 4 characters of the stored token, for display only. Never the full token. */
  tokenHint: string | null;
  scopes: string[];
  expiresAt: string | null;
  connectedAt: string;
}

interface CredRowDb {
  slack_team_id: string;
  slack_user_id: string;
  provider: string;
  account_label: string | null;
  access_iv: string;
  access_ct: string;
  access_tag: string;
  scopes_json: string | null;
  expires_at: string | null;
  connected_at: string;
}

function rowToCred(row: CredRowDb, dek: Buffer | null): SlackUserCredentialRow {
  let tokenHint: string | null = null;
  if (dek) {
    try {
      const tok = decryptWith(dek, {
        iv: row.access_iv,
        ct: row.access_ct,
        tag: row.access_tag,
      });
      tokenHint = tok.length >= 4 ? tok.slice(-4) : null;
    } catch {
      // Decryption failure (DEK rotated etc.) — surface a placeholder.
      tokenHint = null;
    }
  }
  return {
    slackTeamId: row.slack_team_id,
    slackUserId: row.slack_user_id,
    provider: row.provider,
    accountLabel: row.account_label,
    tokenHint,
    scopes: row.scopes_json ? (JSON.parse(row.scopes_json) as string[]) : [],
    expiresAt: row.expires_at,
    connectedAt: row.connected_at,
  };
}

export function listSlackUserCredentials(
  slackTeamId: string,
  slackUserId: string,
): SlackUserCredentialRow[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT slack_team_id, slack_user_id, provider, account_label,
              access_iv, access_ct, access_tag,
              scopes_json, expires_at, connected_at
         FROM slack_user_oauth
        WHERE slack_team_id = ? AND slack_user_id = ?
        ORDER BY provider`,
    )
    .all(slackTeamId, slackUserId) as CredRowDb[];
  if (rows.length === 0) return [];
  let dek: Buffer | null = null;
  try {
    dek = unwrapDekFor(slackTeamId, slackUserId);
  } catch {
    dek = null;
  }
  return rows.map((r) => rowToCred(r, dek));
}

export interface UpsertSlackUserCredentialInput {
  slackTeamId: string;
  slackUserId: string;
  provider: string;
  accountLabel: string | null;
  /** The PAT / API key to seal at rest. Never stored or logged in plaintext. */
  token: string;
  /** Optional metadata; unused by callers today but kept for parity with OAuth flow. */
  scopes?: string[];
  expiresAt?: string | null;
  /** User's unwrapped DEK. */
  dek: Buffer;
}

export function upsertSlackUserCredential(
  input: UpsertSlackUserCredentialInput,
): void {
  const db = getDatabase();
  const sealed = encryptWith(input.dek, input.token);
  db.prepare(
    `INSERT INTO slack_user_oauth (
       slack_team_id, slack_user_id, provider, account_label,
       access_iv, access_ct, access_tag,
       refresh_iv, refresh_ct, refresh_tag,
       scopes_json, expires_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)
     ON CONFLICT(slack_team_id, slack_user_id, provider) DO UPDATE SET
       account_label = excluded.account_label,
       access_iv = excluded.access_iv,
       access_ct = excluded.access_ct,
       access_tag = excluded.access_tag,
       refresh_iv = NULL,
       refresh_ct = NULL,
       refresh_tag = NULL,
       scopes_json = excluded.scopes_json,
       expires_at = excluded.expires_at,
       connected_at = datetime('now')`,
  ).run(
    input.slackTeamId,
    input.slackUserId,
    input.provider,
    input.accountLabel,
    sealed.iv,
    sealed.ct,
    sealed.tag,
    JSON.stringify(input.scopes ?? []),
    input.expiresAt ?? null,
  );
}

export function deleteSlackUserCredential(
  slackTeamId: string,
  slackUserId: string,
  provider: string,
): boolean {
  const db = getDatabase();
  const r = db
    .prepare(
      `DELETE FROM slack_user_oauth
        WHERE slack_team_id = ? AND slack_user_id = ? AND provider = ?`,
    )
    .run(slackTeamId, slackUserId, provider);
  return r.changes > 0;
}

/**
 * Decrypt every credential row for a Slack user and return them as an
 * `envVar → token` map suitable for merging into the agent run's env.
 *
 * `connectorKeyToEnvVar` is a closure so this DB file stays free of
 * UI-side imports (no cycle with `home/credentials.ts`).
 */
export function loadUserScopedCredentials(args: {
  slackTeamId: string;
  slackUserId: string;
  connectorKeyToEnvVar: (key: string) => string | null;
}): Record<string, string> {
  const dek = unwrapDekFor(args.slackTeamId, args.slackUserId);
  if (!dek) return {};
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT provider, access_iv, access_ct, access_tag
         FROM slack_user_oauth
        WHERE slack_team_id = ? AND slack_user_id = ?`,
    )
    .all(args.slackTeamId, args.slackUserId) as Array<{
    provider: string;
    access_iv: string;
    access_ct: string;
    access_tag: string;
  }>;
  const out: Record<string, string> = {};
  for (const row of rows) {
    const envVar = args.connectorKeyToEnvVar(row.provider);
    if (!envVar) continue;
    try {
      out[envVar] = decryptWith(dek, {
        iv: row.access_iv,
        ct: row.access_ct,
        tag: row.access_tag,
      });
    } catch {
      // Bad ciphertext (DEK rotated, secret-box salt lost, …) — skip
      // rather than breaking the agent run for one stale row.
    }
  }
  return out;
}

/** Decrypt and return the raw token. Caller must scrub from memory. */
export function getSlackUserCredentialToken(args: {
  slackTeamId: string;
  slackUserId: string;
  provider: string;
  dek: Buffer;
}): string | null {
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT access_iv, access_ct, access_tag
         FROM slack_user_oauth
        WHERE slack_team_id = ? AND slack_user_id = ? AND provider = ?`,
    )
    .get(args.slackTeamId, args.slackUserId, args.provider) as
    | Pick<CredRowDb, 'access_iv' | 'access_ct' | 'access_tag'>
    | undefined;
  if (!row) return null;
  return decryptWith(args.dek, {
    iv: row.access_iv,
    ct: row.access_ct,
    tag: row.access_tag,
  });
}

// ───────────────────────────────────────────────────────────────────────
// Per-user MCP servers (slack_user_mcp)
// ───────────────────────────────────────────────────────────────────────

export type McpTransport = 'stdio' | 'http' | 'sse';

export interface SlackUserMcpRow {
  id: string;
  slackTeamId: string;
  slackUserId: string;
  name: string;
  transport: McpTransport;
  url: string | null;
  command: string | null;
  args: string[];
  enabled: boolean;
  pendingAdminApproval: boolean;
  createdAt: string;
}

interface McpRowDb {
  id: string;
  slack_team_id: string;
  slack_user_id: string;
  name: string;
  transport: string;
  url: string | null;
  command: string | null;
  args_json: string | null;
  env_iv: string | null;
  env_ct: string | null;
  env_tag: string | null;
  enabled: number;
  pending_admin_approval: number;
  created_at: string;
}

function rowToMcp(row: McpRowDb): SlackUserMcpRow {
  return {
    id: row.id,
    slackTeamId: row.slack_team_id,
    slackUserId: row.slack_user_id,
    name: row.name,
    transport: row.transport as McpTransport,
    url: row.url,
    command: row.command,
    args: row.args_json ? (JSON.parse(row.args_json) as string[]) : [],
    enabled: row.enabled === 1,
    pendingAdminApproval: row.pending_admin_approval === 1,
    createdAt: row.created_at,
  };
}

export function listSlackUserMcp(
  slackTeamId: string,
  slackUserId: string,
): SlackUserMcpRow[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT * FROM slack_user_mcp
        WHERE slack_team_id = ? AND slack_user_id = ?
        ORDER BY name`,
    )
    .all(slackTeamId, slackUserId) as McpRowDb[];
  return rows.map(rowToMcp);
}

export function getSlackUserMcpEnv(args: {
  id: string;
  dek: Buffer;
}): Record<string, string> | null {
  const db = getDatabase();
  const row = db
    .prepare(`SELECT env_iv, env_ct, env_tag FROM slack_user_mcp WHERE id = ?`)
    .get(args.id) as
    | { env_iv: string | null; env_ct: string | null; env_tag: string | null }
    | undefined;
  if (!row || !row.env_iv || !row.env_ct || !row.env_tag) return null;
  const json = decryptWith(args.dek, {
    iv: row.env_iv,
    ct: row.env_ct,
    tag: row.env_tag,
  });
  return JSON.parse(json) as Record<string, string>;
}

export interface InsertSlackUserMcpInput {
  slackTeamId: string;
  slackUserId: string;
  name: string;
  transport: McpTransport;
  url?: string | null;
  command?: string | null;
  args?: string[];
  env?: Record<string, string> | null;
  enabled?: boolean;
  pendingAdminApproval?: boolean;
  /** User's unwrapped DEK; required only if `env` is supplied. */
  dek?: Buffer;
}

export function insertSlackUserMcp(input: InsertSlackUserMcpInput): string {
  if (input.env && !input.dek) {
    throw new Error('insertSlackUserMcp: dek required when env is set');
  }
  const id = crypto.randomUUID();
  const sealed =
    input.env && input.dek
      ? encryptWith(input.dek, JSON.stringify(input.env))
      : null;
  const db = getDatabase();
  db.prepare(
    `INSERT INTO slack_user_mcp (
       id, slack_team_id, slack_user_id, name, transport,
       url, command, args_json,
       env_iv, env_ct, env_tag,
       enabled, pending_admin_approval
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.slackTeamId,
    input.slackUserId,
    input.name,
    input.transport,
    input.url ?? null,
    input.command ?? null,
    input.args && input.args.length > 0 ? JSON.stringify(input.args) : null,
    sealed?.iv ?? null,
    sealed?.ct ?? null,
    sealed?.tag ?? null,
    input.enabled === false ? 0 : 1,
    input.pendingAdminApproval === true ? 1 : 0,
  );
  return id;
}

export function setSlackUserMcpEnabled(id: string, enabled: boolean): void {
  const db = getDatabase();
  db.prepare(`UPDATE slack_user_mcp SET enabled = ? WHERE id = ?`).run(
    enabled ? 1 : 0,
    id,
  );
}

export function deleteSlackUserMcp(id: string): boolean {
  const db = getDatabase();
  return (
    db.prepare(`DELETE FROM slack_user_mcp WHERE id = ?`).run(id).changes > 0
  );
}
