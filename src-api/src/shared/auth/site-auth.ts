/**
 * Site Authentication
 *
 * Authenticates the desktop app user via the companion website (neumar.app).
 * Opens the site's login page in the system browser, receives session tokens
 * back via a temporary localhost HTTP server — same pattern as the existing
 * OAuth provider flows.
 *
 * Flow:
 *   1. Spin up a temporary localhost HTTP listener on a random port
 *   2. Open {siteUrl}/auth/desktop?port={port} in the system browser
 *   3. User signs in on the site (any method: Google, email, etc.)
 *   4. Site POSTs session tokens to http://127.0.0.1:{port}/callback
 *   5. Store the session and user info locally
 *   6. Shut down the temporary server
 */

import crypto from 'crypto';
import { createServer } from 'http';
import type { IncomingMessage, Server, ServerResponse } from 'http';
import { URLSearchParams } from 'url';

import { getSetting, saveSetting } from '@/shared/db/operations';
import { createLogger } from '@/shared/utils/logger';
import { validateBaseUrl } from '@/shared/utils/url-validator';

import { buildCallbackHtml } from './oauth-client';
import * as tokenManager from './token-manager';
import type { OAuthConnection, OAuthTokens } from './types';

const logger = createLogger('SiteAuth');

// Active site auth flow
let activeServer: Server | null = null;
let activeTimeout: ReturnType<typeof setTimeout> | null = null;
let activeNonce: string | null = null;

const FLOW_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export interface SiteSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp in seconds
  userId: string;
  userEmail: string;
  userName: string;
  userAvatar: string;
}

/**
 * Get the site URL from environment or settings.
 * Defaults to production; set SITE_URL env var for local dev.
 */
export function getSiteUrl(): string {
  return getSetting('site_url') || process.env.SITE_URL || 'https://neumar.app';
}

/**
 * Initiate the site login flow.
 * Starts a localhost callback server and returns the URL to open in the browser.
 */
export async function initiateSiteLogin(): Promise<{
  authUrl: string;
  port: number;
}> {
  // Shut down any previous flow
  shutdownServer();

  const nonce = crypto.randomBytes(24).toString('base64url');
  activeNonce = nonce;

  const port = await startCallbackServer();
  const siteUrl = getSiteUrl();
  const authUrl = `${siteUrl}/auth/desktop?port=${port}&nonce=${nonce}`;

  activeTimeout = setTimeout(() => {
    logger.warn('Site login flow timed out');
    shutdownServer();
  }, FLOW_TIMEOUT_MS);

  logger.info(`Site login flow initiated (port: ${port}, site: ${siteUrl})`);
  return { authUrl, port };
}

/**
 * Parse a URL-encoded form body from an IncomingMessage.
 */
function parseFormBody(req: IncomingMessage): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const MAX_BODY = 64 * 1024; // 64 KB — more than enough for tokens

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf-8')));
    });

    req.on('error', reject);
  });
}

/**
 * Start a temporary localhost HTTP server to receive the site callback.
 * Only accepts POST requests to prevent token leakage via URL/browser history.
 */
function startCallbackServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer(
      async (req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url ?? '/', 'http://localhost');

        if (url.pathname !== '/callback') {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        // Only accept POST to prevent tokens from leaking into browser history/referer
        if (req.method !== 'POST') {
          res.writeHead(405, { Allow: 'POST', 'Content-Type': 'text/plain' });
          res.end('Method Not Allowed');
          return;
        }

        try {
          const params = await parseFormBody(req);

          // Verify nonce first, before inspecting any other fields
          const receivedNonce = params.get('nonce');
          if (!activeNonce || receivedNonce !== activeNonce) {
            res.writeHead(403, { 'Content-Type': 'text/html' });
            res.end(buildCallbackHtml(false, 'Neumar'));
            logger.error('Site login callback nonce mismatch');
            shutdownServer();
            return;
          }

          const error = params.get('error');
          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(buildCallbackHtml(false, 'Neumar'));
            logger.error(`Site login error: ${error}`);
            shutdownServer();
            return;
          }

          const accessToken = params.get('access_token');
          const refreshToken = params.get('refresh_token');
          const expiresAt = params.get('expires_at');

          if (!accessToken || !refreshToken) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(buildCallbackHtml(false, 'Neumar'));
            logger.error('Site login callback missing tokens');
            shutdownServer();
            return;
          }

          const session: SiteSession = {
            accessToken,
            refreshToken,
            expiresAt:
              Number(expiresAt) || Math.floor(Date.now() / 1000) + 3600,
            userId: params.get('user_id') ?? '',
            userEmail: params.get('user_email') ?? '',
            userName: params.get('user_name') ?? '',
            userAvatar: params.get('user_avatar') ?? '',
          };

          // Persist Supabase connection details for token refresh
          const supabaseUrl = params.get('supabase_url');
          const supabaseAnonKey = params.get('supabase_anon_key');

          if (supabaseUrl) {
            const urlCheck = validateBaseUrl(supabaseUrl);
            if (!urlCheck.valid) {
              logger.error(`Rejected supabase_url: ${urlCheck.reason}`);
              res.writeHead(400, { 'Content-Type': 'text/html' });
              res.end(buildCallbackHtml(false, 'Neumar'));
              shutdownServer();
              return;
            }
            saveSetting('site_supabase_url', supabaseUrl);
          }
          if (supabaseAnonKey) {
            saveSetting('site_supabase_anon_key', supabaseAnonKey);
          }

          await storeSiteSession(session);

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(buildCallbackHtml(true, 'Neumar'));
          logger.info(
            `Site login completed for ${session.userEmail || session.userId}`,
          );
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(buildCallbackHtml(false, 'Neumar'));
          logger.error('Failed to process site login callback:', err);
        } finally {
          shutdownServer();
        }
      },
    );

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        activeServer = server;
        resolve(addr.port);
      } else {
        reject(new Error('Failed to bind site auth callback server'));
      }
    });

    server.on('error', (err) => {
      server.close();
      reject(err);
    });
  });
}

