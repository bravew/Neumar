/**
 * Connection Health Monitor
 *
 * Periodically verifies that all OAuth connections are still valid by
 * making lightweight API calls ("heartbeats") to each provider.
 * Detects when tokens have been externally revoked (e.g., user revokes
 * from Google Account settings) and updates the connection status.
 *
 * Check endpoints:
 *   Google — GET /oauth2/v3/userinfo
 *   Slack  — POST auth.test
 *   Notion — GET /v1/users/me
 */

import { clearSlackMcpCache } from '@/shared/mcp/slack-server';
import { createLogger } from '@/shared/utils/logger';

import { getValidAccessToken, refreshGoogleToken } from './oauth-client';
import * as tokenManager from './token-manager';
import type { ConnectionHealthState, OAuthProvider } from './types';

const logger = createLogger('HealthMonitor');

const HEALTH_CHECK_INTERVAL_MS = 30 * 60 * 1000; // Every 30 minutes
const HEALTH_CHECK_TIMEOUT_MS = 10 * 1000; // 10s per-check timeout

let intervalId: ReturnType<typeof setInterval> | null = null;
const healthStates = new Map<OAuthProvider, ConnectionHealthState>();

// ============================================================================
// Provider-specific health checks
// ============================================================================

async function checkGoogle(): Promise<ConnectionHealthState> {
  const existing = healthStates.get('google');
  const state: ConnectionHealthState = {
    provider: 'google',
    status: 'unknown',
    lastCheck: new Date().toISOString(),
    lastSuccess: existing?.lastSuccess ?? null,
    consecutiveFailures: existing?.consecutiveFailures ?? 0,
  };

  const token = await getValidAccessToken('google');
  if (!token) {
    state.status = 'revoked';
    state.error = 'No access token available';
    state.consecutiveFailures++;
    return state;
  }

  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
    });

    if (res.ok) {
      state.status = 'healthy';
      state.lastSuccess = state.lastCheck;
      state.consecutiveFailures = 0;
      delete state.error;
    } else if (res.status === 401) {
      // Token rejected — attempt one refresh
      const refreshed = await refreshGoogleToken();
      if (refreshed) {
        state.status = 'healthy';
        state.lastSuccess = state.lastCheck;
        state.consecutiveFailures = 0;
      } else {
        state.status = 'revoked';
        state.error = 'Token refresh failed after 401 from userinfo';
        state.consecutiveFailures++;
        await updateConnectionStatus('google', 'revoked');
      }
    } else {
      state.status = 'degraded';
      state.error = `Unexpected status: ${res.status}`;
      state.consecutiveFailures++;
    }
  } catch (err) {
    state.status = 'degraded';
    state.error = err instanceof Error ? err.message : String(err);
    state.consecutiveFailures++;
  }

  return state;
}

async function checkSlack(): Promise<ConnectionHealthState> {
  const existing = healthStates.get('slack');
  const state: ConnectionHealthState = {
    provider: 'slack',
    status: 'unknown',
    lastCheck: new Date().toISOString(),
    lastSuccess: existing?.lastSuccess ?? null,
    consecutiveFailures: existing?.consecutiveFailures ?? 0,
  };

  const botToken = await getValidAccessToken('slack');
  if (!botToken) {
    state.status = 'revoked';
    state.error = 'No access token available';
    state.consecutiveFailures++;
    return state;
  }

  try {
    const res = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${botToken}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
    });

    const data = (await res.json()) as { ok: boolean; error?: string };

    if (!data.ok) {
      state.status = 'revoked';
      state.error = `auth.test failed: ${data.error ?? 'unknown'}`;
      state.consecutiveFailures++;
      await updateConnectionStatus('slack', 'revoked');
      return state;
    }

    // Bot token works — check user token for MCP tools
    const userToken = await getValidAccessToken('slack', 'user');
    if (!userToken) {
      state.status = 'degraded';
      state.error =
        'User token revoked or missing. MCP tools (search, read, send) will not work.';
      state.consecutiveFailures++;
      clearSlackMcpCache();
      return state;
    }

    state.status = 'healthy';
    state.lastSuccess = state.lastCheck;
    state.consecutiveFailures = 0;
    delete state.error;
  } catch (err) {
    state.status = 'degraded';
    state.error = err instanceof Error ? err.message : String(err);
    state.consecutiveFailures++;
  }

  return state;
}

