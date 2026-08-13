/**
 * OAuth2 Client
 *
 * Implements the OAuth2 Authorization Code flow with PKCE for desktop apps.
 * Uses a temporary localhost HTTP server to capture the redirect callback,
 * following the Google-recommended approach for installed applications.
 *
 * Flow:
 *   1. Generate PKCE code_verifier + code_challenge
 *   2. Spin up a temporary localhost HTTP listener on a random port
 *   3. Return the authorization URL for the frontend to open in the system browser
 *   4. Wait for the provider to redirect back to http://localhost:{port}/callback
 *   5. Exchange the authorization code for tokens using code_verifier
 *   6. Shut down the temporary server
 */

import crypto from 'crypto';
import { createServer } from 'http';
import type { IncomingMessage, Server, ServerResponse } from 'http';

import {
  DROPBOX_SCOPES,
  ONEDRIVE_SCOPES,
  getBoxOAuthConfig,
  getDropboxOAuthConfig,
  getGoogleOAuthConfig,
  getNotionOAuthConfig,
  getOneDriveOAuthConfig,
  getSlackOAuthConfig,
} from '@/config/oauth';

import { createLogger } from '@/shared/utils/logger';

import * as tokenManager from './token-manager';
import type {
  OAuthConnection,
  OAuthProvider,
  OAuthProviderConfig,
  OAuthTokens,
  PendingOAuthFlow,
  PKCEParams,
} from './types';

const logger = createLogger('OAuthClient');

// Active OAuth flows keyed by state parameter
const pendingFlows = new Map<string, PendingOAuthFlow>();

// Active localhost servers keyed by state parameter
const activeServers = new Map<string, Server>();

// Timeout for pending flows (10 minutes)
const FLOW_TIMEOUT_MS = 10 * 60 * 1000;

// Non-expiring tokens (Slack, Notion) use a far-future sentinel value
const NON_EXPIRING_TOKEN_LIFETIME_MS = 10 * 365 * 24 * 60 * 60 * 1000; // ~10 years

// Fixed port for Slack OAuth callback — registered in Slack App's "Redirect URLs"
const SLACK_CALLBACK_PORT = 5189;

// Single fixed port for the new cloud-storage providers (Box, Dropbox,
// OneDrive) so users register one URI per provider:
//   http://localhost:52612/callback
// Falls back to an OS-assigned ephemeral port if 52612 is taken (e.g.
// another desktop OAuth flow already holds it). Slack and Notion keep
// their own behavior since their apps were already registered against
// dynamic ports historically.
const FIXED_CLOUD_OAUTH_PORT = 52612;
const FIXED_PORT_PROVIDERS = new Set<OAuthProvider>([
  'box',
  'dropbox',
  'onedrive',
]);

// ============================================================================
// PKCE Helpers
// ============================================================================

function generatePKCE(): PKCEParams {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: 'S256',
  };
}

function generateState(): string {
  return crypto.randomBytes(32).toString('base64url');
}

// ============================================================================
// Provider Config Lookup
// ============================================================================

function getProviderConfig(
  provider: OAuthProvider,
): OAuthProviderConfig | null {
  switch (provider) {
    case 'google':
      return getGoogleOAuthConfig();
    case 'slack':
      return getSlackOAuthConfig();
    case 'notion':
      return getNotionOAuthConfig();
    case 'box':
      return getBoxOAuthConfig();
    case 'dropbox':
      return getDropboxOAuthConfig();
    case 'onedrive':
      return getOneDriveOAuthConfig();
    default:
      return null;
  }
}

// ============================================================================
// Localhost Callback Server
// ============================================================================

/**
 * Build the HTML page shown to the user in the browser after OAuth completes.
 */
