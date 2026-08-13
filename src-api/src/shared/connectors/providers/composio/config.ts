import { getSetting, saveSetting } from '@/shared/db/operations';

export interface ConnectedAccountRef {
  id: string;
  label?: string;
  userId?: string;
  authConfigId?: string;
  connectedAt: string;
}

export interface CatalogCacheIndex {
  path: string;
  fetchedAt: string;
  schemaVersion: number;
}

export interface ComposioConfigStore {
  getApiKey(): string | null;
  setApiKey(key: string | null): void;
  getAuthConfigIds(): Record<string, string>;
  setAuthConfigId(connectorId: string, authConfigId: string): void;
  getConnectedAccountIds(): Record<string, Record<string, ConnectedAccountRef>>;
  setConnectedAccount(
    scopeKey: string,
    connectorId: string,
    account: ConnectedAccountRef,
  ): void;
  removeConnectedAccount(connectorId: string, scopeKey?: string): void;
  getCatalogCacheIndex(): CatalogCacheIndex | null;
  setCatalogCacheIndex(index: CatalogCacheIndex | null): void;
}

export const COMPOSIO_API_KEY_SETTING = 'connectors.composio.apiKey';
export const COMPOSIO_AUTH_CONFIG_IDS_SETTING =
  'connectors.composio.authConfigIds';
export const COMPOSIO_CONNECTED_ACCOUNT_IDS_SETTING =
  'connectors.composio.connectedAccountIds';
export const COMPOSIO_CATALOG_CACHE_INDEX_SETTING =
  'connectors.composio.catalogCache';

export class SettingsComposioConfigStore implements ComposioConfigStore {
  getApiKey(): string | null {
    const value = getSetting(COMPOSIO_API_KEY_SETTING)?.trim() ?? '';
    return value.length > 0 ? value : null;
  }

  setApiKey(key: string | null): void {
    saveSetting(COMPOSIO_API_KEY_SETTING, key?.trim() ?? '');
  }

  getAuthConfigIds(): Record<string, string> {
    return readJsonSetting<Record<string, string>>(
      COMPOSIO_AUTH_CONFIG_IDS_SETTING,
      {},
    );
  }

  setAuthConfigId(connectorId: string, authConfigId: string): void {
    const current = this.getAuthConfigIds();
    current[connectorId] = authConfigId;
    writeJsonSetting(COMPOSIO_AUTH_CONFIG_IDS_SETTING, current);
  }

  getConnectedAccountIds(): Record<
    string,
    Record<string, ConnectedAccountRef>
  > {
    return readJsonSetting<Record<string, Record<string, ConnectedAccountRef>>>(
      COMPOSIO_CONNECTED_ACCOUNT_IDS_SETTING,
      {},
    );
  }

  setConnectedAccount(
    scopeKey: string,
    connectorId: string,
    account: ConnectedAccountRef,
  ): void {
    const current = this.getConnectedAccountIds();
    current[scopeKey] = {
      ...(current[scopeKey] ?? {}),
      [connectorId]: account,
    };
    writeJsonSetting(COMPOSIO_CONNECTED_ACCOUNT_IDS_SETTING, current);
  }

  removeConnectedAccount(connectorId: string, scopeKey?: string): void {
    const current = this.getConnectedAccountIds();
    if (scopeKey) {
      const scoped = { ...(current[scopeKey] ?? {}) };
      delete scoped[connectorId];
      if (Object.keys(scoped).length === 0) delete current[scopeKey];
      else current[scopeKey] = scoped;
    } else {
      for (const key of Object.keys(current)) {
        delete current[key]?.[connectorId];
        if (Object.keys(current[key] ?? {}).length === 0) delete current[key];
      }
    }
    writeJsonSetting(COMPOSIO_CONNECTED_ACCOUNT_IDS_SETTING, current);
  }

  getCatalogCacheIndex(): CatalogCacheIndex | null {
    return readJsonSetting<CatalogCacheIndex | null>(
      COMPOSIO_CATALOG_CACHE_INDEX_SETTING,
      null,
    );
  }

  setCatalogCacheIndex(index: CatalogCacheIndex | null): void {
    if (!index) {
      saveSetting(COMPOSIO_CATALOG_CACHE_INDEX_SETTING, '');
      return;
    }
    writeJsonSetting(COMPOSIO_CATALOG_CACHE_INDEX_SETTING, index);
  }
}

export class MemoryComposioConfigStore implements ComposioConfigStore {
  private apiKey: string | null = null;
  private authConfigIds: Record<string, string> = {};
  private connectedAccountIds: Record<
    string,
    Record<string, ConnectedAccountRef>
  > = {};
  private catalogCacheIndex: CatalogCacheIndex | null = null;

  getApiKey(): string | null {
    return this.apiKey;
  }

  setApiKey(key: string | null): void {
    this.apiKey = key?.trim() || null;
  }

  getAuthConfigIds(): Record<string, string> {
    return { ...this.authConfigIds };
  }

  setAuthConfigId(connectorId: string, authConfigId: string): void {
    this.authConfigIds = { ...this.authConfigIds, [connectorId]: authConfigId };
  }

  getConnectedAccountIds(): Record<
    string,
    Record<string, ConnectedAccountRef>
  > {
    return JSON.parse(JSON.stringify(this.connectedAccountIds)) as Record<
      string,
      Record<string, ConnectedAccountRef>
    >;
  }

  setConnectedAccount(
    scopeKey: string,
    connectorId: string,
    account: ConnectedAccountRef,
  ): void {
    this.connectedAccountIds = {
      ...this.connectedAccountIds,
      [scopeKey]: {
        ...(this.connectedAccountIds[scopeKey] ?? {}),
        [connectorId]: account,
      },
    };
  }

  removeConnectedAccount(connectorId: string, scopeKey?: string): void {
    if (scopeKey) {
      const scoped = { ...(this.connectedAccountIds[scopeKey] ?? {}) };
      delete scoped[connectorId];
      this.connectedAccountIds = { ...this.connectedAccountIds };
      if (Object.keys(scoped).length === 0)
        delete this.connectedAccountIds[scopeKey];
      else this.connectedAccountIds[scopeKey] = scoped;
      return;
    }

    this.connectedAccountIds = Object.fromEntries(
      Object.entries(this.connectedAccountIds)
        .map(([key, scoped]) => {
          const next = { ...scoped };
          delete next[connectorId];
          return [key, next] as const;
        })
        .filter(([, scoped]) => Object.keys(scoped).length > 0),
    );
  }

  getCatalogCacheIndex(): CatalogCacheIndex | null {
    return this.catalogCacheIndex ? { ...this.catalogCacheIndex } : null;
  }

  setCatalogCacheIndex(index: CatalogCacheIndex | null): void {
    this.catalogCacheIndex = index ? { ...index } : null;
  }
}

export function apiKeyTail(apiKey: string | null): string {
  if (!apiKey) return '';
  return apiKey.slice(-4);
}

function readJsonSetting<T>(key: string, fallback: T): T {
  const raw = getSetting(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJsonSetting(key: string, value: unknown): void {
  saveSetting(key, JSON.stringify(value));
}
