/**
 * Auth System Types
 *
 * Shared type definitions for the OAuth2 authentication and
 * integration connection system.
 */

// Supported OAuth providers ('site' = authentication via the companion website)
export type OAuthProvider =
  | 'google'
  | 'slack'
  | 'notion'
  | 'box'
  | 'dropbox'
  | 'onedrive'
  | 'site';

// OAuth connection status
export type ConnectionStatus = 'active' | 'expired' | 'revoked' | 'error';

/**
 * Represents a connected OAuth integration.
 * Stored in both the DB (metadata) and encrypted files (tokens).
 */
export interface OAuthConnection {
  id: string;
  provider: OAuthProvider;
  accountEmail: string;
  displayName: string;
  avatarUrl: string;
  scopes: string[];
  status: ConnectionStatus;
  connectedAt: string;
  expiresAt: string | null;
  updatedAt: string;
  metadata?: Record<string, string>;
}

/**
 * OAuth token set — never exposed to the frontend.
 * Stored in encrypted files on disk with AES-256-GCM.
 */
export interface OAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  tokenType: string;
  expiresAt: number; // Unix timestamp (ms)
  scopes: string[];
  userAccessToken?: string;
}

/**
 * Provider-specific OAuth configuration loaded from environment.
 */
export interface OAuthProviderConfig {
  clientId: string;
  clientSecret?: string;
  scopes: string[];
  userScopes?: string[];
  authUrl: string;
  tokenUrl: string;
  revokeUrl?: string;
  userInfoUrl?: string;
}

/**
 * PKCE (Proof Key for Code Exchange) parameters
 * for the OAuth2 authorization code flow.
 */
export interface PKCEParams {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
}

/**
 * In-progress OAuth flow state.
 * Held in memory while the user completes the browser consent.
 */
export interface PendingOAuthFlow {
  provider: OAuthProvider;
  pkce: PKCEParams;
  state: string;
  redirectPort: number;
  createdAt: number;
  additionalScopes?: string[];
  timeoutId?: ReturnType<typeof setTimeout>;
}

// Connection health monitoring types

export type HealthStatus = 'healthy' | 'degraded' | 'revoked' | 'unknown';

export interface ConnectionHealthState {
  provider: OAuthProvider;
  status: HealthStatus;
  lastCheck: string;
  lastSuccess: string | null;
  error?: string;
  consecutiveFailures: number;
}

export type ConnectionEvent =
  | { type: 'connected'; provider: OAuthProvider }
  | { type: 'refreshed'; provider: OAuthProvider }
  | { type: 'expired'; provider: OAuthProvider }
  | { type: 'revoked'; provider: OAuthProvider }
  | { type: 'disconnected'; provider: OAuthProvider };

// API response types

export interface AuthStatusResponse {
  authenticated: boolean;
  connections: OAuthConnection[];
}

export interface AuthInitiateResponse {
  authUrl: string;
  state: string;
}

export interface AuthConnectionResponse {
  connection: OAuthConnection;
}

// Google-specific user info from the id_token / userinfo endpoint
export interface GoogleUserInfo {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
  hd?: string; // Hosted domain (Google Workspace)
}

// Slack OAuth v2 access response
export interface SlackOAuthResponse {
  ok: boolean;
  access_token: string;
  token_type: string;
  scope: string;
  bot_user_id?: string;
  app_id: string;
  team: { id: string; name: string };
  authed_user?: {
    id: string;
    scope: string;
    access_token: string;
    token_type: string;
  };
}

// Notion OAuth token response
export interface NotionOAuthResponse {
  access_token: string;
  token_type: string;
  bot_id: string;
  workspace_id: string;
  workspace_name: string;
  workspace_icon: string | null;
  owner: {
    type: string;
    user?: {
      id: string;
      name: string;
      avatar_url: string | null;
      person?: { email: string };
    };
  };
}
