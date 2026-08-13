/**
 * Linear Token Management
 *
 * Manages Linear API access tokens for the pipeline.
 * Supports personal API key, client_credentials grant, and OAuth2 refresh.
 *
 * Linear migrated all OAuth2 apps to refresh tokens on 2026-04-01.
 * client_credentials tokens are valid for 30 days.
 * Access tokens from OAuth2 flow expire after 24 hours.
 */

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('LinearAuth');

// ============================================================================
// Types
// ============================================================================

export type LinearAuthMode =
  | 'personal_api_key'
  | 'client_credentials'
  | 'oauth2';

export interface LinearAuthConfig {
  authMode: LinearAuthMode;
  /** Personal API key (for personal_api_key mode) */
  apiKey?: string;
  /** OAuth2 client ID (for client_credentials and oauth2 modes) */
  clientId?: string;
  /** OAuth2 client secret (for client_credentials and oauth2 modes) */
  clientSecret?: string;
  /** OAuth2 refresh token (for oauth2 mode) */
  refreshToken?: string;
}

interface TokenState {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
}

// ============================================================================
// Token cache (module-level)
// ============================================================================

/** Separate token caches per auth mode to prevent cross-mode staleness */
const tokenCache: Record<string, TokenState | null> = {
  client_credentials: null,
  oauth2: null,
};

/** In-flight token request dedup per auth mode (prevents race condition with refresh token rotation) */
const inflightRequests: Record<string, Promise<string> | null> = {
  client_credentials: null,
  oauth2: null,
};

const LINEAR_TOKEN_URL = 'https://api.linear.app/oauth/token';

// Buffer: refresh 1 hour before expiry
const EXPIRY_BUFFER_MS = 3_600_000;

// ============================================================================
// Public API
// ============================================================================

/**
 * Get a valid Linear access token, refreshing if needed.
 * Falls back gracefully: client_credentials -> personal API key.
 */
export async function getLinearAccessToken(
  config: LinearAuthConfig,
): Promise<string> {
  switch (config.authMode) {
    case 'personal_api_key':
      if (!config.apiKey)
        throw new Error('Linear personal API key not configured');
      return config.apiKey;

    case 'client_credentials':
      return getClientCredentialsToken(config);

    case 'oauth2':
      return getOAuthToken(config);

    default:
      throw new Error(`Unknown Linear auth mode: ${config.authMode}`);
  }
}

/** Clear cached tokens (call on config change or 401 error). */
export function invalidateLinearToken(): void {
  tokenCache.client_credentials = null;
  tokenCache.oauth2 = null;
  inflightRequests.client_credentials = null;
  inflightRequests.oauth2 = null;
  logger.info('Linear token cache invalidated');
}

/** Check if a cached token exists and is still valid for any auth mode. */
export function hasValidToken(): boolean {
  return Object.values(tokenCache).some(
    (t) => t !== null && t.expiresAt > Date.now() + EXPIRY_BUFFER_MS,
  );
}

// ============================================================================
// client_credentials grant (30-day tokens, no refresh token)
// ============================================================================

async function getClientCredentialsToken(
  config: LinearAuthConfig,
): Promise<string> {
  if (!config.clientId || !config.clientSecret) {
    throw new Error(
      'Linear client_credentials requires clientId and clientSecret',
    );
  }

  const cached = tokenCache.client_credentials;
  // Return cached token if still valid
  if (cached && cached.expiresAt > Date.now() + EXPIRY_BUFFER_MS) {
    return cached.accessToken;
  }

  // Deduplicate concurrent refresh requests
  if (inflightRequests.client_credentials)
    return inflightRequests.client_credentials;

  inflightRequests.client_credentials = (async () => {
    logger.info('Requesting new Linear client_credentials token');

    const credentials = Buffer.from(
      `${config.clientId}:${config.clientSecret}`,
    ).toString('base64');

    const res = await fetch(LINEAR_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'read write issues:create comments:create',
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `Linear client_credentials failed: HTTP ${res.status} ${body}`,
      );
    }

    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
      token_type: string;
    };

    tokenCache.client_credentials = {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    logger.info('Linear client_credentials token obtained', {
      expiresIn: `${Math.round(data.expires_in / 86400)}d`,
    });

    return tokenCache.client_credentials.accessToken;
  })().finally(() => {
    inflightRequests.client_credentials = null;
  });

  return inflightRequests.client_credentials;
}

// ============================================================================
// OAuth2 with refresh token rotation (24hr access tokens)
// ============================================================================

async function getOAuthToken(config: LinearAuthConfig): Promise<string> {
  if (!config.clientId || !config.clientSecret) {
    throw new Error('Linear OAuth2 requires clientId and clientSecret');
  }

  const cached = tokenCache.oauth2;
  // Return cached token if still valid
  if (cached && cached.expiresAt > Date.now() + EXPIRY_BUFFER_MS) {
    return cached.accessToken;
  }

  // Deduplicate concurrent refresh requests (Linear invalidates refresh tokens after single use)
  if (inflightRequests.oauth2) return inflightRequests.oauth2;

  const refreshToken = cached?.refreshToken ?? config.refreshToken;
  if (!refreshToken) {
    throw new Error(
      'Linear OAuth2 requires a refresh token (complete OAuth flow first)',
    );
  }

  inflightRequests.oauth2 = (async () => {
    logger.info('Refreshing Linear OAuth2 token');

    const credentials = Buffer.from(
      `${config.clientId}:${config.clientSecret}`,
    ).toString('base64');

    const res = await fetch(LINEAR_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.error('Linear OAuth2 refresh failed', {
        status: res.status,
        body,
      });
      // Clear cache so next call retries
      tokenCache.oauth2 = null;
      throw new Error(`Linear OAuth2 refresh failed: HTTP ${res.status}`);
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      token_type: string;
    };

    tokenCache.oauth2 = {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      refreshToken: data.refresh_token ?? refreshToken,
    };

    logger.info('Linear OAuth2 token refreshed', {
      expiresIn: `${Math.round(data.expires_in / 3600)}h`,
      rotated: !!data.refresh_token,
    });

    return tokenCache.oauth2.accessToken;
  })().finally(() => {
    inflightRequests.oauth2 = null;
  });

  return inflightRequests.oauth2;
}
