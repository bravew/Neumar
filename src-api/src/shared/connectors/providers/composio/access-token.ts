/**
 * Resolves the active OAuth access_token for a Composio-connected
 * connector. Uses `credentials-cache.ts` for in-memory caching and the
 * provider for connected-account discovery and the upstream fetch.
 *
 * Split from `credentials.ts` so the cache module stays import-free and
 * `provider.ts` can clear cache entries during disconnect without
 * creating a dependency cycle.
 */
import { getComposioProvider } from '.';
import {
  clearCachedAccessToken,
  getCachedAccessToken,
  setCachedAccessToken,
} from './credentials-cache';

export class ComposioCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ComposioCredentialError';
  }
}

function pickField(
  body: Record<string, unknown> | undefined,
  ...keys: string[]
): string | undefined {
  if (!body) return undefined;
  for (const key of keys) {
    const value = body[key];
    if (typeof value === 'string' && value.length > 0 && !isMaskedSecret(value))
      return value;
  }
  return undefined;
}

/**
 * Composio masks secret fields when the project flag
 * `mask_secret_keys_in_connected_account` is enabled (the default):
 *   - values < 4 chars become the literal string "REDACTED"
 *   - longer values get the first 4 chars + "..." (e.g. "gho_...")
 * Either form is unusable as a bearer, so treat both as "no token".
 */
function isMaskedSecret(value: string): boolean {
  if (value === 'REDACTED') return true;
  return /^[A-Za-z0-9_-]{1,8}\.{3}$/.test(value);
}

function containsMaskedSecret(body: Record<string, unknown>): boolean {
  const data = asObject(body.data);
  const state = asObject(body.state) ?? asObject(data?.state);
  const stateVal = asObject(state?.val);
  const candidates = [stateVal, asObject(data?.val), state, data, body];
  for (const candidate of candidates) {
    if (!candidate) continue;
    for (const key of ['access_token', 'accessToken', 'token']) {
      const value = candidate[key];
      if (typeof value === 'string' && isMaskedSecret(value)) return true;
    }
  }
  return false;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function extractAccessToken(
  body: Record<string, unknown>,
): { token: string; expiresIn?: number } | null {
  // Composio's connected-account body nests credentials under
  // `state.val` (current v3.1 shape): `{ state: { authScheme: 'OAUTH2',
  // val: { access_token, refresh_token, expires_in, … } } }`. Older /
  // alternative shapes flatten the token onto the root or under `data`.
  // Probe each in order — the nested `state.val` form is the only one
  // that holds a real provider bearer; the others are fallbacks.
  const data = asObject(body.data);
  const state = asObject(body.state) ?? asObject(data?.state);
  const stateVal = asObject(state?.val);
  const dataVal = asObject(data?.val);

  const candidates: (Record<string, unknown> | undefined)[] = [
    stateVal,
    dataVal,
    state,
    data,
    body,
  ];

  for (const candidate of candidates) {
    const token = pickField(
      candidate,
      'access_token',
      'accessToken',
      // Bearer-token auth scheme stores it as plain `token`.
      'token',
    );
    if (!token) continue;
    const expires =
      candidate?.expires_in ??
      candidate?.expiresIn ??
      stateVal?.expires_in ??
      stateVal?.expiresIn ??
      body.expires_in;
    return {
      token,
      expiresIn: typeof expires === 'number' ? expires : undefined,
    };
  }
  return null;
}

/**
 * Fetch a fresh OAuth access token for the given Composio connector.
 * Cached in-memory; pass `force: true` to bypass and re-fetch from
 * Composio (used on 401 to handle a stale token after a server-side
 * refresh).
 */
export async function fetchComposioAccessToken(
  connectorId: string,
  options: { force?: boolean } = {},
): Promise<string> {
  const provider = getComposioProvider();
  const connectedAccountId = provider.getActiveConnectedAccountId(connectorId);
  if (!connectedAccountId) {
    throw new ComposioCredentialError(
      `Connector "${connectorId}" is not connected.`,
    );
  }

  if (!options.force) {
    const cached = getCachedAccessToken(connectedAccountId);
    if (cached) return cached;
  } else {
    // Force-refresh path: ask Composio to rotate the upstream token before
    // we read it. The GET on /connected_accounts/:id can serve a stale
    // token that the upstream provider (Box, OneDrive, …) will reject with
    // 401; the explicit /refresh endpoint forces Composio to swap in a
    // fresh one. Best-effort — fall through to GET if refresh is rejected.
    clearCachedAccessToken(connectedAccountId);
    try {
      await provider.refreshConnectedAccount(connectedAccountId);
    } catch {
      /* fall through; GET may still return a usable token */
    }
  }

  const body = await provider.fetchConnectedAccount(connectedAccountId);
  if (!body) {
    throw new ComposioCredentialError(
      `Composio did not return credentials for ${connectorId}.`,
    );
  }
  const extracted = extractAccessToken(body);
  if (!extracted) {
    const status = typeof body.status === 'string' ? body.status : undefined;
    if (status && status !== 'ACTIVE') {
      throw new ComposioCredentialError(
        `Composio connected account for ${connectorId} is not active (status=${status}). Disconnect and reconnect.`,
      );
    }
    if (containsMaskedSecret(body)) {
      throw new ComposioCredentialError(
        `Composio masked the access_token for ${connectorId}. Disable "Mask Connected Account Secrets" in the Composio project settings (or reset the API key in Neuma to retry the automatic flip).`,
      );
    }
    throw new ComposioCredentialError(
      `No access_token in Composio response for ${connectorId}.`,
    );
  }
  setCachedAccessToken(
    connectedAccountId,
    extracted.token,
    extracted.expiresIn,
  );
  return extracted.token;
}

/**
 * Clear cached tokens for a connector by resolving its connected-account
 * ids first. Pass no connector id to clear the entire cache (called on
 * Composio API-key reset).
 */
export function clearComposioCredentialCache(connectorId?: string): void {
  if (!connectorId) {
    clearCachedAccessToken();
    return;
  }
  let provider: ReturnType<typeof getComposioProvider>;
  try {
    provider = getComposioProvider();
  } catch {
    return;
  }
  // Disconnect may have already removed the account from config; in that
  // case the cache entry is keyed by an account id we no longer know. The
  // entry will age out within the token's TTL (or the next disconnect of
  // a sibling connector will wipe the whole cache). Best-effort here.
  const accountId = provider.getActiveConnectedAccountId(connectorId);
  if (accountId) clearCachedAccessToken(accountId);
}
