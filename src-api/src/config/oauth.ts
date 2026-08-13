/**
 * OAuth Provider Configuration
 *
 * Loads OAuth client credentials from environment variables or user settings.
 *
 * Security model for desktop apps (no backend server):
 *   - Google: Uses PKCE-only flow (no client_secret needed for native apps).
 *             Only GOOGLE_CLIENT_ID is required — built into the binary.
 *   - Slack/Notion: These providers require client_secret for token exchange
 *             and don't support PKCE. Users must provide their own OAuth app
 *             credentials via Settings → Connectors.
 *
 * How credentials are supplied:
 *   - Google client_id: Env var (build-time) or user setting
 *   - Slack/Notion:     User settings DB only (never bundled in binary)
 */

import type { OAuthProviderConfig } from '@/shared/auth/types';
import { getSetting } from '@/shared/db/operations';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('OAuthConfig');

// Google OAuth2 scopes — baseline for sign-in only
const GOOGLE_BASE_SCOPES = ['openid', 'email', 'profile'];

// Additional Google scopes requested incrementally
export const GOOGLE_GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
];

export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];

export const GOOGLE_DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
];

export const GOOGLE_PHOTOS_SCOPES = [
  'https://www.googleapis.com/auth/photospicker.mediaitems.readonly',
];

export const GOOGLE_MEET_SCOPES = [
  'https://www.googleapis.com/auth/meetings.space.created',
  'https://www.googleapis.com/auth/meetings.space.readonly',
];

export const GOOGLE_TASKS_SCOPES = ['https://www.googleapis.com/auth/tasks'];

export const GOOGLE_CONTACTS_SCOPES = [
  'https://www.googleapis.com/auth/contacts',
];

export const GOOGLE_DIRECTORY_SCOPES = [
  'https://www.googleapis.com/auth/directory.readonly',
];

export const GOOGLE_SHEETS_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
];

export const GOOGLE_SLIDES_SCOPES = [
  'https://www.googleapis.com/auth/presentations',
];

export const GOOGLE_DOCS_SCOPES = ['https://www.googleapis.com/auth/documents'];

// Slack OAuth2 scopes — bot token (installed into workspace)
export const SLACK_BOT_SCOPES = [
  'chat:write',
  'chat:write.public',
  'channels:read',
  'channels:history',
  'groups:history',
  'mpim:history',
  'users:read',
  'files:read',
  'files:write',
  'im:read',
  'im:write',
  'im:history',
  'app_mentions:read',
  'assistant:write',
  'reactions:write',
];

// Slack OAuth2 scopes — user token (MCP server requires these for search/history/canvases)
export const SLACK_USER_SCOPES = [
  'search:read',
  'chat:write',
  'channels:history',
  'groups:history',
  'im:history',
  'mpim:history',
  'users:read',
  'users:read.email',
  'canvases:read',
  'canvases:write',
];

// Notion — no scopes needed; access is page-level via user consent
const NOTION_SCOPES: string[] = [];

// Box scopes are configured app-level in the Box Developer Console
// (`root_readwrite` + any extras); the OAuth request itself doesn't
// take a `scope` param. We keep an empty array so the shared OAuth
// machinery stays happy.
const BOX_SCOPES: string[] = [];

// Dropbox per-request scopes — read-write access to files/sharing,
// account_info for the connected user's profile. `token_access_type`
// is set to `offline` at request time so we always get a refresh token.
export const DROPBOX_SCOPES = [
  'files.metadata.read',
  'files.content.read',
  'files.content.write',
  'sharing.read',
  'account_info.read',
];

// OneDrive personal via Microsoft Graph. `offline_access` is what
// makes the token endpoint hand back a refresh_token; without it the
// access_token is the only thing we ever see and it expires in ~1h.
export const ONEDRIVE_SCOPES = [
  'offline_access',
  'Files.ReadWrite',
  'Files.ReadWrite.All',
  'User.Read',
];

const ONEDRIVE_TENANT = 'consumers';

/**
 * Build the OAuth config for Google.
 *
 * Google "Desktop app" OAuth clients support PKCE without client_secret.
 * However, "Web application" clients still require it. We send it when
 * available (env var or user setting) and omit it when not.
 */
export function getGoogleOAuthConfig(): OAuthProviderConfig | null {
  const clientId =
    getSetting('oauth_google_client_id') || process.env.GOOGLE_CLIENT_ID;

  if (!clientId) {
    logger.debug('Google OAuth not configured (missing GOOGLE_CLIENT_ID)');
    return null;
  }

  // client_secret: optional for "Desktop app" type, required for "Web application" type
  const clientSecret =
    getSetting('oauth_google_client_secret') ||
    process.env.GOOGLE_CLIENT_SECRET ||
    undefined;

  return {
    clientId,
    clientSecret,
    scopes: GOOGLE_BASE_SCOPES,
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    revokeUrl: 'https://oauth2.googleapis.com/revoke',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
  };
}

