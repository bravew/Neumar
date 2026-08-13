/**
 * Auth Hook
 *
 * Provides authentication state and actions for the OAuth integration system.
 * Polls the backend /auth/status endpoint and provides methods to initiate
 * OAuth flows, disconnect providers, and check connection status.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { toast } from 'sonner';

import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';

// Re-export types for consumers
export type OAuthProvider =
  | 'google'
  | 'slack'
  | 'notion'
  | 'box'
  | 'dropbox'
  | 'onedrive'
  | 'site';
export type ConnectionStatus = 'active' | 'expired' | 'revoked' | 'error';

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
}

export interface AuthState {
  loading: boolean;
  authenticated: boolean;
  connections: OAuthConnection[];
  availableProviders: OAuthProvider[];
  error: string | null;
}

export interface AuthActions {
  /** Initiate OAuth flow for a provider (opens system browser) */
  connect: (
    provider: OAuthProvider,
    additionalScopes?: string[],
  ) => Promise<void>;
  /** Disconnect and revoke tokens for a provider */
  disconnect: (provider: OAuthProvider) => Promise<void>;
  /** Request additional scopes for an existing connection */
  requestScopes: (provider: OAuthProvider, scopes: string[]) => Promise<void>;
  /** Force refresh the auth status from the backend */
  refresh: () => Promise<void>;
  /** Get connection for a specific provider */
  getConnection: (provider: OAuthProvider) => OAuthConnection | null;
  /** Check if a provider is connected */
  isConnected: (provider: OAuthProvider) => boolean;
  /** Initiate site login flow (opens site login page in browser) */
  siteLogin: () => Promise<void>;
  /** Log out from the site session */
  siteLogout: () => Promise<void>;
}

// Polling interval for auth status (check every 3 seconds during active flows)
const ACTIVE_POLL_INTERVAL = 3_000;
const IDLE_POLL_INTERVAL = 60_000;