export function buildCallbackHtml(success: boolean, provider: string): string {
  const title = success ? 'Connected!' : 'Connection Failed';
  const message = success
    ? `Your ${provider} account was connected successfully.`
    : `Failed to connect your ${provider} account. Please return to the app and try again.`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #fafafa;
      --card: #ffffff;
      --border: #e4e4e7;
      --text: #18181b;
      --muted: #71717a;
      --success-bg: #f0fdf4;
      --success-color: #16a34a;
      --success-ring: #bbf7d0;
      --error-bg: #fff1f2;
      --error-color: #dc2626;
      --error-ring: #fecdd3;
      --progress: #3f3f46;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #09090b;
        --card: #18181b;
        --border: #27272a;
        --text: #fafafa;
        --muted: #a1a1aa;
        --success-bg: #052e16;
        --success-color: #4ade80;
        --success-ring: #14532d;
        --error-bg: #450a0a;
        --error-color: #f87171;
        --error-ring: #7f1d1d;
        --progress: #d4d4d8;
      }
    }

    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      background: var(--bg);
      color: var(--text);
    }

    .container {
      width: 100%;
      max-width: 380px;
      padding: 24px;
      animation: slide-up 0.45s cubic-bezier(0.16, 1, 0.3, 1) both;
    }

    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 36px 28px 28px;
      text-align: center;
    }

    .logo {
      width: 40px;
      height: 40px;
      margin: 0 auto 20px;
      animation: fade-in 0.3s 0.1s both;
    }

    .logo img { width: 100%; height: 100%; object-fit: contain; }

    .status-ring {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      margin: 0 auto 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: pop-in 0.4s 0.15s cubic-bezier(0.34, 1.56, 0.64, 1) both;
    }

    .status-ring.success {
      background: var(--success-bg);
      box-shadow: 0 0 0 5px var(--success-ring);
    }

    .status-ring.error {
      background: var(--error-bg);
      box-shadow: 0 0 0 5px var(--error-ring);
    }

    .status-ring svg { width: 26px; height: 26px; }
    .status-ring.success svg { color: var(--success-color); }
    .status-ring.error svg { color: var(--error-color); }

    h1 {
      font-size: 18px;
      font-weight: 600;
      letter-spacing: -0.01em;
      margin-bottom: 8px;
      animation: fade-in 0.3s 0.25s both;
    }

    .message {
      font-size: 13px;
      color: var(--muted);
      line-height: 1.65;
      animation: fade-in 0.3s 0.3s both;
    }

    .footer {
      margin-top: 24px;
      padding-top: 20px;
      border-top: 1px solid var(--border);
      animation: fade-in 0.3s 0.4s both;
    }

    .countdown-text {
      font-size: 12px;
      color: var(--muted);
      margin-bottom: 10px;
    }

    .progress-track {
      height: 2px;
      background: var(--border);
      border-radius: 99px;
      overflow: hidden;
    }

    .progress-bar {
      height: 100%;
      width: 100%;
      background: var(--progress);
      border-radius: 99px;
      transform-origin: left;
      animation: shrink 3s linear forwards;
    }

    @keyframes slide-up {
      from { opacity: 0; transform: translateY(10px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    @keyframes fade-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }

    @keyframes pop-in {
      from { opacity: 0; transform: scale(0.5); }
      to   { opacity: 1; transform: scale(1); }
    }

    @keyframes shrink {
      from { transform: scaleX(1); }
      to   { transform: scaleX(0); }
    }
  </style>
</head>
<body>
<div class="container">
  <div class="card">
    <div class="status-ring ${success ? 'success' : 'error'}">
      ${
        success
          ? '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>'
          : '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>'
      }
    </div>
    <h1>${title}</h1>
    <p class="message">${message}</p>
    <div class="footer">
      <p class="countdown-text" id="cd">Closing in <strong>3</strong> seconds&#8230;</p>
      <div class="progress-track"><div class="progress-bar"></div></div>
    </div>
  </div>
</div>
<script>
  var n = 3;
  var el = document.getElementById('cd');
  var t = setInterval(function () {
    n--;
    if (n <= 0) {
      clearInterval(t);
      el.textContent = 'Closing…';
      window.close();
      setTimeout(function () { el.textContent = 'You can close this tab.'; }, 800);
    } else {
      el.innerHTML = 'Closing in <strong>' + n + '</strong> second' + (n !== 1 ? 's' : '') + '…';
    }
  }, 1000);
</script>
</body>
</html>`;
}
/**
 * Start a temporary localhost HTTP server to receive the OAuth callback.
 * Resolves when the authorization code is received, or rejects on timeout.
 */
function startCallbackServer(
  state: string,
  onCode: (code: string) => void,
  onError: (error: Error) => void,
  provider: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', `http://localhost`);

      if (url.pathname === '/callback') {
        const code = url.searchParams.get('code');
        const returnedState = url.searchParams.get('state');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(buildCallbackHtml(false, provider));
          onError(new Error(`OAuth error: ${error}`));
          shutdownServer(state);
          return;
        }

        if (!code || returnedState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(buildCallbackHtml(false, provider));
          onError(
            new Error('Invalid callback: missing code or state mismatch'),
          );
          shutdownServer(state);
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(buildCallbackHtml(true, provider));
        onCode(code);
        shutdownServer(state);
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    const targetPort =
      provider === 'slack'
        ? SLACK_CALLBACK_PORT
        : FIXED_PORT_PROVIDERS.has(provider as OAuthProvider)
          ? FIXED_CLOUD_OAUTH_PORT
          : 0;

    const bindToPort = (port: number) => {
      server.listen(port, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          activeServers.set(state, server);
          resolve(addr.port);
        } else {
          reject(new Error('Failed to bind callback server'));
        }
      });

      server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && port !== 0) {
          logger.warn(
            `OAuth callback port ${port} busy for ${provider}, falling back to ephemeral port`,
          );
          server.removeAllListeners('error');
          bindToPort(0);
          return;
        }
        server.close();
        activeServers.delete(state);
        reject(err);
      });
    };

    bindToPort(targetPort);
  });
}

