/**
 * Plugin fetcher hooks.
 *
 * Backed by the desktop API's `/plugins`, `/plugins/discovered`, and
 * `/plugins/marketplace/index` endpoints. Every fetch uses an
 * AbortController scoped to the effect / call so component unmounts
 * (and React 19 StrictMode double-mount) cannot trigger
 * setState-after-unmount warnings.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { API_BASE_URL } from '@/config';

// ---------------------------------------------------------------------------
// Types — mirror the API's JSON shape (kept loose; the canonical types live
// in src-api/src/shared/db/plugins.ts and shared/plugins/manifest.ts).
// ---------------------------------------------------------------------------

export type PluginScope =
  | 'project'
  | 'user'
  | 'marketplace'
  | 'bundled'
  | 'legacy';

export type PluginSource = 'github' | 'url' | 'local' | 'bundled';

export interface PluginManifestLike {
  name: string;
  version: string;
  description: string;
  displayName?: string;
  author?: string | { name: string; email?: string; url?: string };
  homepage?: string;
  repository?: string | { type: string; url: string };
  license?: string;
  keywords?: string[];
  metadata?: {
    neuma?: {
      minHostVersion?: string;
      surfaces?: string[];
      /** Points at the design-plugin manifest — present on design systems. */
      designManifest?: string;
      capabilitiesSummary?: string[];
      /** Example prompt seeded into the composer when applied via "Use". */
      exampleQuery?: string;
      /** Concrete refs the plugin pulls in at apply time. */
      contextBundles?: {
        skills?: string[];
        assets?: string[];
        mcpServers?: string[];
        designSystems?: string[];
      };
      /** Raw Open Design classifiers. */
      openDesign?: {
        kind?: string;
        taskKind?: string;
        mode?: string;
        scenario?: string;
        platform?: string;
      };
      requires?: { anyBins?: string[]; envVars?: string[] };
      signature?: { algorithm: string; publicKeyId: string; signature: string };
      configSchema?: Array<{
        key: string;
        type: 'string' | 'number' | 'boolean' | 'secret' | 'enum';
        label?: string;
        help?: string;
        sensitive?: boolean;
        advanced?: boolean;
        order?: number;
        required?: boolean;
        default?: string | number | boolean;
        options?: Array<{
          label: string;
          value: string | number | boolean;
        }>;
        uiHints?: Record<string, unknown>;
      }>;
    };
    [k: string]: unknown;
  };
}

export interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  source: PluginSource;
  sourceRef: string | null;
  installPath: string;
  scope: PluginScope;
  enabled: boolean;
  manifest: PluginManifestLike | null;
  sha256: string | null;
  signatureOk: boolean | null;
  /** Marketplace provenance (null for local / pre-provenance installs). */
  sourceMarketplaceId?: string | null;
  sourceEntryName?: string | null;
  sourceEntryVersion?: string | null;
  marketplaceTrust?: 'official' | 'restricted' | null;
  installedAt: string;
  updatedAt: string;
}

export interface DiscoveredPlugin {
  name: string;
  version: string;
  description: string;
  scope: PluginScope;
  path: string;
  skillCount: number;
  skills: { name: string; bareName: string; path: string }[];
}

export type PluginConfigPrimitive = string | number | boolean;

export type PluginConfigPatchValue = PluginConfigPrimitive | null;

export interface PublicPluginConfigValue {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'secret' | 'enum';
  label?: string;
  help?: string;
  sensitive: boolean;
  advanced: boolean;
  required: boolean;
  order?: number;
  defaultValue?: PluginConfigPrimitive;
  options?: Array<{
    label: string;
    value: PluginConfigPrimitive;
  }>;
  value?: PluginConfigPrimitive;
  hasValue: boolean;
  hasSecret: boolean;
  secretHint?: string;
}

export interface PluginConfigResponse {
  pluginId: string;
  values: PublicPluginConfigValue[];
}

// ---------------------------------------------------------------------------
// useInstalledPlugins
// ---------------------------------------------------------------------------

