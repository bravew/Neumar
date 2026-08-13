import { readFile } from 'fs/promises';
import { homedir } from 'os';
import path from 'path';

import { APP_DATA_DIR } from '@/config/branding';

import type { ConnectorCatalogDefinition } from '@/shared/connectors/catalog';
import { writeJsonAtomic } from '@/shared/services/design-mode/fs';

export const COMPOSIO_CATALOG_CACHE_SCHEMA_VERSION = 1;
export const COMPOSIO_CATALOG_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface ComposioCatalogCachePayload {
  schemaVersion: number;
  fetchedAt: string;
  definitions: ConnectorCatalogDefinition[];
}

export class ComposioCatalogCache {
  constructor(
    readonly filePath = path.join(
      homedir(),
      APP_DATA_DIR,
      'connectors',
      'composio-catalog-cache.json',
    ),
  ) {}

  async read(): Promise<ComposioCatalogCachePayload | null> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const payload = JSON.parse(raw) as ComposioCatalogCachePayload;
      if (payload.schemaVersion !== COMPOSIO_CATALOG_CACHE_SCHEMA_VERSION) {
        return null;
      }
      if (!Array.isArray(payload.definitions)) return null;
      return payload;
    } catch {
      return null;
    }
  }

  async write(
    definitions: ConnectorCatalogDefinition[],
  ): Promise<ComposioCatalogCachePayload> {
    const payload: ComposioCatalogCachePayload = {
      schemaVersion: COMPOSIO_CATALOG_CACHE_SCHEMA_VERSION,
      fetchedAt: new Date().toISOString(),
      definitions,
    };
    await writeJsonAtomic(this.filePath, payload);
    return payload;
  }

  isFresh(payload: ComposioCatalogCachePayload, now = Date.now()): boolean {
    return now - Date.parse(payload.fetchedAt) < COMPOSIO_CATALOG_CACHE_TTL_MS;
  }
}
