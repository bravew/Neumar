/**
 * Auth API Routes
 *
 * Handles OAuth2 authentication flows for Google, Slack, and Notion.
 * All token storage and exchange happens server-side — the frontend
 * only receives connection metadata (email, name, status), never raw tokens.
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import {
  checkConnectionHealth,
  getHealthStatus,
} from '@/shared/auth/connection-health-monitor';
import * as oauthClient from '@/shared/auth/oauth-client';
import * as siteAuth from '@/shared/auth/site-auth';
import * as tokenManager from '@/shared/auth/token-manager';
import type { OAuthProvider } from '@/shared/auth/types';
import { getSetting, saveSetting } from '@/shared/db/operations';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('AuthRoutes');
const authRoutes = new Hono();

const VALID_PROVIDERS: OAuthProvider[] = [
  'google',
  'slack',
  'notion',
  'box',
  'dropbox',
  'onedrive',
  'site',
];

function isValidProvider(provider: string): provider is OAuthProvider {
  return VALID_PROVIDERS.includes(provider as OAuthProvider);
}

const initiateBodySchema = z
  .object({ scopes: z.array(z.string()).optional() })
  .partial();

const scopesBodySchema = z.object({
  scopes: z.array(z.string()).min(1),
});

const credentialsBodySchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1).optional(),
});

// ============================================================================
// GET /auth/status — All connections status
// ============================================================================

authRoutes.get('/status', async (c) => {
  try {
    const connections = await tokenManager.getAllConnections();
    const availableProviders = oauthClient.getAvailableProviders();

    // Authenticated = has an active site session (primary auth)
    const authenticated = connections.some(
      (conn) => conn.provider === 'site' && conn.status === 'active',
    );

    return c.json({
      authenticated,
      connections,
      availableProviders,
    });
  } catch (error) {
    logger.error('Failed to get auth status:', error);
    return c.json({ error: 'Failed to get auth status' }, 500);
  }
});

// ============================================================================
// POST /auth/site/login — Start site login flow
// ============================================================================

authRoutes.post('/site/login', async (c) => {
  try {
    const { authUrl } = await siteAuth.initiateSiteLogin();
    logger.info('Site login flow initiated');
    return c.json({ authUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to initiate site login:', error);
    return c.json({ error: message }, 500);
  }
});

// ============================================================================
// POST /auth/site/logout — Log out from site session
// ============================================================================

authRoutes.post('/site/logout', async (c) => {
  try {
    await siteAuth.logoutSite();
    return c.json({ success: true });
  } catch (error) {
    logger.error('Failed to logout from site:', error);
    return c.json({ error: 'Failed to logout' }, 500);
  }
});

// ============================================================================
// GET /auth/providers — List configured OAuth providers
// ============================================================================

authRoutes.get('/providers', (c) => {
  const available = oauthClient.getAvailableProviders();
  return c.json({ providers: available });
});

// ============================================================================
// GET /auth/health — Connection health (all providers)
// ============================================================================

authRoutes.get('/health', async (c) => {
  try {
    // Return cached results; use ?refresh=true to trigger fresh checks
    const refresh = c.req.query('refresh') === 'true';
    const results = refresh ? await checkConnectionHealth() : getHealthStatus();

    return c.json({ health: results });
  } catch (error) {
    logger.error('Health check failed:', error);
    return c.json({ error: 'Health check failed' }, 500);
  }
});

// ============================================================================
// GET /auth/health/:provider — Connection health (single provider)
// ============================================================================

authRoutes.get('/health/:provider', async (c) => {
  const provider = c.req.param('provider');
  if (!isValidProvider(provider)) {
    return c.json({ error: `Invalid provider: ${provider}` }, 400);
  }

  try {
    const results = await checkConnectionHealth(provider);
    return c.json({ health: results[0] ?? null });
  } catch (error) {
    logger.error(`Health check failed for ${provider}:`, error);
    return c.json({ error: 'Health check failed' }, 500);
  }
});

// ============================================================================
// POST /auth/:provider/initiate — Start OAuth flow
// ============================================================================

authRoutes.post(
  '/:provider/initiate',
  zValidator('json', initiateBodySchema, (result, c) => {
    if (!result.success) return c.json({ error: 'Invalid request body' }, 400);
  }),
  async (c) => {
    const provider = c.req.param('provider');

    if (!isValidProvider(provider)) {
      return c.json({ error: `Invalid provider: ${provider}` }, 400);
    }

    try {
      const body = c.req.valid('json');
      const additionalScopes = body.scopes;

      const { authUrl, state } = await oauthClient.initiateAndHandleOAuth(
        provider,
        additionalScopes,
      );

      logger.info(`OAuth flow initiated for ${provider}`);
      return c.json({ authUrl, state });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to initiate OAuth for ${provider}:`, error);
      return c.json({ error: message }, 500);
    }
  },
);

// ============================================================================
// GET /auth/connections/:provider — Get single connection status
// ============================================================================

authRoutes.get('/connections/:provider', async (c) => {
  const provider = c.req.param('provider');

  if (!isValidProvider(provider)) {
    return c.json({ error: `Invalid provider: ${provider}` }, 400);
  }

  try {
    const connection = await tokenManager.getConnection(provider);
    if (!connection) {
      return c.json({ connected: false, connection: null });
    }

    let responseConnection = connection;

    // Check if Google token needs refresh — return a copy with updated status
    if (provider === 'google') {
      const tokens = await tokenManager.getTokens('google');
      if (tokens && tokenManager.isTokenExpired(tokens)) {
        responseConnection = { ...connection, status: 'expired' };
      }
    }

    return c.json({ connected: true, connection: responseConnection });
  } catch (error) {
    logger.error(`Failed to get connection for ${provider}:`, error);
    return c.json({ error: 'Failed to get connection' }, 500);
  }
});

// ============================================================================
// DELETE /auth/connections/:provider — Disconnect and revoke
// ============================================================================

authRoutes.delete('/connections/:provider', async (c) => {
  const provider = c.req.param('provider');

  if (!isValidProvider(provider)) {
    return c.json({ error: `Invalid provider: ${provider}` }, 400);
  }

  try {
    await oauthClient.revokeConnection(provider);
    logger.info(`Disconnected ${provider}`);
    return c.json({ success: true });
  } catch (error) {
    logger.error(`Failed to disconnect ${provider}:`, error);
    return c.json({ error: 'Failed to disconnect' }, 500);
  }
});

// ============================================================================
// POST /auth/refresh/:provider — Force token refresh
// ============================================================================

authRoutes.post('/refresh/:provider', async (c) => {
  const provider = c.req.param('provider');

  if (!isValidProvider(provider)) {
    return c.json({ error: `Invalid provider: ${provider}` }, 400);
  }

  try {
    if (provider === 'google') {
      const tokens = await oauthClient.refreshGoogleToken();
      if (!tokens) {
        return c.json({ error: 'Failed to refresh token' }, 500);
      }
      return c.json({
        success: true,
        expiresAt: new Date(tokens.expiresAt).toISOString(),
      });
    }

    if (provider === 'site') {
      const tokens = await siteAuth.refreshSiteToken();
      if (!tokens) {
        return c.json({ error: 'Failed to refresh site token' }, 500);
      }
      return c.json({
        success: true,
        expiresAt: new Date(tokens.expiresAt).toISOString(),
      });
    }

    // Slack and Notion tokens don't expire / don't support refresh
    return c.json({
      success: true,
      message: `${provider} tokens do not require refresh`,
    });
  } catch (error) {
    logger.error(`Failed to refresh token for ${provider}:`, error);
    return c.json({ error: 'Failed to refresh token' }, 500);
  }
});

// ============================================================================
// POST /auth/:provider/scopes — Request additional scopes (incremental auth)
// ============================================================================

authRoutes.post(
  '/:provider/scopes',
  zValidator('json', scopesBodySchema, (result, c) => {
    if (!result.success) {
      return c.json(
        { error: 'scopes must be a non-empty array of strings' },
        400,
      );
    }
  }),
  async (c) => {
    const provider = c.req.param('provider');

    if (!isValidProvider(provider)) {
      return c.json({ error: `Invalid provider: ${provider}` }, 400);
    }

    try {
      const { scopes } = c.req.valid('json');

      const { authUrl, state } = await oauthClient.initiateAndHandleOAuth(
        provider,
        scopes,
      );

      return c.json({ authUrl, state });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(
        `Failed to request additional scopes for ${provider}:`,
        error,
      );
      return c.json({ error: message }, 500);
    }
  },
);

// ============================================================================
// OAuth Credentials — User-provided app credentials for Slack/Notion
// ============================================================================

/** Setting keys for user-provided OAuth credentials.
 *  Entry tuple: [client_id_key, client_secret_key | null]. A null secret
 *  key means PKCE-only — no client_secret needed (Dropbox, OneDrive). */
