/**
 * Per-run registry that exposes an *arbitrary, project-scoped* in-process MCP
 * server to a subprocess-shelled agent over the loopback bridge.
 *
 * The connector bridge (`token-store.ts`) handles the fixed global connectors
 * (google / composio / assets). This registry is the general case: any caller
 * — the Codex, Cursor, Gemini, DeepSeek, or future CLI adapters — can mint a
 * per-run token for a *specific* in-process `McpServer` instance (e.g. a
 * Video Mode `video-edit` server bound to one project) and hand the subprocess
 * a URL of the form:
 *
 *   http://127.0.0.1:<api>/mcp/bridge/inproc/<name>
 *
 * with a bearer token bound to that exact (token, name) pair. The server is
 * supplied as a factory so each request gets a fresh transport-attached
 * instance (matching the stateless connector-bridge pattern), while the
 * per-run config (projectId, selection, aspect, …) is captured in the closure
 * at mint time.
 *
 * Tokens live in process memory only, are bound to one server name, and are
 * revoked when the run finishes (or expire after the TTL).
 */
import { randomBytes } from 'crypto';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { SessionContext } from '@/shared/services/session-context';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('McpInProcessBridge');

/** Builds a fresh MCP server for one bridge request. May be async (e.g. needs
 * to read project state). The per-run config is captured in the closure. */
export type InProcessServerFactory = () => McpServer | Promise<McpServer>;

/** Optional post-request hook: receives the raw JSON-RPC response body text so
 * the caller can react to what a tool produced (e.g. Video Mode ingests media
 * files a generation tool wrote). Best-effort; errors are swallowed. Keeps the
 * bridge runtime- and feature-agnostic — the behaviour lives with the caller. */
export type InProcessResultHook = (
  responseText: string,
) => void | Promise<void>;

export interface InProcessBridgeEntry {
  token: string;
  /** MCP server name, also the URL path segment (`/inproc/<name>`). */
  name: string;
  /** Run/session id, so a whole run's tokens can be revoked together. */
  sessionId: string;
  createServer: InProcessServerFactory;
  /**
   * Ambient context the bridge installs (via runWithSessionContext) around the
   * server call, so in-process tools that read getSessionContext() — e.g. the
   * media server's output dir — behave the same as on the direct (Claude)
   * path. Also tells the bridge which project to ingest generated media into.
   */
  sessionContext?: SessionContext;
  /** Optional post-request hook (see InProcessResultHook). */
  onResult?: InProcessResultHook;
  /** Absolute expiry (epoch ms). */
  expiresAt: number;
}

/** Long enough to outlive a multi-minute agent turn, short enough that an
 * abandoned token doesn't linger. Mirrors the connector token store. */
const DEFAULT_TTL_MS = 30 * 60_000;
const SWEEP_INTERVAL_MS = 30_000;
/** Names map to a URL path segment — keep them boring. */
const VALID_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

const entries = new Map<string, InProcessBridgeEntry>();
let lastSweepAt = 0;

function sweep(now = Date.now()): void {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  for (const [token, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(token);
  }
}

export interface MintInProcessTokenInput {
  name: string;
  sessionId: string;
  createServer: InProcessServerFactory;
  sessionContext?: SessionContext;
  onResult?: InProcessResultHook;
  ttlMs?: number;
}

export function mintInProcessBridgeToken(
  input: MintInProcessTokenInput,
): string {
  if (!VALID_NAME.test(input.name)) {
    throw new Error(`Invalid in-process bridge server name: ${input.name}`);
  }
  sweep();
  const token = randomBytes(32).toString('base64url');
  entries.set(token, {
    token,
    name: input.name,
    sessionId: input.sessionId,
    createServer: input.createServer,
    sessionContext: input.sessionContext,
    onResult: input.onResult,
    expiresAt: Date.now() + (input.ttlMs ?? DEFAULT_TTL_MS),
  });
  logger.debug(
    `Minted in-process bridge token: name=${input.name} session=${input.sessionId}`,
  );
  return token;
}

/** Look up by token AND name: a token minted for `video-edit` cannot be
 * replayed against `media`. Returns undefined on miss / name mismatch /
 * expiry. */
export function lookupInProcessBridge(
  token: string | undefined,
  name: string,
): InProcessBridgeEntry | undefined {
  if (!token) return undefined;
  const now = Date.now();
  sweep(now);
  const entry = entries.get(token);
  if (!entry) return undefined;
  if (entry.expiresAt <= now) {
    entries.delete(token);
    return undefined;
  }
  if (entry.name !== name) return undefined;
  return entry;
}

export function revokeInProcessBridgeToken(token: string | undefined): void {
  if (!token) return;
  entries.delete(token);
}

/** Revoke every token minted for a run — call when the run finishes. */
export function revokeInProcessBridgeSession(sessionId: string): void {
  for (const [token, entry] of entries) {
    if (entry.sessionId === sessionId) entries.delete(token);
  }
}

/** Test-only — clears the registry. */
export function __resetInProcessBridgeForTests(): void {
  entries.clear();
  lastSweepAt = 0;
}