export interface UseInstalledPluginsResult {
  plugins: InstalledPlugin[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  /** Patch one plugin in place (e.g. after enable/disable) without refetching. */
  applyPluginUpdate: (plugin: InstalledPlugin) => void;
  /** Drop one plugin from the list in place (e.g. after uninstall). */
  removePlugin: (id: string) => void;
}

export function useInstalledPlugins(): UseInstalledPluginsResult {
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const ac = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/plugins`, {
          signal: ac.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { plugins: InstalledPlugin[] };
        if (!cancelled) setPlugins(data.plugins ?? []);
      } catch (err) {
        if (cancelled || ac.signal.aborted) return;
        setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [tick]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);
  const applyPluginUpdate = useCallback((updated: InstalledPlugin) => {
    setPlugins((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  }, []);
  const removePlugin = useCallback((id: string) => {
    setPlugins((prev) => prev.filter((p) => p.id !== id));
  }, []);
  return { plugins, loading, error, refresh, applyPluginUpdate, removePlugin };
}

// ---------------------------------------------------------------------------
// useDiscoveredPlugins — full disk scan (used by Marketplace tab while the
// real registry endpoint is a 501 stub)
// ---------------------------------------------------------------------------

export interface UseDiscoveredPluginsResult {
  plugins: DiscoveredPlugin[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useDiscoveredPlugins(): UseDiscoveredPluginsResult {
  const [plugins, setPlugins] = useState<DiscoveredPlugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const ac = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/plugins/discovered`, {
          signal: ac.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { plugins: DiscoveredPlugin[] };
        if (!cancelled) setPlugins(data.plugins ?? []);
      } catch (err) {
        if (cancelled || ac.signal.aborted) return;
        setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [tick]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);
  return { plugins, loading, error, refresh };
}

// ---------------------------------------------------------------------------
// usePluginConfig — installed-plugin configuration values
// ---------------------------------------------------------------------------

export interface UsePluginConfigResult {
  config: PluginConfigResponse | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  refresh: () => void;
  saveConfig: (
    values: Record<string, PluginConfigPatchValue>,
  ) => Promise<PluginConfigResponse>;
}

export function usePluginConfig(
  pluginId: string | null | undefined,
  enabled = true,
): UsePluginConfigResult {
  const [config, setConfig] = useState<PluginConfigResponse | null>(null);
  const [loading, setLoading] = useState(Boolean(pluginId && enabled));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const inflightRef = useRef<Set<AbortController>>(new Set());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const inflight = inflightRef.current;
    return () => {
      mountedRef.current = false;
      for (const ac of inflight) ac.abort();
      inflight.clear();
    };
  }, []);

  useEffect(() => {
    if (!pluginId || !enabled) {
      setConfig(null);
      setLoading(false);
      setError(null);
      return;
    }

    const ac = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE_URL}/plugins/${encodeURIComponent(pluginId)}/config`,
          { signal: ac.signal },
        );
        const text = await res.text();
        const data = text ? JSON.parse(text) : {};
        if (!res.ok) {
          const msg =
            (data && (data.error || data.message)) || `HTTP ${res.status}`;
          throw new Error(msg);
        }
        if (!cancelled) {
          setConfig((data as { config: PluginConfigResponse }).config);
        }
      } catch (err) {
        if (cancelled || ac.signal.aborted) return;
        setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [enabled, pluginId, tick]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  const saveConfig = useCallback(
    async (values: Record<string, PluginConfigPatchValue>) => {
      if (!pluginId) throw new Error('missing plugin id');
      const ac = new AbortController();
      inflightRef.current.add(ac);
      setSaving(true);
      setError(null);
      try {
        const res = await fetch(
          `${API_BASE_URL}/plugins/${encodeURIComponent(pluginId)}/config`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ values }),
            signal: ac.signal,
          },
        );
        const text = await res.text();
        const data = text ? JSON.parse(text) : {};
        if (!res.ok) {
          const msg =
            (data && (data.error || data.message)) || `HTTP ${res.status}`;
          throw new Error(msg);
        }
        const nextConfig = (data as { config: PluginConfigResponse }).config;
        if (mountedRef.current) setConfig(nextConfig);
        return nextConfig;
      } catch (err) {
        if (!ac.signal.aborted && mountedRef.current) {
          setError((err as Error).message);
        }
        throw err;
      } finally {
        inflightRef.current.delete(ac);
        if (inflightRef.current.size === 0 && mountedRef.current) {
          setSaving(false);
        }
      }
    },
    [pluginId],
  );

  return { config, loading, saving, error, refresh, saveConfig };
}

// ---------------------------------------------------------------------------
// usePluginActions — install / enable / disable / uninstall
// ---------------------------------------------------------------------------

export interface InstallLocalArgs {
  source: 'local';
  ref: string;
  scope?: 'user' | 'project';
}

export interface InstallNetworkArgs {
  source: 'github' | 'url';
  ref: string;
  scope?: 'user' | 'project';
  /** Marketplace provenance: which source/entry drove this install. */
  marketplaceSourceId?: string;
  entryName?: string;
}

/**
 * Install a catalog entry by (source, entry) — the backend resolves the
 * entry's advertised install source and stamps provenance.
 */
export interface InstallMarketplaceArgs {
  source: 'marketplace';
  marketplaceSourceId: string;
  entryName: string;
  scope?: 'user' | 'project';
}

export type InstallArgs =
  | InstallLocalArgs
  | InstallMarketplaceArgs
  | InstallNetworkArgs;

export interface UsePluginActionsResult {
  installPlugin: (args: InstallArgs) => Promise<InstalledPlugin>;
  enablePlugin: (id: string) => Promise<InstalledPlugin>;
  disablePlugin: (id: string) => Promise<InstalledPlugin>;
  uninstallPlugin: (id: string) => Promise<void>;
  pending: boolean;
  error: string | null;
}

export function usePluginActions(): UsePluginActionsResult {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflightRef = useRef<Set<AbortController>>(new Set());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const inflight = inflightRef.current;
    return () => {
      mountedRef.current = false;
      for (const ac of inflight) ac.abort();
      inflight.clear();
    };
  }, []);

  const run = useCallback(
    async <T>(
      url: string,
      init: RequestInit,
      okStatuses: number[] = [200, 201],
    ): Promise<T> => {
      const ac = new AbortController();
      inflightRef.current.add(ac);
      setPending(true);
      setError(null);
      try {
        const res = await fetch(url, { ...init, signal: ac.signal });
        const text = await res.text();
        const data = text ? JSON.parse(text) : {};
        if (!okStatuses.includes(res.status)) {
          const msg =
            (data && (data.error || data.message)) || `HTTP ${res.status}`;
          throw new Error(msg);
        }
        return data as T;
      } catch (err) {
        if (!ac.signal.aborted && mountedRef.current) {
          setError((err as Error).message);
        }
        throw err;
      } finally {
        inflightRef.current.delete(ac);
        if (inflightRef.current.size === 0 && mountedRef.current) {
          setPending(false);
        }
      }
    },
    [],
  );

  const installPlugin = useCallback(
    async (args: InstallArgs) => {
      const data = await run<{ plugin: InstalledPlugin }>(
        `${API_BASE_URL}/plugins/install`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(args),
        },
        [200, 201],
      );
      return data.plugin;
    },
    [run],
  );

  const enablePlugin = useCallback(
    async (id: string) => {
      const data = await run<{ plugin: InstalledPlugin }>(
        `${API_BASE_URL}/plugins/${encodeURIComponent(id)}/enable`,
        { method: 'POST' },
      );
      return data.plugin;
    },
    [run],
  );

  const disablePlugin = useCallback(
    async (id: string) => {
      const data = await run<{ plugin: InstalledPlugin }>(
        `${API_BASE_URL}/plugins/${encodeURIComponent(id)}/disable`,
        { method: 'POST' },
      );
      return data.plugin;
    },
    [run],
  );

  const uninstallPlugin = useCallback(
    async (id: string) => {
      await run<unknown>(`${API_BASE_URL}/plugins/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
    },
    [run],
  );

  return {
    installPlugin,
    enablePlugin,
    disablePlugin,
    uninstallPlugin,
    pending,
    error,
  };
}