const OAUTH_CREDENTIAL_KEYS: Record<string, [string, string | null]> = {
  google: ['oauth_google_client_id', 'oauth_google_client_secret'],
  slack: ['oauth_slack_client_id', 'oauth_slack_client_secret'],
  notion: ['oauth_notion_client_id', 'oauth_notion_client_secret'],
  box: ['oauth_box_client_id', 'oauth_box_client_secret'],
  dropbox: ['oauth_dropbox_client_id', null],
  onedrive: ['oauth_onedrive_client_id', null],
};

/**
 * GET /auth/credentials/:provider — Check if user has configured OAuth credentials
 * Returns { configured: boolean, clientId?: string } (never exposes secrets)
 */
authRoutes.get('/credentials/:provider', (c) => {
  const provider = c.req.param('provider');
  const keys = OAUTH_CREDENTIAL_KEYS[provider];
  if (!keys) {
    return c.json(
      {
        error: `Provider "${provider}" does not use user-provided credentials`,
      },
      400,
    );
  }

  const clientId = getSetting(keys[0]);
  const secretKey = keys[1];
  const clientSecret = secretKey ? getSetting(secretKey) : 'pkce';
  return c.json({
    configured: !!(clientId && clientSecret),
    clientId: clientId ?? undefined,
    requiresSecret: secretKey !== null,
  });
});