function shutdownServer(state: string): void {
  const flow = pendingFlows.get(state);
  if (flow?.timeoutId) {
    clearTimeout(flow.timeoutId);
  }

  const server = activeServers.get(state);
  if (server) {
    server.close();
    activeServers.delete(state);
  }
  pendingFlows.delete(state);
}

// ============================================================================
// OAuth Flow — Initiate
// ============================================================================

/**
 * Initiate OAuth and handle the full flow asynchronously.
 * Returns the authUrl immediately; the callback server handles token exchange
 * when the provider redirects back to the localhost listener.
 */
export async function initiateAndHandleOAuth(
  provider: OAuthProvider,
  additionalScopes?: string[],
): Promise<{ authUrl: string; state: string }> {
  const config = getProviderConfig(provider);
  if (!config) {
    throw new Error(`OAuth provider "${provider}" is not configured.`);
  }

  const pkce = generatePKCE();
  const state = generateState();

  const scopes = [...config.scopes];
  if (additionalScopes) {
    for (const s of additionalScopes) {
      if (!scopes.includes(s)) scopes.push(s);
    }
  }

  // Start the callback server and wire up the full exchange flow
  const port = await startCallbackServer(
    state,
    async (code) => {
      try {
        await exchangeCodeForTokens(provider, code, state);
        logger.info(`OAuth flow completed successfully for ${provider}`);
      } catch (err) {
        logger.error(`Failed to exchange code for ${provider}:`, err);
      }
    },
    (err) => {
      logger.error(`OAuth callback error for ${provider}:`, err);
    },
    provider,
  );

  const redirectUri = `http://localhost:${port}/callback`;

  const params = new URLSearchParams();
  params.set('client_id', config.clientId);
  params.set('redirect_uri', redirectUri);
  params.set('response_type', 'code');
  params.set('state', state);

  if (provider === 'google') {
    params.set('scope', scopes.join(' '));
    params.set('code_challenge', pkce.codeChallenge);
    params.set('code_challenge_method', pkce.codeChallengeMethod);
    params.set('access_type', 'offline');
    params.set('prompt', 'consent');
    if (additionalScopes && additionalScopes.length > 0) {
      params.set('include_granted_scopes', 'true');
    }
  } else if (provider === 'slack') {
    params.set('scope', scopes.join(','));
    if (config.userScopes && config.userScopes.length > 0) {
      params.set('user_scope', config.userScopes.join(','));
    }
  } else if (provider === 'notion') {
    params.set('owner', 'user');
  } else if (provider === 'box') {
    // Box scopes are app-level; no `scope` param. PKCE is supported and
    // recommended for desktop clients even though Box still requires
    // client_secret at /token.
    params.set('code_challenge', pkce.codeChallenge);
    params.set('code_challenge_method', pkce.codeChallengeMethod);
  } else if (provider === 'dropbox') {
    params.set('scope', scopes.join(' '));
    params.set('code_challenge', pkce.codeChallenge);
    params.set('code_challenge_method', pkce.codeChallengeMethod);
    // Required to receive a refresh_token alongside the access_token.
    params.set('token_access_type', 'offline');
  } else if (provider === 'onedrive') {
    params.set('scope', scopes.join(' '));
    params.set('code_challenge', pkce.codeChallenge);
    params.set('code_challenge_method', pkce.codeChallengeMethod);
    // Force account picker even when the user has signed in to MSA in
    // the system browser, to avoid surprising silent-sign-in into the
    // wrong account.
    params.set('prompt', 'select_account');
  }

  const authUrl = `${config.authUrl}?${params.toString()}`;

  const timeoutId = setTimeout(() => {
    if (pendingFlows.has(state)) {
      logger.warn(`OAuth flow timed out for ${provider}`);
      shutdownServer(state);
    }
  }, FLOW_TIMEOUT_MS);

  pendingFlows.set(state, {
    provider,
    pkce,
    state,
    redirectPort: port,
    createdAt: Date.now(),
    additionalScopes,
    timeoutId,
  });

  logger.info(`Initiated OAuth flow for ${provider} (port: ${port})`);
  return { authUrl, state };
}

