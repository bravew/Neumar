/**
 * Per-run bearer token store for the subprocess MCP bridge.
 *
 * Subprocess-shelled agents (Codex CLI, Gemini CLI, OpenCode, …) cannot
 * mount neuma's in-process MCP servers directly. Instead we expose those
 * servers over loopback HTTP (`/mcp/bridge/<connector>`) and hand the
 * subprocess a per-run bearer token so each agent run only sees the
 * connectors that the policy gate approved at mint time.
 *
 * Tokens live in process memory only — worthless outside this process,
 * revoked when the run finishes (or expire after the configured TTL,
 * whichever comes first).
 */
import { randomBytes } from 'crypto';

import type { ConnectorPolicyInput } from '@/shared/auth/connector-policy';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('McpBridgeTokens');

export type BridgeConnector = 'google' | 'connector' | 'assets';

export interface ConnectorBridgeScope {
  connectorId: string;
  toolName?: string;
  connectedAccountId?: string;
  userId?: string;
}

export interface BridgeTokenEntry {
  token: string;
  connector: BridgeConnector;
  connectorScope?: ConnectorBridgeScope;
  /** Snapshot of the policy decision at mint time (gate evaluated once). */
  policyContext: ConnectorPolicyInput | undefined;
  /** Locale used for any user-facing tool output, captured at mint time. */
  locale?: string;
  sessionId: string;
  /** Absolute expiry (epoch ms). */
  expiresAt: number;
}

/** Long enough to outlive a typical Codex turn (multiple minutes), short
 * enough that an abandoned token doesn't linger. */
const DEFAULT_TTL_MS = 30 * 60_000;
/** Floor between Map-iterating sweeps. Codex hits the lookup path 3+ times
 * per run; without throttling each call iterates the whole Map. */
const SWEEP_INTERVAL_MS = 30_000;

const tokens = new Map<string, BridgeTokenEntry>();
let lastSweepAt = 0;

function sweep(now = Date.now()): void {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  for (const [token, entry] of tokens) {
    if (entry.expiresAt <= now) tokens.delete(token);
  }
}

export interface MintTokenInput {
  connector: BridgeConnector;
  connectorScope?: ConnectorBridgeScope;
  policyContext: ConnectorPolicyInput | undefined;
  locale?: string;
  sessionId: string;
  ttlMs?: number;
}

export function mintBridgeToken(input: MintTokenInput): string {
  sweep();
  const token = randomBytes(32).toString('base64url');
  tokens.set(token, {
    token,
    connector: input.connector,
    connectorScope: input.connectorScope,
    policyContext: input.policyContext,
    locale: input.locale,
    sessionId: input.sessionId,
    expiresAt: Date.now() + (input.ttlMs ?? DEFAULT_TTL_MS),
  });
  logger.debug(
    `Minted bridge token: connector=${input.connector} session=${input.sessionId}`,
  );
  return token;
}

export function lookupBridgeToken(
  token: string | undefined,
): BridgeTokenEntry | undefined {
  if (!token) return undefined;
  const now = Date.now();
  sweep(now);
  // Per-entry expiry check: throttled sweeps mean a token can outlive its
  // expiry inside the Map for up to SWEEP_INTERVAL_MS. Reject it here.
  const entry = tokens.get(token);
  if (!entry) return undefined;
  if (entry.expiresAt <= now) {
    tokens.delete(token);
    return undefined;
  }
  return entry;
}

export function revokeBridgeToken(token: string | undefined): void {
  if (!token) return;
  tokens.delete(token);
}

/** Test-only — clears the store. Not exported from the package index. */
export function __resetBridgeTokenStoreForTests(): void {
  tokens.clear();
  lastSweepAt = 0;
}