/**
 * Build the OAuth config for Slack.
 *
 * Slack requires client_secret for token exchange and doesn't support PKCE.
 * Credentials must be provided by the user via Settings (never bundled).
 */
export function getSlackOAuthConfig(): OAuthProviderConfig | null {
  const clientId = getSetting('oauth_slack_client_id');
  const clientSecret = getSetting('oauth_slack_client_secret');

  if (!clientId || !clientSecret) {
    logger.debug(
      'Slack OAuth not configured (user has not provided Slack app credentials)',
    );
    return null;
  }

  return {
    clientId,
    clientSecret,
    scopes: SLACK_BOT_SCOPES,
    userScopes: SLACK_USER_SCOPES,
    authUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    revokeUrl: 'https://slack.com/api/auth.revoke',
  };
}

/**
 * Build the OAuth config for Notion.
 *
 * Notion requires client_secret (Basic auth) and doesn't support PKCE.
 * Credentials must be provided by the user via Settings (never bundled).
 */
export function getNotionOAuthConfig(): OAuthProviderConfig | null {
  const clientId = getSetting('oauth_notion_client_id');
  const clientSecret = getSetting('oauth_notion_client_secret');

  if (!clientId || !clientSecret) {
    logger.debug(
      'Notion OAuth not configured (user has not provided Notion app credentials)',
    );
    return null;
  }

  return {
    clientId,
    clientSecret,
    scopes: NOTION_SCOPES,
    authUrl: 'https://api.notion.com/v1/oauth/authorize',
    tokenUrl: 'https://api.notion.com/v1/oauth/token',
  };
}

/**
 * Build the OAuth config for Box.
 *
 * Box accepts PKCE for desktop apps but still requires `client_secret`
 * at the token endpoint (it doesn't expose a pure-public-client mode).
 * Loopback redirect URIs are permitted on any port.
 */
export function getBoxOAuthConfig(): OAuthProviderConfig | null {
  const clientId = getSetting('oauth_box_client_id');
  const clientSecret = getSetting('oauth_box_client_secret');

  if (!clientId || !clientSecret) {
    logger.debug(
      'Box OAuth not configured (user has not provided Box app credentials)',
    );
    return null;
  }

  return {
    clientId,
    clientSecret,
    scopes: BOX_SCOPES,
    authUrl: 'https://account.box.com/api/oauth2/authorize',
    tokenUrl: 'https://api.box.com/oauth2/token',
    revokeUrl: 'https://api.box.com/oauth2/revoke',
    userInfoUrl: 'https://api.box.com/2.0/users/me',
  };
}

/**
 * Build the OAuth config for Dropbox.
 *
 * Dropbox PKCE-only flow — no client_secret. Refresh tokens require
 * `token_access_type=offline` at /authorize time.
 */
export function getDropboxOAuthConfig(): OAuthProviderConfig | null {
  const clientId = getSetting('oauth_dropbox_client_id');

  if (!clientId) {
    logger.debug(
      'Dropbox OAuth not configured (user has not provided Dropbox app key)',
    );
    return null;
  }

  return {
    clientId,
    scopes: DROPBOX_SCOPES,
    authUrl: 'https://www.dropbox.com/oauth2/authorize',
    tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
    revokeUrl: 'https://api.dropboxapi.com/2/auth/token/revoke',
    userInfoUrl: 'https://api.dropboxapi.com/2/users/get_current_account',
  };
}

/**
 * Build the OAuth config for OneDrive personal via Microsoft Graph.
 *
 * Native / "Mobile and desktop applications" app registration → no
 * client_secret. `offline_access` is part of the scope set so the
 * token endpoint returns a refresh_token.
 */
export function getOneDriveOAuthConfig(): OAuthProviderConfig | null {
  const clientId = getSetting('oauth_onedrive_client_id');

  if (!clientId) {
    logger.debug(
      'OneDrive OAuth not configured (user has not provided OneDrive app id)',
    );
    return null;
  }

  return {
    clientId,
    scopes: ONEDRIVE_SCOPES,
    authUrl: `https://login.microsoftonline.com/${ONEDRIVE_TENANT}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${ONEDRIVE_TENANT}/oauth2/v2.0/token`,
    userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
  };
}

/**
 * Returns a map of all configured OAuth providers.
 * Providers without credentials are omitted.
 */
export function getConfiguredProviders(): Record<string, OAuthProviderConfig> {
  const providers: Record<string, OAuthProviderConfig> = {};

  const google = getGoogleOAuthConfig();
  if (google) providers.google = google;

  const slack = getSlackOAuthConfig();
  if (slack) providers.slack = slack;

  const notion = getNotionOAuthConfig();
  if (notion) providers.notion = notion;

  const box = getBoxOAuthConfig();
  if (box) providers.box = box;

  const dropbox = getDropboxOAuthConfig();
  if (dropbox) providers.dropbox = dropbox;

  const onedrive = getOneDriveOAuthConfig();
  if (onedrive) providers.onedrive = onedrive;

  return providers;
}