// ============================================================================
// Token Exchange
// ============================================================================

/**
 * Exchange an authorization code for tokens.
 * Called by the callback server after the user consents.
 */
async function exchangeCodeForTokens(
  provider: OAuthProvider,
  code: string,
  state: string,
): Promise<OAuthConnection> {
  const flow = pendingFlows.get(state);
  if (!flow) {
    throw new Error('No pending OAuth flow found for this state');
  }

  const config = getProviderConfig(provider);
  if (!config) {
    throw new Error(`Provider ${provider} is not configured`);
  }

  // Listener binds to 127.0.0.1 (see startCallbackServer); modern
  // browsers resolve "localhost" → 127.0.0.1 so the callback still hits
  // our process. Using "localhost" in the redirect_uri matches what
  // most OAuth provider consoles document, so users register one URI.
  const redirectUri = `http://localhost:${flow.redirectPort}/callback`;

  // Build the token exchange request
  let connection: OAuthConnection;

  if (provider === 'google') {
    connection = await exchangeGoogle(config, code, flow, redirectUri);
  } else if (provider === 'slack') {
    connection = await exchangeSlack(config, code, redirectUri);
  } else if (provider === 'notion') {
    connection = await exchangeNotion(config, code, redirectUri);
  } else if (provider === 'box') {
    connection = await exchangeBox(config, code, flow, redirectUri);
  } else if (provider === 'dropbox') {
    connection = await exchangeDropbox(config, code, flow, redirectUri);
  } else if (provider === 'onedrive') {
    connection = await exchangeOneDrive(config, code, flow, redirectUri);
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  pendingFlows.delete(state);
  return connection;
}

// ============================================================================
// Provider-Specific Exchange Logic
// ============================================================================

async function exchangeGoogle(
  config: OAuthProviderConfig,
  code: string,
  flow: PendingOAuthFlow,
  redirectUri: string,
): Promise<OAuthConnection> {
  // PKCE flow — client_secret is optional for "Desktop app" type,
  // required for "Web application" type Google OAuth clients.
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    code_verifier: flow.pkce.codeVerifier,
  });
  if (config.clientSecret) {
    body.set('client_secret', config.clientSecret);
  }

  const tokenRes = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(
      `Google token exchange failed: ${tokenRes.status} ${errText}`,
    );
  }

  const tokenData = await tokenRes.json();

  if (
    typeof tokenData.access_token !== 'string' ||
    typeof tokenData.expires_in !== 'number' ||
    typeof tokenData.scope !== 'string'
  ) {
    throw new Error(
      'Invalid Google token response: missing access_token, expires_in, or scope',
    );
  }

  // Fetch user profile
  if (!config.userInfoUrl) {
    throw new Error('Google OAuth config missing userInfoUrl');
  }
  const userInfoRes = await fetch(config.userInfoUrl, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  if (!userInfoRes.ok) {
    throw new Error(
      `Google userinfo fetch failed: ${userInfoRes.status} ${await userInfoRes.text()}`,
    );
  }
  const userInfo = await userInfoRes.json();

  if (typeof userInfo.sub !== 'string' || typeof userInfo.email !== 'string') {
    throw new Error('Invalid Google userinfo response: missing sub or email');
  }

  const refreshToken: string | null = tokenData.refresh_token ?? null;

  if (!refreshToken) {
    logger.warn(
      'Google token exchange did NOT return a refresh_token. ' +
        'Persistent access will fail after the access token expires (~60 min). ' +
        'The user may need to revoke and re-authorize with prompt=consent.',
    );
  }

  const tokens: OAuthTokens = {
    accessToken: tokenData.access_token,
    refreshToken,
    idToken: tokenData.id_token ?? null,
    tokenType: tokenData.token_type,
    expiresAt: Date.now() + tokenData.expires_in * 1000,
    scopes: tokenData.scope.split(' '),
  };

  // Mark connection as 'error' when no refresh token — persistent access won't work
  const connection: OAuthConnection = {
    id: `google_${userInfo.sub}`,
    provider: 'google',
    accountEmail: userInfo.email,
    displayName: userInfo.name,
    avatarUrl: userInfo.picture ?? '',
    scopes: tokens.scopes,
    status: refreshToken ? 'active' : 'error',
    connectedAt: new Date().toISOString(),
    expiresAt: new Date(tokens.expiresAt).toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await tokenManager.saveTokens('google', connection, tokens);
  return connection;
}

async function exchangeSlack(
  config: OAuthProviderConfig,
  code: string,
  redirectUri: string,
): Promise<OAuthConnection> {
  if (!config.clientSecret) {
    throw new Error(
      'Slack OAuth requires client_secret — configure it in Settings → Connectors',
    );
  }
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: redirectUri,
  });

  const tokenRes = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await tokenRes.json();
  if (
    !data.ok ||
    typeof data.access_token !== 'string' ||
    typeof data.scope !== 'string' ||
    !data.team?.id
  ) {
    throw new Error(`Slack token exchange failed: ${JSON.stringify(data)}`);
  }

  const userAccessToken = data.authed_user?.access_token ?? undefined;
  const userScopes = data.authed_user?.scope
    ? data.authed_user.scope.split(',')
    : [];

  const tokens: OAuthTokens = {
    accessToken: data.access_token,
    refreshToken: null,
    idToken: null,
    tokenType: data.token_type,
    expiresAt: Date.now() + NON_EXPIRING_TOKEN_LIFETIME_MS,
    scopes: data.scope.split(','),
    userAccessToken,
  };

  const connection: OAuthConnection = {
    id: `slack_${data.team.id}`,
    provider: 'slack',
    accountEmail: data.team.name,
    displayName: data.team.name,
    avatarUrl: '',
    scopes: [...tokens.scopes, ...userScopes],
    status: 'active',
    connectedAt: new Date().toISOString(),
    expiresAt: null,
    updatedAt: new Date().toISOString(),
    metadata: {
      teamId: data.team.id,
      teamName: data.team.name,
      ...(data.bot_user_id ? { botUserId: data.bot_user_id } : {}),
      ...(data.authed_user?.id ? { authedUserId: data.authed_user.id } : {}),
    },
  };

  await tokenManager.saveTokens('slack', connection, tokens);
  return connection;
}