export function useAuth(): AuthState & AuthActions {
  const [state, setState] = useState<AuthState>({
    loading: true,
    authenticated: false,
    connections: [],
    availableProviders: [],
    error: null,
  });

  // Track if there's an active OAuth flow (for faster polling)
  const [activeFlow, setActiveFlow] = useState(false);

  // i18n — use a ref so the fetchStatus callback always reads the latest
  // translations without needing `t` in its dependency array.
  const { t } = useLanguage();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  // Keep a stable ref to the current connections so connect/requestScopes
  // (which have empty dep arrays) can read the latest value without
  // being recreated on every poll.
  const connectionsRef = useRef<OAuthConnection[]>([]);
  useEffect(() => {
    connectionsRef.current = state.connections;
  }, [state.connections]);

  // Scope counts captured just before each OAuth flow starts. Used to
  // detect when the backend actually confirms new scopes so we can stop
  // fast-polling at the right time instead of reverting to the idle
  // interval as soon as any connection is present.
  const preFlowScopeCountsRef = useRef<Record<string, number>>({});

  // Track previous auth state for sign-in/sign-out toast notifications.
  // null = initial load (no toast), boolean = subsequent transitions.
  const prevAuthRef = useRef<boolean | null>(null);

  // AbortController ref for cancelling in-flight fetches on unmount
  const abortRef = useRef<AbortController | null>(null);

  const fetchStatus = useCallback(async () => {
    // Abort any previous in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${API_BASE_URL}/auth/status`, {
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      const isNowAuth = data.authenticated ?? false;

      setState((prev) => ({
        ...prev,
        loading: false,
        authenticated: isNowAuth,
        connections: data.connections ?? [],
        availableProviders: data.availableProviders ?? [],
        error: null,
      }));

      // Show toast on auth state transitions (skip the initial load)
      if (prevAuthRef.current !== null && prevAuthRef.current !== isNowAuth) {
        const locale = tRef.current;
        if (isNowAuth) {
          const siteConn = (data.connections ?? []).find(
            (c: OAuthConnection) => c.provider === 'site',
          );
          const who = siteConn?.displayName || siteConn?.accountEmail || '';
          toast.success(
            who
              ? locale.settings.signedInAs.replace('{who}', who)
              : locale.settings.signedIn,
          );
        } else {
          toast.info(locale.settings.signedOut);
        }
      }
      prevAuthRef.current = isNowAuth;

      // Stop fast polling only when the connection state has actually
      // changed relative to what it was before the OAuth flow started.
      // This prevents the previous behaviour where polling immediately
      // reverted to the 60-second idle interval on the first poll after
      // requestScopes() was called (because a Google connection already
      // existed), leaving stale scope data for up to a minute.
      if (activeFlow) {
        const preFlow = preFlowScopeCountsRef.current;
        const connections: OAuthConnection[] = data.connections ?? [];
        const hasNewConnection = connections.some(
          (c) => preFlow[c.provider] === undefined,
        );
        const hasScopeChange = connections.some(
          (c) =>
            preFlow[c.provider] !== undefined &&
            c.scopes.length !== preFlow[c.provider],
        );
        if (hasNewConnection || hasScopeChange) {
          setActiveFlow(false);
          preFlowScopeCountsRef.current = {};
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setState((prev) => ({
        ...prev,
        loading: false,
        error:
          err instanceof Error ? err.message : 'Failed to check auth status',
      }));
    }
  }, [activeFlow]);

  // Initial fetch + polling
  useEffect(() => {
    fetchStatus();

    const interval = setInterval(
      fetchStatus,
      activeFlow ? ACTIVE_POLL_INTERVAL : IDLE_POLL_INTERVAL,
    );
    return () => {
      clearInterval(interval);
      abortRef.current?.abort();
    };
  }, [fetchStatus, activeFlow]);

  const connect = useCallback(
    async (provider: OAuthProvider, additionalScopes?: string[]) => {
      try {
        const body: Record<string, unknown> = {};
        if (additionalScopes) body.scopes = additionalScopes;

        const res = await fetch(`${API_BASE_URL}/auth/${provider}/initiate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || `Failed to initiate ${provider} auth`);
        }

        const data = await res.json();

        // Open the auth URL in the system browser
        try {
          const { openUrl } = await import('@tauri-apps/plugin-opener');
          await openUrl(data.authUrl);
        } catch {
          // Fallback to window.open for browser mode
          window.open(data.authUrl, '_blank');
        }

        // Capture pre-flow scope counts so fetchStatus can detect real changes
        preFlowScopeCountsRef.current = connectionsRef.current.reduce<
          Record<string, number>
        >((acc, c) => {
          acc[c.provider] = c.scopes.length;
          return acc;
        }, {});

        // Start fast polling to detect when the flow completes
        setActiveFlow(true);
      } catch (err) {
        setState((prev) => ({
          ...prev,
          error: err instanceof Error ? err.message : 'Connection failed',
        }));
        throw err;
      }
    },
    [],
  );

  const disconnect = useCallback(async (provider: OAuthProvider) => {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/connections/${provider}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        throw new Error(`Failed to disconnect ${provider}`);
      }

      // Remove from local state immediately
      setState((prev) => ({
        ...prev,
        connections: prev.connections.filter((c) => c.provider !== provider),
        authenticated:
          provider === 'site'
            ? false
            : prev.connections.some(
                (c) => c.provider === 'site' && c.status === 'active',
              ),
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Disconnect failed',
      }));
      throw err;
    }
  }, []);

  const siteLogin = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/site/login`, {
        method: 'POST',
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to initiate site login');
      }

      const data = await res.json();

      // Open the site login URL in the system browser
      try {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl(data.authUrl);
      } catch {
        window.open(data.authUrl, '_blank');
      }

      // Capture pre-flow scope counts for polling detection
      preFlowScopeCountsRef.current = connectionsRef.current.reduce<
        Record<string, number>
      >((acc, c) => {
        acc[c.provider] = c.scopes.length;
        return acc;
      }, {});

      setActiveFlow(true);
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Site login failed',
      }));
      throw err;
    }
  }, []);

  const siteLogout = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/site/logout`, {
        method: 'POST',
      });

      if (!res.ok) {
        throw new Error('Failed to logout');
      }

      setState((prev) => ({
        ...prev,
        connections: prev.connections.filter((c) => c.provider !== 'site'),
        authenticated: false,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Logout failed',
      }));
      throw err;
    }
  }, []);

  const requestScopes = useCallback(
    async (provider: OAuthProvider, scopes: string[]) => {
      try {
        const res = await fetch(`${API_BASE_URL}/auth/${provider}/scopes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scopes }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to request scopes');
        }

        const data = await res.json();

        try {
          const { openUrl } = await import('@tauri-apps/plugin-opener');
          await openUrl(data.authUrl);
        } catch {
          window.open(data.authUrl, '_blank');
        }

        // Capture pre-flow scope counts so fetchStatus can detect real changes
        preFlowScopeCountsRef.current = connectionsRef.current.reduce<
          Record<string, number>
        >((acc, c) => {
          acc[c.provider] = c.scopes.length;
          return acc;
        }, {});

        setActiveFlow(true);
      } catch (err) {
        setState((prev) => ({
          ...prev,
          error: err instanceof Error ? err.message : 'Scope request failed',
        }));
        throw err;
      }
    },
    [],
  );

  const getConnection = useCallback(
    (provider: OAuthProvider): OAuthConnection | null => {
      return state.connections.find((c) => c.provider === provider) ?? null;
    },
    [state.connections],
  );

  const isConnected = useCallback(
    (provider: OAuthProvider): boolean => {
      return state.connections.some(
        (c) => c.provider === provider && c.status === 'active',
      );
    },
    [state.connections],
  );

  return {
    ...state,
    connect,
    disconnect,
    requestScopes,
    refresh: fetchStatus,
    getConnection,
    isConnected,
    siteLogin,
    siteLogout,
  };
}
