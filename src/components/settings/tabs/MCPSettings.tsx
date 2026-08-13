import { useEffect, useState } from 'react';

import { ChevronDown, FileJson, Plus, Search, Settings2 } from 'lucide-react';

import { AILoadingIndicator } from '@/components/ui/AILoadingIndicator';
import { getAppMcpPath } from '@/shared/lib/paths';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';
import { randomUUID } from '@/shared/utils/uuid';

import { Switch } from '../components/Switch';
import { API_BASE_URL } from '../constants';
import type {
  MCPConfig,
  MCPServerStdio,
  MCPServerUI,
  SettingsTabProps,
} from '../types';
import { ConfigDialog } from './mcp/ConfigDialog';
import { initialConfigDialog, MCP_PRESETS } from './mcp/constants';
import { ImportDialog } from './mcp/ImportDialog';
import { MCPCard } from './mcp/MCPCard';
import { McpJsonHelper } from './mcp/McpJsonHelper';
import { PresetCard } from './mcp/PresetCard';
import type { ConfigDialogState, KeyValuePair } from './mcp/types';
import { useMcpOAuthConnection } from './mcp/useMcpOAuthConnection';

type MainTab = 'installed' | 'presets' | 'settings';

export function MCPSettings({ settings, onSettingsChange }: SettingsTabProps) {
  const [servers, setServers] = useState<MCPServerUI[]>([]);
  const [mainTab, setMainTab] = useState<MainTab>('installed');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [presetSearchQuery, setPresetSearchQuery] = useState('');
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [mcpDirs, setMcpDirs] = useState<{ user: string; app: string }>({
    user: '',
    app: '',
  });
  const [defaultMcpPath, setDefaultMcpPath] = useState('');

  // Load default MCP path on mount (platform-aware)
  useEffect(() => {
    let cancelled = false;
    getAppMcpPath().then((path) => {
      if (!cancelled) setDefaultMcpPath(path);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Import by JSON dialog
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importJson, setImportJson] = useState('');

  // Config dialog (for both add and edit)
  const [configDialog, setConfigDialog] =
    useState<ConfigDialogState>(initialConfigDialog);

  const { t } = useLanguage();
  // Incremented to force the load useEffect to re-run (e.g. after OAuth completes)
  const [configLoadKey, setConfigLoadKey] = useState(0);
  const { connectingServer, connectOAuth, dismissOAuthError, oauthErrors } =
    useMcpOAuthConnection({
      labels: {
        error: t.settings.mcpOAuthError,
        pollError: t.settings.mcpOAuthPollError,
        timedOut: t.settings.mcpOAuthTimedOut,
      },
      onComplete: () => setConfigLoadKey((k) => k + 1),
    });

  // Filter and sort servers
  const filteredServers = servers
    .filter((server) => {
      if (
        searchQuery &&
        !server.name.toLowerCase().includes(searchQuery.toLowerCase())
      ) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      const aConfigured = a.type === 'stdio' ? !!a.command : !!a.url;
      const bConfigured = b.type === 'stdio' ? !!b.command : !!b.url;
      if (aConfigured && !bConfigured) return -1;
      if (bConfigured && !aConfigured) return 1;
      return 0;
    });

  // Load MCP config from all sources
  useEffect(() => {
    const abortController = new AbortController();

    async function loadMCPConfig() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`${API_BASE_URL}/mcp/all-configs`, {
          signal: abortController.signal,
        });
        const result = await response.json();

        if (!result.success) {
          throw new Error(result.error || 'Failed to load config');
        }

        const serverList: MCPServerUI[] = [];
        const dirs: { user: string; app: string } = { user: '', app: '' };

        for (const configInfo of result.configs as {
          name: string;
          path: string;
          exists: boolean;
          servers: Record<
            string,
            MCPServerStdio | { url: string; headers?: Record<string, string> }
          >;
        }[]) {
          if (configInfo.name === 'claude') {
            dirs.user = configInfo.path;
          } else if (configInfo.name === 'app') {
            dirs.app = configInfo.path;
          }

          if (!configInfo.exists) continue;

          for (const [id, serverConfig] of Object.entries(configInfo.servers)) {
            const hasUrl = 'url' in serverConfig;
            const cfg = serverConfig as {
              type?: 'http' | 'sse';
              url?: string;
              headers?: Record<string, string>;
              auth?: MCPServerUI['auth'];
              oauth?: MCPServerUI['oauth'];
              env?: Record<string, string>;
            };
            // Determine type: use explicit type if provided, otherwise default based on config
            let serverType: 'stdio' | 'http' | 'sse' = 'stdio';
            if (hasUrl) {
              serverType = cfg.type || 'http';
            }
            serverList.push({
              id: `${configInfo.name}-${id}`,
              name: id,
              type: serverType,
              enabled: true,
              command: hasUrl
                ? undefined
                : (serverConfig as MCPServerStdio).command,
              args: hasUrl ? undefined : (serverConfig as MCPServerStdio).args,
              env: hasUrl ? undefined : cfg.env,
              url: hasUrl ? cfg.url : undefined,
              headers: hasUrl ? cfg.headers : undefined,
              auth: hasUrl ? cfg.auth : undefined,
              oauth: hasUrl ? cfg.oauth : undefined,
              autoExecute: true,
              source: configInfo.name as 'app' | 'claude',
              requiresOAuth: hasUrl && cfg.auth?.type === 'oauth2.1',
            });
          }
        }

        // Re-annotate servers loaded from disk with preset metadata (requiresOAuth,
        // icon). These fields are UI-only and not persisted in mcp.json, so they
        // must be re-derived each time by matching against MCP_PRESETS by name.
        for (const server of serverList) {
          const preset = MCP_PRESETS.find((p) => p.name === server.name);
          if (preset?.requiresOAuth) server.requiresOAuth = true;
          if (preset?.icon && !server.icon) server.icon = preset.icon;
          if (preset?.advertisedToolCount) {
            server.advertisedToolCount = preset.advertisedToolCount;
            server.authorizedToolCount = server.oauth?.tokenStore
              ? preset.advertisedToolCount
              : 0;
          }
        }

        setMcpDirs(dirs);
        setServers(serverList);
      } catch (err) {
        if (abortController.signal.aborted) return;
        if (import.meta.env.DEV)
          console.error('[MCP] Failed to load MCP config:', err);
        setError(t.settings.mcpLoadError);
        setServers([]);
      } finally {
        setLoading(false);
      }
    }

    loadMCPConfig();
    return () => {
      abortController.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configLoadKey]); // configLoadKey allows forced reloads (e.g. after OAuth)

  // Save MCP config via API
  const saveMCPConfig = async (serverList: MCPServerUI[]) => {
    try {
      const mcpServers: Record<string, unknown> = {};
      for (const server of serverList) {
        if (server.source === 'claude') continue;
        if (server.type === 'http' || server.type === 'sse') {
          const serverConfig: Record<string, unknown> = {
            url: server.url || '',
          };
          // Only add type field for sse (http is default)
          if (server.type === 'sse') {
            serverConfig.type = 'sse';
          }
          if (server.headers && Object.keys(server.headers).length > 0) {
            serverConfig.headers = server.headers;
          }
          if (server.auth) {
            serverConfig.auth = server.auth;
          }
          if (server.oauth) {
            serverConfig.oauth = server.oauth;
          }
          mcpServers[server.name] = serverConfig;
        } else {
          const serverConfig: Record<string, unknown> = {
            command: server.command || '',
          };
          if (server.args && server.args.length > 0) {
            serverConfig.args = server.args;
          }
          if (server.env && Object.keys(server.env).length > 0) {
            serverConfig.env = server.env;
          }
          mcpServers[server.name] = serverConfig;
        }
      }

      const config: MCPConfig = {
        mcpServers: mcpServers as MCPConfig['mcpServers'],
      };

      const response = await fetch(`${API_BASE_URL}/mcp/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || 'Failed to save config');
      }
    } catch (err) {
      if (import.meta.env.DEV)
        console.error('[MCP] Failed to save MCP config:', err);
    }
  };

  // Open folder in system file manager
  const openFolderInSystem = async (folderPath: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/files/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: folderPath, expandHome: true }),
      });
      const data = await response.json();
      if (!data.success) {
        if (import.meta.env.DEV)
          console.error('[MCP] Failed to open folder:', data.error);
      }
    } catch (err) {
      if (import.meta.env.DEV)
        console.error('[MCP] Error opening folder:', err);
    }
  };

  // Handle import by JSON
  const handleImportJson = () => {
    try {
      const parsed = JSON.parse(importJson);
      const mcpServers = parsed.mcpServers || parsed;

      if (!mcpServers || typeof mcpServers !== 'object') {
        if (import.meta.env.DEV) console.error('[MCP] Invalid JSON format');
        return;
      }

      const newServers: MCPServerUI[] = [...servers];

      for (const [name, config] of Object.entries(mcpServers)) {
        const cfg = config as Record<string, unknown>;
        const existingIndex = newServers.findIndex(
          (s) => s.name === name && s.source === 'app',
        );

        // Determine type: use explicit type if provided, otherwise default based on config
        let serverType: 'stdio' | 'http' | 'sse' = 'stdio';
        if (cfg.url) {
          serverType = (cfg.type as 'http' | 'sse') || 'http';
        }

        const serverData: MCPServerUI = {
          id: `app-${name}`,
          name,
          type: serverType,
          enabled: true,
          command: cfg.command as string | undefined,
          args: cfg.args as string[] | undefined,
          env: cfg.env as Record<string, string> | undefined,
          url: cfg.url as string | undefined,
          headers: cfg.headers as Record<string, string> | undefined,
          auth: cfg.auth as MCPServerUI['auth'],
          oauth: cfg.oauth as MCPServerUI['oauth'],
          autoExecute: true,
          source: 'app',
          requiresOAuth:
            serverType !== 'stdio' &&
            (cfg.auth as { type?: string } | undefined)?.type === 'oauth2.1',
        };

        if (existingIndex >= 0) {
          newServers[existingIndex] = serverData;
        } else {
          newServers.push(serverData);
        }
      }

      setServers(newServers);
      saveMCPConfig(newServers);
      setShowImportDialog(false);
      setImportJson('');
    } catch (err) {
      if (import.meta.env.DEV)
        console.error('[MCP] Failed to parse JSON:', err);
    }
  };

  // Helper to convert object to KeyValuePair array
  const objectToKeyValuePairs = (
    obj: Record<string, string> | undefined,
  ): KeyValuePair[] => {
    if (!obj) return [];
    return Object.entries(obj).map(([key, value]) => ({
      id: `kv-${randomUUID()}`,
      key,
      value,
    }));
  };

  // Helper to convert KeyValuePair array to object
  const keyValuePairsToObject = (
    pairs: KeyValuePair[],
  ): Record<string, string> => {
    const obj: Record<string, string> = {};
    for (const pair of pairs) {
      if (pair.key.trim()) {
        obj[pair.key] = pair.value;
      }
    }
    return obj;
  };

  // Handle configure server (open config dialog for editing)
  const handleConfigureServer = (server: MCPServerUI) => {
    setConfigDialog({
      open: true,
      mode: 'edit',
      serverName: server.name,
      transportType: server.type,
      command: server.command || '',
      args: server.args || [],
      env: objectToKeyValuePairs(server.env),
      url: server.url || '',
      headers: objectToKeyValuePairs(server.headers),
      editServerId: server.id,
    });
  };

  // Handle save config dialog
  const handleSaveConfigDialog = () => {
    if (!configDialog.serverName) return;

    const newServers = [...servers];
    const headersObj = keyValuePairsToObject(configDialog.headers);
    const envObj = keyValuePairsToObject(configDialog.env);
    const hasHeaders = Object.keys(headersObj).length > 0;
    const hasEnv = Object.keys(envObj).length > 0;

    const isUrlType = configDialog.transportType !== 'stdio';

    if (configDialog.mode === 'edit' && configDialog.editServerId) {
      const index = newServers.findIndex(
        (s) => s.id === configDialog.editServerId,
      );
      if (index >= 0) {
        const existing = newServers[index];
        newServers[index] = {
          ...existing,
          name: configDialog.serverName,
          type: configDialog.transportType,
          command:
            configDialog.transportType === 'stdio'
              ? configDialog.command
              : undefined,
          args:
            configDialog.transportType === 'stdio'
              ? configDialog.args
              : undefined,
          env:
            configDialog.transportType === 'stdio' && hasEnv
              ? envObj
              : undefined,
          url: isUrlType ? configDialog.url : undefined,
          headers: isUrlType && hasHeaders ? headersObj : undefined,
          auth: isUrlType ? existing.auth : undefined,
          oauth: isUrlType ? existing.oauth : undefined,
          requiresOAuth: isUrlType ? existing.requiresOAuth : undefined,
        };
      }
    } else {
      const fullId = `app-${configDialog.serverName}`;
      if (
        newServers.some(
          (s) => s.id === fullId || s.name === configDialog.serverName,
        )
      ) {
        if (import.meta.env.DEV)
          console.error('[MCP] Server name already exists');
        return;
      }

      newServers.push({
        id: fullId,
        name: configDialog.serverName,
        type: configDialog.transportType,
        enabled: true,
        command:
          configDialog.transportType === 'stdio'
            ? configDialog.command
            : undefined,
        args:
          configDialog.transportType === 'stdio'
            ? configDialog.args
            : undefined,
        env:
          configDialog.transportType === 'stdio' && hasEnv ? envObj : undefined,
        url: isUrlType ? configDialog.url : undefined,
        headers: isUrlType && hasHeaders ? headersObj : undefined,
        autoExecute: true,
        source: 'app',
      });
    }

    setServers(newServers);
    saveMCPConfig(newServers);
    setConfigDialog(initialConfigDialog);
  };

  // Handle delete server
  const handleDeleteServer = (serverId: string) => {
    const server = servers.find((s) => s.id === serverId);
    if (!server || server.source === 'claude') return;

    const newServers = servers.filter((s) => s.id !== serverId);
    setServers(newServers);
    saveMCPConfig(newServers);
  };

  // Preset helpers
  const isPresetInstalled = (preset: { name: string }) =>
    servers.some((s) => s.name === preset.name);

  const handleInstallPreset = (preset: {
    name: string;
    type: 'stdio' | 'http' | 'sse';
    command?: string;
    args?: string[];
    url?: string;
    requiresOAuth?: boolean;
    icon?: string;
    advertisedToolCount?: number;
  }) => {
    if (isPresetInstalled(preset)) return;

    const newServer: MCPServerUI = {
      id: `app-${preset.name}`,
      name: preset.name,
      type: preset.type,
      enabled: true,
      command: preset.command,
      args: preset.args,
      url: preset.url,
      autoExecute: true,
      source: 'app',
      requiresOAuth: preset.requiresOAuth,
      icon: preset.icon,
      advertisedToolCount: preset.advertisedToolCount,
      authorizedToolCount: 0,
    };

    const newServers = [...servers, newServer];
    setServers(newServers);
    saveMCPConfig(newServers);
  };

  const handleUninstallPreset = (preset: { name: string }) => {
    const newServers = servers.filter((s) => s.name !== preset.name);
    setServers(newServers);
    saveMCPConfig(newServers);
  };

  const handleApplyHelperServer = (server: MCPServerUI) => {
    if (
      servers.some(
        (existing) =>
          existing.name === server.name || existing.id === server.id,
      )
    ) {
      setError(t.settings.mcpServerExists);
      return;
    }
    const newServers = [...servers, server];
    setServers(newServers);
    saveMCPConfig(newServers);
    setMainTab('installed');
  };

  const filteredPresets = MCP_PRESETS.filter(
    (preset) =>
      !presetSearchQuery ||
      preset.name.toLowerCase().includes(presetSearchQuery.toLowerCase()) ||
      preset.description
        .toLowerCase()
        .includes(presetSearchQuery.toLowerCase()),
  );

  if (loading) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center gap-2">
        <AILoadingIndicator size="sm" />
        {t.common.loading}
      </div>
    );
  }

  return (
    <>
      <div className="-m-6 flex h-[calc(100%+48px)] flex-col">
        {/* Tab Bar */}
        <div className="border-border shrink-0 border-b px-6">
          <div className="flex items-center gap-6">
            <button
              onClick={() => setMainTab('installed')}
              className={cn(
                'relative py-4 text-sm font-medium transition-colors',
                mainTab === 'installed'
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              aria-label="Installed servers tab"
            >
              {t.settings.skillsInstalled}
              {mainTab === 'installed' && (
                <span className="bg-foreground absolute bottom-0 left-0 h-0.5 w-full" />
              )}
            </button>
            <button
              onClick={() => setMainTab('presets')}
              className={cn(
                'relative py-4 text-sm font-medium transition-colors',
                mainTab === 'presets'
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              aria-label="Presets tab"
            >
              {t.settings.mcpPresets}
              {mainTab === 'presets' && (
                <span className="bg-foreground absolute bottom-0 left-0 h-0.5 w-full" />
              )}
            </button>
            <button
              onClick={() => setMainTab('settings')}
              className={cn(
                'relative py-4 text-sm font-medium transition-colors',
                mainTab === 'settings'
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              aria-label="MCP settings tab"
            >
              {t.settings.title}
              {mainTab === 'settings' && (
                <span className="bg-foreground absolute bottom-0 left-0 h-0.5 w-full" />
              )}
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {mainTab === 'installed' ? (
            <div className="flex h-full flex-col">
              {/* Filter Bar */}
              <div className="bg-background sticky top-0 z-10 flex shrink-0 items-center justify-between gap-4 px-6 pt-6 pb-4">
                <div className="flex items-center gap-3">
                  {/* Search Input */}
                  <div className="relative">
                    <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={t.settings.mcpSearch}
                      className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-9 w-64 rounded-lg border py-2 pr-3 pl-9 text-sm focus:ring-2 focus:outline-none"
                      aria-label={t.settings.mcpSearch}
                    />
                  </div>
                </div>

                {/* Add Button with Dropdown */}
                <div className="relative">
                  <button
                    onClick={() => setShowAddMenu(!showAddMenu)}
                    className="bg-foreground text-background hover:bg-foreground/90 flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors"
                    aria-label={t.settings.add}
                  >
                    <Plus className="size-4" />
                    {t.settings.add}
                    <ChevronDown className="size-4" />
                  </button>
                  {showAddMenu && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setShowAddMenu(false)}
                      />
                      <div className="border-border bg-popover absolute top-full right-0 z-20 mt-1 min-w-[180px] rounded-xl border py-1 shadow-lg">
                        <button
                          onClick={() => {
                            setShowImportDialog(true);
                            setShowAddMenu(false);
                          }}
                          className="hover:bg-accent flex w-full items-center gap-3 px-3 py-2 text-left transition-colors"
                        >
                          <FileJson className="text-muted-foreground size-4 shrink-0" />
                          <span className="text-foreground text-sm">
                            {t.settings.mcpImportByJson}
                          </span>
                        </button>
                        <button
                          onClick={() => {
                            setConfigDialog({
                              ...initialConfigDialog,
                              open: true,
                            });
                            setShowAddMenu(false);
                          }}
                          className="hover:bg-accent flex w-full items-center gap-3 px-3 py-2 text-left transition-colors"
                        >
                          <Settings2 className="text-muted-foreground size-4 shrink-0" />
                          <span className="text-foreground text-sm">
                            {t.settings.mcpDirectConfig}
                          </span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* MCP Grid */}
              <div className="min-h-0 flex-1 overflow-y-auto p-6">
                {error ? (
                  <div className="flex h-32 items-center justify-center text-sm text-red-500">
                    {error}
                  </div>
                ) : filteredServers.length === 0 ? (
                  <div className="text-muted-foreground flex h-32 items-center justify-center text-sm">
                    {searchQuery
                      ? t.settings.mcpNoResults
                      : t.settings.mcpNoServers}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    {filteredServers.map((server) => (
                      <MCPCard
                        key={server.id}
                        server={server}
                        onConfigure={() => handleConfigureServer(server)}
                        onConnectOAuth={() => connectOAuth(server)}
                        onDelete={() => handleDeleteServer(server.id)}
                        onDismissAuthError={() =>
                          dismissOAuthError(server.name)
                        }
                        connecting={connectingServer === server.name}
                        authError={oauthErrors[server.name]}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : mainTab === 'presets' ? (
            /* Presets Tab Content */
            <div className="flex h-full flex-col">
              <div className="bg-background sticky top-0 z-10 shrink-0 px-6 pt-6 pb-4">
                <div className="relative">
                  <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                  <input
                    type="text"
                    value={presetSearchQuery}
                    onChange={(e) => setPresetSearchQuery(e.target.value)}
                    placeholder={t.settings.mcpPresetsSearch}
                    className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-9 w-64 rounded-lg border py-2 pr-3 pl-9 text-sm focus:ring-2 focus:outline-none"
                    aria-label={t.settings.mcpPresetsSearch}
                  />
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-6">
                {filteredPresets.length === 0 ? (
                  <div className="text-muted-foreground flex h-32 items-center justify-center text-sm">
                    {t.settings.mcpPresetsEmpty}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    {filteredPresets.map((preset) => (
                      <PresetCard
                        key={preset.id}
                        preset={preset}
                        isInstalled={isPresetInstalled(preset)}
                        onInstall={() => handleInstallPreset(preset)}
                        onUninstall={() => handleUninstallPreset(preset)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Settings Tab Content */
            <div className="space-y-4 p-6">
              <McpJsonHelper onApply={handleApplyHelperServer} />

              {/* Global Enable Switch */}
              <div className="border-border bg-background rounded-xl border p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-foreground text-sm font-medium">
                      {t.settings.mcpEnabled}
                    </h3>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {t.settings.mcpEnabledDescription}
                    </p>
                  </div>
                  <Switch
                    checked={settings.mcpEnabled !== false}
                    onChange={(checked) =>
                      onSettingsChange({ ...settings, mcpEnabled: checked })
                    }
                  />
                </div>
              </div>

              {/* MCP Config File */}
              <div
                className={cn(
                  'border-border bg-background rounded-xl border p-4 transition-opacity',
                  settings.mcpEnabled === false && 'opacity-50',
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-foreground text-sm font-medium">
                      {t.settings.mcpConfigPath}
                    </h3>
                    <code className="bg-muted text-muted-foreground mt-2 block truncate rounded px-2 py-1 text-xs">
                      {mcpDirs.app || defaultMcpPath}
                    </code>
                  </div>
                  <div className="ml-4 flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => openFolderInSystem(mcpDirs.app)}
                      className="text-muted-foreground hover:text-foreground hover:bg-accent rounded p-2 transition-colors"
                      aria-label="Open MCP config folder"
                    >
                      <FileJson className="size-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Import Dialog */}
      <ImportDialog
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        importJson={importJson}
        onImportJsonChange={setImportJson}
        onImport={handleImportJson}
      />

      {/* Config Dialog */}
      <ConfigDialog
        configDialog={configDialog}
        setConfigDialog={setConfigDialog}
        onSave={handleSaveConfigDialog}
      />
    </>
  );
}