/**
 * PUT /auth/credentials/:provider — Save user-provided OAuth app credentials
 * Body: { clientId: string, clientSecret: string }
 */
authRoutes.put(
  '/credentials/:provider',
  zValidator('json', credentialsBodySchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: 'clientId is required' }, 400);
    }
  }),
  async (c) => {
    const provider = c.req.param('provider');
    const keys = OAUTH_CREDENTIAL_KEYS[provider];
    if (!keys) {
      return c.json(
        {
          error: `Provider "${provider}" does not use user-provided credentials`,
        },
        400,
      );
    }

    try {
      const { clientId, clientSecret } = c.req.valid('json');
      const secretKey = keys[1];
      if (secretKey) {
        if (!clientSecret) {
          return c.json({ error: 'clientSecret is required' }, 400);
        }
        saveSetting(secretKey, clientSecret.trim());
      }

      saveSetting(keys[0], clientId.trim());

      logger.info(`OAuth credentials saved for ${provider}`);
      return c.json({ success: true });
    } catch (error) {
      logger.error(`Failed to save OAuth credentials for ${provider}:`, error);
      return c.json({ error: 'Failed to save credentials' }, 500);
    }
  },
);

/**
 * DELETE /auth/credentials/:provider — Remove user-provided OAuth app credentials
 */
authRoutes.delete('/credentials/:provider', (c) => {
  const provider = c.req.param('provider');
  const keys = OAUTH_CREDENTIAL_KEYS[provider];
  if (!keys) {
    return c.json(
      {
        error: `Provider "${provider}" does not use user-provided credentials`,
      },
      400,
    );
  }

  for (const key of keys) {
    if (key) saveSetting(key, '');
  }

  logger.info(`OAuth credentials removed for ${provider}`);
  return c.json({ success: true });
});

export { authRoutes };
