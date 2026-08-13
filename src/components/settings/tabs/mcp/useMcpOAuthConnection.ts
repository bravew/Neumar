import { useEffect, useRef, useState } from 'react';

import { API_BASE_URL } from '../../constants';
import type { MCPServerUI } from '../../types';

const MCP_OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

interface UseMcpOAuthConnectionOptions {
  labels: {
    error: string;
    pollError: string;
    timedOut: string;
  };
  onComplete: () => void;
}

export function useMcpOAuthConnection({
  labels,
  onComplete,
}: UseMcpOAuthConnectionOptions) {
  const [connectingServer, setConnectingServer] = useState<string | null>(null);
  const [oauthErrors, setOauthErrors] = useState<Record<string, string>>({});
  const oauthPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const oauthAbortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      if (oauthPollRef.current) clearInterval(oauthPollRef.current);
      oauthAbortRef.current?.abort();
    },
    [],
  );

  const dismissOAuthError = (serverName: string) => {
    setOauthErrors((prev) => {
      const next = { ...prev };
      delete next[serverName];
      return next;
    });
  };

  const connectOAuth = async (server: MCPServerUI) => {
    if (!server.url) return;

    if (oauthPollRef.current) {
      clearInterval(oauthPollRef.current);
      oauthPollRef.current = null;
    }
    oauthAbortRef.current?.abort();
    oauthAbortRef.current = null;

    setConnectingServer(server.name);
    dismissOAuthError(server.name);

    try {
      const res = await fetch(`${API_BASE_URL}/mcp/oauth/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId: server.name }),
      });
      const data = await res.json();

      if (!res.ok || data.success === false) {
        setOauthErrors((prev) => ({
          ...prev,
          [server.name]: data.error || labels.error,
        }));
        setConnectingServer(null);
        return;
      }

      const authUrl = data.authUrl ?? data.authorizeUrl;
      if (!authUrl || !data.state) {
        setOauthErrors((prev) => ({ ...prev, [server.name]: labels.error }));
        setConnectingServer(null);
        return;
      }

      try {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl(authUrl);
      } catch {
        window.open(authUrl, '_blank');
      }

      const { state } = data as { state: string };
      const startedAt = Date.now();
      oauthPollRef.current = setInterval(async () => {
        if (Date.now() - startedAt > MCP_OAUTH_TIMEOUT_MS) {
          clearInterval(oauthPollRef.current!);
          oauthPollRef.current = null;
          setConnectingServer(null);
          setOauthErrors((prev) => ({
            ...prev,
            [server.name]: labels.timedOut,
          }));
          return;
        }

        oauthAbortRef.current?.abort();
        const ac = new AbortController();
        oauthAbortRef.current = ac;
        try {
          const statusRes = await fetch(
            `${API_BASE_URL}/mcp/oauth/status/${state}`,
            { signal: ac.signal },
          );
          const statusData = await statusRes.json();

          if (statusData.status === 'complete') {
            clearInterval(oauthPollRef.current!);
            oauthPollRef.current = null;
            setConnectingServer(null);
            dismissOAuthError(server.name);
            onComplete();
          } else if (
            statusData.status === 'error' ||
            statusData.status === 'not_found'
          ) {
            clearInterval(oauthPollRef.current!);
            oauthPollRef.current = null;
            setConnectingServer(null);
            setOauthErrors((prev) => ({
              ...prev,
              [server.name]: statusData.error || labels.error,
            }));
          }
        } catch (err) {
          if ((err as Error).name === 'AbortError') return;
          setOauthErrors((prev) => ({
            ...prev,
            [server.name]: labels.pollError,
          }));
        }
      }, 2000);
    } catch (err) {
      setOauthErrors((prev) => ({
        ...prev,
        [server.name]: err instanceof Error ? err.message : labels.error,
      }));
      setConnectingServer(null);
    }
  };

  return {
    connectingServer,
    connectOAuth,
    dismissOAuthError,
    oauthErrors,
  };
}