async function exchangeNotion(
  config: OAuthProviderConfig,
  code: string,
  redirectUri: string,
): Promise<OAuthConnection> {
  if (!config.clientSecret) {
    throw new Error(
      'Notion OAuth requires client_secret — configure it in Settings → Connectors',
    );
  }
  const credentials = Buffer.from(
    `${config.clientId}:${config.clientSecret}`,
  ).toString('base64');

  const tokenRes = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${credentials}`,
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(
      `Notion token exchange failed: ${tokenRes.status} ${errText}`,
    );
  }

  const data = await tokenRes.json();

  if (
    typeof data.access_token !== 'string' ||
    typeof data.workspace_id !== 'string'
  ) {
    throw new Error(
      'Invalid Notion token response: missing access_token or workspace_id',
    );
  }

  const email =
    data.owner?.user?.person?.email ??
    data.owner?.user?.name ??
    data.workspace_name;

  const tokens: OAuthTokens = {
    accessToken: data.access_token,
    refreshToken: null,
    idToken: null,
    tokenType: data.token_type,
    expiresAt: Date.now() + NON_EXPIRING_TOKEN_LIFETIME_MS, // Notion tokens don't expire
    scopes: [],
  };

  const connection: OAuthConnection = {
    id: `notion_${data.workspace_id}`,
    provider: 'notion',
    accountEmail: email,
    displayName: data.workspace_name,
    avatarUrl: data.workspace_icon ?? '',
    scopes: [],
    status: 'active',
    connectedAt: new Date().toISOString(),
    expiresAt: null,
    updatedAt: new Date().toISOString(),
  };

  await tokenManager.saveTokens('notion', connection, tokens);
  return connection;
}

// ============================================================================
// Cloud-storage providers: Box / Dropbox / OneDrive
// ============================================================================

async function postTokenForm(
  url: string,
  body: URLSearchParams,
  providerLabel: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      `${providerLabel} token exchange failed: ${res.status} ${detail.slice(0, 300)}`,
    );
  }
  return (await res.json()) as Record<string, unknown>;
}

function tokenSet(
  data: Record<string, unknown>,
  scopes: string[],
  fallbackTtlMs: number,
): OAuthTokens {
  const accessToken =
    typeof data.access_token === 'string' ? data.access_token : '';
  if (!accessToken) {
    throw new Error('Token response missing access_token');
  }
  const expiresInSec =
    typeof data.expires_in === 'number' ? data.expires_in : undefined;
  return {
    accessToken,
    refreshToken:
      typeof data.refresh_token === 'string' ? data.refresh_token : null,
    idToken: typeof data.id_token === 'string' ? data.id_token : null,
    tokenType: typeof data.token_type === 'string' ? data.token_type : 'bearer',
    expiresAt:
      Date.now() + (expiresInSec ? expiresInSec * 1000 : fallbackTtlMs),
    scopes,
  };
}

async function exchangeBox(
  config: OAuthProviderConfig,
  code: string,
  _flow: PendingOAuthFlow,
  redirectUri: string,
): Promise<OAuthConnection> {
  if (!config.clientSecret) {
    throw new Error('Box OAuth requires client_secret.');
  }
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: redirectUri,
    // Box accepts PKCE alongside client_secret; sending the verifier is
    // mandatory if code_challenge was sent at /authorize.
    code_verifier: _flow.pkce.codeVerifier,
  });
  const data = await postTokenForm(config.tokenUrl, body, 'Box');
  const tokens = tokenSet(data, [], 60 * 60 * 1000);
  if (!tokens.refreshToken) {
    logger.warn(
      'Box token exchange returned no refresh_token; connection will silently expire when the access token does.',
    );
  }

  // Fetch Box profile so we can show a real account label.
  const profile = await fetchJson(config.userInfoUrl ?? '', {
    Authorization: `Bearer ${tokens.accessToken}`,
  });
  const accountId = stringField(profile, 'id') ?? 'unknown';
  const email = stringField(profile, 'login') ?? '';
  const name = stringField(profile, 'name') ?? email;

  const connection: OAuthConnection = {
    id: `box_${accountId}`,
    provider: 'box',
    accountEmail: email,
    displayName: name,
    avatarUrl: '',
    scopes: tokens.scopes,
    status: 'active',
    connectedAt: new Date().toISOString(),
    expiresAt: new Date(tokens.expiresAt).toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await tokenManager.saveTokens('box', connection, tokens);
  return connection;
}

async function exchangeDropbox(
  config: OAuthProviderConfig,
  code: string,
  flow: PendingOAuthFlow,
  redirectUri: string,
): Promise<OAuthConnection> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: config.clientId,
    redirect_uri: redirectUri,
    code_verifier: flow.pkce.codeVerifier,
  });
  const data = await postTokenForm(config.tokenUrl, body, 'Dropbox');
  const tokens = tokenSet(data, DROPBOX_SCOPES, 4 * 60 * 60 * 1000);
  if (!tokens.refreshToken) {
    logger.warn(
      'Dropbox token exchange returned no refresh_token; ensure the app uses the "code + token_access_type=offline" flow.',
    );
  }

  const profile = await fetchJson(
    config.userInfoUrl ?? '',
    { Authorization: `Bearer ${tokens.accessToken}` },
    'POST',
  );
  const accountId =
    stringField(profile, 'account_id') ??
    (typeof data.account_id === 'string'
      ? (data.account_id as string)
      : 'unknown');
  const email = stringField(profile, 'email') ?? '';
  const name =
    stringField(asObject(profile.name), 'display_name') ??
    stringField(profile, 'display_name') ??
    email;

  const connection: OAuthConnection = {
    id: `dropbox_${accountId}`,
    provider: 'dropbox',
    accountEmail: email,
    displayName: name,
    avatarUrl: '',
    scopes: tokens.scopes,
    status: 'active',
    connectedAt: new Date().toISOString(),
    expiresAt: new Date(tokens.expiresAt).toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await tokenManager.saveTokens('dropbox', connection, tokens);
  return connection;
}

async function exchangeOneDrive(
  config: OAuthProviderConfig,
  code: string,
  flow: PendingOAuthFlow,
  redirectUri: string,
): Promise<OAuthConnection> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: config.clientId,
    redirect_uri: redirectUri,
    code_verifier: flow.pkce.codeVerifier,
    scope: ONEDRIVE_SCOPES.join(' '),
  });
  const data = await postTokenForm(config.tokenUrl, body, 'OneDrive');
  const grantedScopes =
    typeof data.scope === 'string'
      ? (data.scope as string).split(' ')
      : ONEDRIVE_SCOPES;
  const tokens = tokenSet(data, grantedScopes, 60 * 60 * 1000);
  if (!tokens.refreshToken) {
    logger.warn(
      'OneDrive token exchange returned no refresh_token; ensure the offline_access scope is requested.',
    );
  }

  const profile = await fetchJson(config.userInfoUrl ?? '', {
    Authorization: `Bearer ${tokens.accessToken}`,
  });
  const accountId = stringField(profile, 'id') ?? 'unknown';
  const email =
    stringField(profile, 'mail') ??
    stringField(profile, 'userPrincipalName') ??
    '';
  const name = stringField(profile, 'displayName') ?? email;

  const connection: OAuthConnection = {
    id: `onedrive_${accountId}`,
    provider: 'onedrive',
    accountEmail: email,
    displayName: name,
    avatarUrl: '',
    scopes: tokens.scopes,
    status: 'active',
    connectedAt: new Date().toISOString(),
    expiresAt: new Date(tokens.expiresAt).toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await tokenManager.saveTokens('onedrive', connection, tokens);
  return connection;
}

async function fetchJson(
  url: string,
  headers: Record<string, string>,
  method: 'GET' | 'POST' = 'GET',
): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method, headers });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      `Profile fetch failed: ${res.status} ${detail.slice(0, 200)}`,
    );
  }
  return (await res.json()) as Record<string, unknown>;
}

function stringField(
  body: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  if (!body) return undefined;
  const value = body[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

// ============================================================================
// Token Refresh
// ============================================================================

/**
 * Refresh a Google OAuth access token using the refresh_token.
 * Other providers (Slack, Notion) use long-lived tokens that don't need refresh.
 */
export async function refreshGoogleToken(): Promise<OAuthTokens | null> {
  const config = getGoogleOAuthConfig();
  if (!config) return null;

  const tokens = await tokenManager.getTokens('google');
  if (!tokens?.refreshToken) {
    logger.warn('No refresh token available for Google');
    return null;
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    refresh_token: tokens.refreshToken,
    grant_type: 'refresh_token',
  });
  if (config.clientSecret) {
    body.set('client_secret', config.clientSecret);
  }

  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    logger.error(
      `Google token refresh failed: ${res.status} ${detail.slice(0, 300)}`,
    );
    return null;
  }

  const data = await res.json();

  if (
    typeof data.access_token !== 'string' ||
    typeof data.expires_in !== 'number' ||
    typeof data.scope !== 'string'
  ) {
    logger.error('Invalid Google refresh token response');
    return null;
  }

  const newTokens: OAuthTokens = {
    ...tokens,
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    scopes: data.scope.split(' '),
  };

  const connection = await tokenManager.getConnection('google');
  if (connection) {
    const updatedConnection = {
      ...connection,
      expiresAt: new Date(newTokens.expiresAt).toISOString(),
      updatedAt: new Date().toISOString(),
      scopes: newTokens.scopes,
    };
    await tokenManager.saveTokens('google', updatedConnection, newTokens);
  }

  logger.info('Google access token refreshed');
  return newTokens;
}

async function refreshGenericOAuthToken(
  provider: OAuthProvider,
): Promise<OAuthTokens | null> {
  const config = getProviderConfig(provider);
  if (!config) return null;
  const tokens = await tokenManager.getTokens(provider);
  if (!tokens?.refreshToken) {
    logger.warn(`No refresh token available for ${provider}`);
    return null;
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
    client_id: config.clientId,
  });
  if (config.clientSecret) {
    body.set('client_secret', config.clientSecret);
  }
  if (provider === 'onedrive') {
    body.set('scope', ONEDRIVE_SCOPES.join(' '));
  }

  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    logger.error(
      `${provider} token refresh failed: ${res.status} ${detail.slice(0, 300)}`,
    );
    return null;
  }
  const data = (await res.json()) as Record<string, unknown>;
  const accessToken =
    typeof data.access_token === 'string' ? data.access_token : '';
  if (!accessToken) {
    logger.error(`Invalid ${provider} refresh response (no access_token)`);
    return null;
  }
  const expiresInSec =
    typeof data.expires_in === 'number' ? data.expires_in : 60 * 60;
  const newTokens: OAuthTokens = {
    ...tokens,
    accessToken,
    // Box rotates the refresh_token on every refresh; Dropbox/OneDrive
    // typically reuse the same one. Persist whatever the server returned.
    refreshToken:
      typeof data.refresh_token === 'string'
        ? (data.refresh_token as string)
        : tokens.refreshToken,
    expiresAt: Date.now() + expiresInSec * 1000,
    scopes:
      typeof data.scope === 'string'
        ? (data.scope as string).split(' ')
        : tokens.scopes,
  };

  const connection = await tokenManager.getConnection(provider);
  if (connection) {
    await tokenManager.saveTokens(
      provider,
      {
        ...connection,
        expiresAt: new Date(newTokens.expiresAt).toISOString(),
        updatedAt: new Date().toISOString(),
        scopes: newTokens.scopes,
      },
      newTokens,
    );
  }
  logger.info(`${provider} access token refreshed`);
  return newTokens;
}

export async function refreshAccessToken(
  provider: OAuthProvider,
): Promise<OAuthTokens | null> {
  if (provider === 'google') return refreshGoogleToken();
  if (provider === 'box' || provider === 'dropbox' || provider === 'onedrive') {
    return refreshGenericOAuthToken(provider);
  }
  return null;
}

export interface GetValidAccessTokenOptions {
  /** Legacy: 'user' resolves the per-app user access token (Slack only). */
  tokenType?: 'user';
  /**
   * Phase C of the connector-tier isolation plan. When supplied, the resolver
   * will *prefer* a per-identity token (via Slack App Home `slack_user_oauth`
   * or, in future, Supabase team-account credentials). When no per-identity
   * token exists, the resolver intentionally returns null instead of falling
   * back to the global admin token — that fallback is what the original
   * vulnerability allowed. Callers wanting the legacy "global token" behaviour
   * must call without `identityId`.
   */
  identityId?: string;
}

/**
 * Get a valid access token for a provider, refreshing if necessary.
 *
 * The legacy two-positional-argument signature
 * (`getValidAccessToken(provider, 'user')`) is still accepted for backwards
 * compatibility but new callers should use the options object so they can
 * pass `identityId` once Phase C lands per-identity OAuth.
 */
export async function getValidAccessToken(
  provider: OAuthProvider,
  optsOrTokenType?: 'user' | GetValidAccessTokenOptions,
): Promise<string | null> {
  const opts: GetValidAccessTokenOptions =
    optsOrTokenType === 'user'
      ? { tokenType: 'user' }
      : (optsOrTokenType ?? {});

  // Phase C — identity-scoped lookup short-circuit.
  // When an identityId is supplied, callers are explicitly opting into the
  // per-identity model and must NOT fall back to the global admin token.
  if (opts.identityId) {
    // Stub: per-identity resolution will land alongside Phase 3b
    // (slack-app-home-oauth-supabase) and the Google scope migration.
    // Returning null until then is the correct fail-closed behaviour.
    return null;
  }

  const tokens = await tokenManager.getTokens(provider);
  if (!tokens) return null;

  if (
    (provider === 'google' ||
      provider === 'box' ||
      provider === 'dropbox' ||
      provider === 'onedrive') &&
    tokenManager.isTokenExpired(tokens)
  ) {
    const refreshed = await refreshAccessToken(provider);
    return refreshed?.accessToken ?? null;
  }

  if (opts.tokenType === 'user') return tokens.userAccessToken ?? null;
  return tokens.accessToken;
}

/** Get the scopes granted for a provider's current token */
export async function getGrantedScopes(
  provider: OAuthProvider,
): Promise<string[]> {
  const tokens = await tokenManager.getTokens(provider);
  return tokens?.scopes ?? [];
}

// ============================================================================
// Revocation
// ============================================================================

/** Revoke tokens and remove the connection for a provider */
export async function revokeConnection(provider: OAuthProvider): Promise<void> {
  const config = getProviderConfig(provider);
  const tokens = await tokenManager.getTokens(provider);

  // Attempt to revoke at the provider level (best-effort)
  if (config?.revokeUrl && tokens) {
    try {
      if (provider === 'google') {
        await fetch(`${config.revokeUrl}?token=${tokens.accessToken}`, {
          method: 'POST',
        });
      } else if (provider === 'slack') {
        await fetch(config.revokeUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Bearer ${tokens.accessToken}`,
          },
        });
      } else if (provider === 'box') {
        // Box revoke: POST /oauth2/revoke with client credentials + token
        // per https://developer.box.com/reference/post-oauth2-revoke/.
        // Use refreshToken if present so the entire grant is invalidated;
        // otherwise the access token alone is acceptable.
        const body = new URLSearchParams({
          client_id: config.clientId,
          token: tokens.refreshToken ?? tokens.accessToken,
        });
        if (config.clientSecret) body.set('client_secret', config.clientSecret);
        await fetch(config.revokeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        });
      } else if (provider === 'dropbox') {
        // Dropbox revoke: POST /2/auth/token/revoke with bearer auth per
        // https://www.dropbox.com/developers/documentation/http/documentation#auth-token-revoke
        await fetch(config.revokeUrl, {
          method: 'POST',
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
        });
      }
      // OneDrive (Microsoft Graph) has no per-app revoke endpoint —
      // disconnection is initiated by the user in their account portal.
    } catch (err) {
      logger.warn(
        `Remote revocation failed for ${provider} (non-critical):`,
        err,
      );
    }
  }

  await tokenManager.removeConnection(provider);
  logger.info(`Revoked connection for ${provider}`);
}

// ============================================================================
// Available Providers
// ============================================================================

/** Get a list of which providers are configured (have credentials) */
export function getAvailableProviders(): OAuthProvider[] {
  const available: OAuthProvider[] = [];
  if (getGoogleOAuthConfig()) available.push('google');
  if (getSlackOAuthConfig()) available.push('slack');
  if (getNotionOAuthConfig()) available.push('notion');
  if (getBoxOAuthConfig()) available.push('box');
  if (getDropboxOAuthConfig()) available.push('dropbox');
  if (getOneDriveOAuthConfig()) available.push('onedrive');
  return available;
}