function shutdownServer(): void {
  if (activeTimeout) {
    clearTimeout(activeTimeout);
    activeTimeout = null;
  }
  if (activeServer) {
    activeServer.close();
    activeServer = null;
  }
  activeNonce = null;
}

/**
 * Store the site session using the existing token manager.
 * We store it as a 'site' provider connection + tokens.
 */
async function storeSiteSession(session: SiteSession): Promise<void> {
  const connection: OAuthConnection = {
    id: `site_${session.userId}`,
    provider: 'site',
    accountEmail: session.userEmail,
    displayName: session.userName,
    avatarUrl: session.userAvatar,
    scopes: [],
    status: 'active',
    connectedAt: new Date().toISOString(),
    expiresAt: new Date(session.expiresAt * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Store userId separately so we don't have to parse it from the compound ID
  saveSetting('site_user_id', session.userId);

  const tokens: OAuthTokens = {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    idToken: null,
    tokenType: 'bearer',
    expiresAt: session.expiresAt * 1000, // token manager uses ms
    scopes: [],
  };

  await tokenManager.saveTokens('site', connection, tokens);
}

/**
 * Refresh the site (Supabase) access token using the refresh_token.
 *
 * Calls Supabase's REST token endpoint directly — no SDK dependency needed.
 * Returns the new tokens on success, or null on failure.
 */
export async function refreshSiteToken(): Promise<OAuthTokens | null> {
  const tokens = await tokenManager.getTokens('site');
  if (!tokens?.refreshToken) {
    logger.warn('No refresh token available for site session');
    return null;
  }

  const supabaseUrl = getSetting('site_supabase_url');
  const supabaseAnonKey = getSetting('site_supabase_anon_key');

  if (!supabaseUrl || !supabaseAnonKey) {
    logger.warn('Cannot refresh site token — missing Supabase URL or anon key');
    return null;
  }

  const urlCheck = validateBaseUrl(supabaseUrl);
  if (!urlCheck.valid) {
    logger.error(
      `Blocked site token refresh — invalid Supabase URL: ${urlCheck.reason}`,
    );
    return null;
  }

  const res = await fetch(
    `${supabaseUrl}/auth/v1/token?grant_type=refresh_token`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseAnonKey,
      },
      body: JSON.stringify({ refresh_token: tokens.refreshToken }),
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!res.ok) {
    logger.error(`Site token refresh failed: ${res.status}`);
    return null;
  }

  const data = await res.json();

  if (
    typeof data.access_token !== 'string' ||
    typeof data.refresh_token !== 'string' ||
    typeof data.expires_in !== 'number'
  ) {
    logger.error('Invalid Supabase refresh response');
    return null;
  }

  const newTokens: OAuthTokens = {
    ...tokens,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  const connection = await tokenManager.getConnection('site');
  if (connection) {
    const updatedConnection = {
      ...connection,
      expiresAt: new Date(newTokens.expiresAt).toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await tokenManager.saveTokens('site', updatedConnection, newTokens);
  }

  logger.info('Site access token refreshed');
  return newTokens;
}

/**
 * Get the current site session, or null if not logged in.
 */
export async function getSiteSession(): Promise<SiteSession | null> {
  const connection = await tokenManager.getConnection('site');
  const tokens = await tokenManager.getTokens('site');

  if (!connection || !tokens) return null;

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? '',
    expiresAt: Math.floor(tokens.expiresAt / 1000),
    userId: getSetting('site_user_id') ?? '',
    userEmail: connection.accountEmail,
    userName: connection.displayName,
    userAvatar: connection.avatarUrl,
  };
}

/**
 * Log out from the site session.
 */
export async function logoutSite(): Promise<void> {
  await tokenManager.removeConnection('site');
  logger.info('Site session cleared');
}
