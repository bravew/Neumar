/**
 * Hook to fetch and cache configured MCP servers from the backend.
 * Used by the ChatInput MCP selector to show available servers.
 */

import { useEffect, useRef, useState } from 'react';

import { API_BASE_URL } from '@/config';

export interface McpServerInfo {
  name: string;
  type: 'stdio' | 'http' | 'sse';
  source: 'app' | 'claude';
  icon?: string;
}

// Module-level cache to avoid refetching on every mount
let cachedServers: McpServerInfo[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 30_000; // 30 seconds

/** Preset icon map — matches known server names to their icons. */
const PRESET_ICONS: Record<string, string> = {
  Notion: '/mcp-icons/notion.svg',
  Figma: '/mcp-icons/figma.svg',
  Granola: '/mcp-icons/granola.svg',
  Slack: '/mcp-icons/slack.svg',
  github: '/mcp-icons/github.svg',
  context7: '/mcp-icons/context7.png',
  filesystem: '/mcp-icons/filesystem.svg',
  playwright: '/mcp-icons/playwright.svg',
};

export function useMcpServers() {
  const [servers, setServers] = useState<McpServerInfo[]>(cachedServers ?? []);
  const [loading, setLoading] = useState(cachedServers === null);
  const [fetchKey, setFetchKey] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    // Return cached if fresh
    if (cachedServers && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
      setServers(cachedServers);
      setLoading(false);
      return;
    }

    const ac = new AbortController();

    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/mcp/all-configs`, {
          signal: ac.signal,
        });
        const data = await res.json();
        if (!data.success || !mountedRef.current) return;

        const list: McpServerInfo[] = [];
        for (const configInfo of data.configs as {
          name: string;
          exists: boolean;
          servers: Record<
            string,
            { command?: string; url?: string; type?: string }
          >;
        }[]) {
          if (!configInfo.exists) continue;
          for (const [id, cfg] of Object.entries(configInfo.servers)) {
            const hasUrl = 'url' in cfg && !!cfg.url;
            let serverType: 'stdio' | 'http' | 'sse' = 'stdio';
            if (hasUrl) serverType = (cfg.type as 'http' | 'sse') || 'http';

            list.push({
              name: id,
              type: serverType,
              source: configInfo.name as 'app' | 'claude',
              icon: PRESET_ICONS[id],
            });
          }
        }

        cachedServers = list;
        cacheTimestamp = Date.now();
        if (mountedRef.current) {
          setServers(list);
          setLoading(false);
        }
      } catch {
        if (mountedRef.current) setLoading(false);
      }
    })();

    return () => {
      mountedRef.current = false;
      ac.abort();
    };
  }, [fetchKey]);

  /** Force refresh the cache and re-fetch immediately. */
  const refresh = () => {
    cachedServers = null;
    cacheTimestamp = 0;
    setFetchKey((k) => k + 1);
  };

  return { servers, loading, refresh };
}

/** Invalidate the module-level cache from outside the hook. */
export function invalidateMcpCache() {
  cachedServers = null;
  cacheTimestamp = 0;
}