async function checkNotion(): Promise<ConnectionHealthState> {
  const existing = healthStates.get('notion');
  const state: ConnectionHealthState = {
    provider: 'notion',
    status: 'unknown',
    lastCheck: new Date().toISOString(),
    lastSuccess: existing?.lastSuccess ?? null,
    consecutiveFailures: existing?.consecutiveFailures ?? 0,
  };

  const token = await getValidAccessToken('notion');
  if (!token) {
    state.status = 'revoked';
    state.error = 'No access token available';
    state.consecutiveFailures++;
    return state;
  }

  try {
    const res = await fetch('https://api.notion.com/v1/users/me', {
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
      },
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
    });

    if (res.ok) {
      state.status = 'healthy';
      state.lastSuccess = state.lastCheck;
      state.consecutiveFailures = 0;
      delete state.error;
    } else if (res.status === 401 || res.status === 403) {
      state.status = 'revoked';
      state.error = `Notion returned ${res.status}`;
      state.consecutiveFailures++;
      await updateConnectionStatus('notion', 'revoked');
    } else {
      state.status = 'degraded';
      state.error = `Unexpected status: ${res.status}`;
      state.consecutiveFailures++;
    }
  } catch (err) {
    state.status = 'degraded';
    state.error = err instanceof Error ? err.message : String(err);
    state.consecutiveFailures++;
  }

  return state;
}

// ============================================================================
// Helpers
// ============================================================================

async function updateConnectionStatus(
  provider: OAuthProvider,
  status: 'revoked' | 'expired',
): Promise<void> {
  const connection = await tokenManager.getConnection(provider);
  if (connection && connection.status !== status) {
    const updated = {
      ...connection,
      status,
      updatedAt: new Date().toISOString(),
    };
    const tokens = await tokenManager.getTokens(provider);
    if (tokens) {
      await tokenManager.saveTokens(provider, updated, tokens);
      logger.error(`Connection ${provider} marked as ${status}`);
    }
  }
}

const PROVIDER_CHECKS: Partial<
  Record<OAuthProvider, () => Promise<ConnectionHealthState>>
> = {
  google: checkGoogle,
  slack: checkSlack,
  notion: checkNotion,
};

async function runAllHealthChecks(): Promise<void> {
  const connections = await tokenManager.getAllConnections();

  for (const conn of connections) {
    // Skip already-revoked connections
    if (conn.status === 'revoked') continue;

    const checkFn = PROVIDER_CHECKS[conn.provider];
    if (!checkFn) continue;

    try {
      const result = await checkFn();
      healthStates.set(conn.provider, result);

      if (result.status === 'revoked') {
        logger.error(`Connection ${conn.provider} has been revoked`);
      } else if (result.status === 'healthy') {
        logger.debug(`Connection ${conn.provider} is healthy`);
      } else {
        logger.warn(
          `Connection ${conn.provider} health: ${result.status} — ${result.error}`,
        );
      }
    } catch (err) {
      logger.error(`Health check for ${conn.provider} threw:`, err);
    }
  }
}

// ============================================================================
// Public API
// ============================================================================

/** Start periodic health monitoring */
export function startHealthMonitor(): void {
  if (intervalId) return;

  // Defer the first check by a few seconds so the server finishes starting
  setTimeout(() => {
    runAllHealthChecks().catch((err) =>
      logger.error('Initial health check failed:', err),
    );
  }, 5_000);

  intervalId = setInterval(runAllHealthChecks, HEALTH_CHECK_INTERVAL_MS);
  logger.info(
    `Health monitor started (interval: ${HEALTH_CHECK_INTERVAL_MS / 60_000}min)`,
  );
}

/** Stop periodic health monitoring */
export function stopHealthMonitor(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('Health monitor stopped');
  }
}

/**
 * Run an on-demand health check for one or all providers.
 * Returns fresh results (not cached).
 */
export async function checkConnectionHealth(
  provider?: OAuthProvider,
): Promise<ConnectionHealthState[]> {
  if (provider) {
    const checkFn = PROVIDER_CHECKS[provider];
    if (!checkFn) return [];

    const result = await checkFn();
    healthStates.set(provider, result);
    return [result];
  }

  await runAllHealthChecks();
  return Array.from(healthStates.values());
}

/** Get the latest cached health states without triggering new checks */
export function getHealthStatus(): ConnectionHealthState[] {
  return Array.from(healthStates.values());
}
