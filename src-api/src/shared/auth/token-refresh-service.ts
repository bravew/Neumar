/**
 * Token Refresh Service
 *
 * Proactively refreshes OAuth tokens on a timer so they never expire
 * during normal operation. Google access tokens last ~60 minutes;
 * this service checks every 15 minutes and refreshes any token
 * expiring within the next 20 minutes.
 *
 * Slack and Notion tokens are long-lived and do not need refresh.
 */

import { createLogger } from '@/shared/utils/logger';

import { refreshGoogleToken } from './oauth-client';
import { refreshSiteToken } from './site-auth';
import * as tokenManager from './token-manager';
import type { OAuthProvider } from './types';

const logger = createLogger('TokenRefreshService');

/** Check every 15 minutes (Google tokens last 60 min) */
const CHECK_INTERVAL_MS = 15 * 60 * 1000;

/** Refresh if token expires within 20 minutes */
const PROACTIVE_REFRESH_MS = 20 * 60 * 1000;

/** After this many consecutive failures, mark the connection as expired */
const MAX_CONSECUTIVE_FAILURES = 3;

/** Providers that support token refresh */
const REFRESHABLE_PROVIDERS: OAuthProvider[] = ['google', 'site'];

let intervalId: ReturnType<typeof setInterval> | null = null;
const failureCounts = new Map<OAuthProvider, number>();

async function checkAndRefreshTokens(): Promise<void> {
  for (const provider of REFRESHABLE_PROVIDERS) {
    try {
      const tokens = await tokenManager.getTokens(provider);
      if (!tokens || !tokens.refreshToken) continue;

      const timeUntilExpiry = tokens.expiresAt - Date.now();

      // Skip if token is still fresh enough
      if (timeUntilExpiry > PROACTIVE_REFRESH_MS) continue;

      logger.info(
        `Proactively refreshing ${provider} token ` +
          `(expires in ${Math.round(timeUntilExpiry / 1000)}s)`,
      );

      const refreshed =
        provider === 'site'
          ? await refreshSiteToken()
          : await refreshGoogleToken();

      if (refreshed) {
        failureCounts.set(provider, 0);
        logger.info(`${provider} token refreshed successfully`);
      } else {
        const failures = (failureCounts.get(provider) ?? 0) + 1;
        failureCounts.set(provider, failures);
        logger.warn(
          `${provider} token refresh failed ` +
            `(attempt ${failures}/${MAX_CONSECUTIVE_FAILURES})`,
        );

        if (failures >= MAX_CONSECUTIVE_FAILURES) {
          await markConnectionExpired(provider);
        }
      }
    } catch (err) {
      logger.error(`Error during ${provider} token refresh check:`, err);
    }
  }
}

async function markConnectionExpired(provider: OAuthProvider): Promise<void> {
  const connection = await tokenManager.getConnection(provider);
  if (connection && connection.status !== 'expired') {
    const updated = {
      ...connection,
      status: 'expired' as const,
      updatedAt: new Date().toISOString(),
    };
    const tokens = await tokenManager.getTokens(provider);
    if (tokens) {
      await tokenManager.saveTokens(provider, updated, tokens);
      logger.error(
        `${provider} connection marked as expired after ` +
          `${MAX_CONSECUTIVE_FAILURES} consecutive refresh failures`,
      );
    }
  }
}

/** Start the background token refresh timer */
export function startTokenRefreshService(): void {
  if (intervalId) return;

  // Run an initial check immediately, then on interval
  checkAndRefreshTokens().catch((err) =>
    logger.error('Initial token refresh check failed:', err),
  );

  intervalId = setInterval(checkAndRefreshTokens, CHECK_INTERVAL_MS);
  logger.info(
    `Token refresh service started (interval: ${CHECK_INTERVAL_MS / 60_000}min)`,
  );
}

/** Stop the background token refresh timer */
export function stopTokenRefreshService(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('Token refresh service stopped');
  }
}

/** Current status — useful for debugging and the health API */
export function getRefreshServiceStatus(): {
  running: boolean;
  failures: Record<string, number>;
} {
  return {
    running: intervalId !== null,
    failures: Object.fromEntries(failureCounts),
  };
}
