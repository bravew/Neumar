import type Database from 'better-sqlite3';

import { getDatabase } from '@/shared/db';
import {
  cloudStorageRegistry,
  getCachedConnection,
  nativeProviderForLocalId,
  resolveNativeLocalAdapter,
  type CloudStorageAdapter,
} from '@/shared/integrations/cloud-storage';
import { errorMessage } from '@/shared/utils/errors';

import { AssetRegistry, AssetsError } from '../registry';
import type { AssetSource } from '../types';
import {
  cloudFileToRemoteAsset,
  createCloudCatalogConnector,
  type CatalogConnector,
  type CloudCatalogSource,
} from './immich';
import {
  getAssetSyncState,
  listAssetIndexedConnectionIds,
  recordAssetSyncError,
  recordAssetSyncSuccess,
  type AssetSyncState,
} from './state';

const CLOUD_CATALOG_SOURCES: ReadonlySet<CloudCatalogSource> = new Set([
  'immich',
  'box',
  'google_drive',
  'dropbox',
  'onedrive',
]);

function isCloudCatalogSource(
  source: AssetSource,
): source is CloudCatalogSource {
  return CLOUD_CATALOG_SOURCES.has(source as CloudCatalogSource);
}

export type AssetSyncMode = 'auto' | 'full' | 'delta';

export interface AssetSyncRequest {
  source: CloudCatalogSource;
  connectionId: string;
  mode?: AssetSyncMode;
  limit?: number;
}

export interface AssetSourceSyncRequest {
  source: CloudCatalogSource;
  connectionId?: string;
  mode?: AssetSyncMode;
  limit?: number;
}

export interface AssetSyncResult {
  source: CloudCatalogSource;
  connectionId: string;
  mode: 'full' | 'delta';
  scanned: number;
  created: number;
  updated: number;
  deleted: number;
  state: AssetSyncState;
}

export interface AssetSourceSyncResult {
  source: CloudCatalogSource;
  results: AssetSyncResult[];
  scanned: number;
  created: number;
  updated: number;
  deleted: number;
}

interface SchedulerOptions {
  db?: Database.Database;
  registry?: AssetRegistry;
  resolveAdapter?: (
    source: AssetSource,
    connectionId: string,
  ) => CloudStorageAdapter | null | Promise<CloudStorageAdapter | null>;
  now?: () => number;
  maxPages?: number;
}

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
const DEFAULT_MAX_PAGES = 500;

export class AssetCatalogSyncScheduler {
  private readonly db: Database.Database;
  private readonly registry: AssetRegistry;
  private readonly now: () => number;
  private readonly maxPages: number;
  private readonly resolveAdapter: NonNullable<
    SchedulerOptions['resolveAdapter']
  >;

  constructor(options: SchedulerOptions = {}) {
    this.db = options.db ?? getDatabase();
    this.registry = options.registry ?? new AssetRegistry({ db: this.db });
    this.now = options.now ?? Date.now;
    this.maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    this.resolveAdapter = options.resolveAdapter ?? defaultResolveAdapter;
  }

  async syncSource(
    input: AssetSourceSyncRequest,
  ): Promise<AssetSourceSyncResult> {
    const connectionIds = input.connectionId
      ? [input.connectionId]
      : listAssetIndexedConnectionIds(input.source, { db: this.db });
    if (connectionIds.length === 0) {
      throw new AssetsError(
        `No enabled ${input.source} asset connector found`,
        404,
      );
    }

    const results: AssetSyncResult[] = [];
    for (const connectionId of connectionIds) {
      results.push(
        await this.syncConnection({
          source: input.source,
          connectionId,
          mode: input.mode,
          limit: input.limit,
        }),
      );
    }
    return {
      source: input.source,
      results,
      scanned: sum(results, 'scanned'),
      created: sum(results, 'created'),
      updated: sum(results, 'updated'),
      deleted: sum(results, 'deleted'),
    };
  }

  async syncConnection(input: AssetSyncRequest): Promise<AssetSyncResult> {
    try {
      const connector = await this.connectorFor(
        input.source,
        input.connectionId,
      );
      const current = getAssetSyncState(input.source, input.connectionId, {
        db: this.db,
      });
      const mode =
        input.mode === 'full' || input.mode === 'delta'
          ? input.mode
          : current.fullSyncAt
            ? 'delta'
            : 'full';
      return mode === 'full'
        ? await this.fullSync(connector, input.limit)
        : await this.deltaSync(connector, current, input.limit);
    } catch (error) {
      recordAssetSyncError(
        input.source,
        input.connectionId,
        errorMessage(error),
        { db: this.db },
      );
      throw error;
    }
  }

  private async connectorFor(
    source: AssetSource,
    connectionId: string,
  ): Promise<CatalogConnector> {
    // Native cloud providers (Box, Drive, Dropbox, OneDrive) share a
    // single in-process adapter per provider and are referenced by a
    // fixed `local_<provider>` connection id that lives outside the
    // `cloud_storage_connections_cache` table. Accept both: a cached
    // row whose provider matches, or a recognised native local id.
    const cached = getCachedConnection(connectionId, this.db);
    const nativeProvider = nativeProviderForLocalId(connectionId);
    const matches =
      (cached && cached.provider === source) ||
      (nativeProvider && nativeProvider === source);
    if (!matches) {
      throw new AssetsError(`${source} connection not found`, 404);
    }
    if (!isCloudCatalogSource(source)) {
      throw new AssetsError(`${source} catalog sync is not supported`, 400);
    }
    const adapter = await this.resolveAdapter(source, connectionId);
    if (!adapter) {
      throw new AssetsError(`${source} catalog adapter not available`, 404);
    }
    return createCloudCatalogConnector(source, connectionId, adapter);
  }

  private async fullSync(
    connector: CatalogConnector,
    requestedLimit: number | undefined,
  ): Promise<AssetSyncResult> {
    const counts = emptyCounts();
    const limit = clampLimit(requestedLimit);
    let cursor: string | undefined;
    let pages = 0;
    const seenSourceIds = new Set<string>();

    do {
      const page = await connector.fullList({ cursor, limit });
      for (const file of page.items) {
        const input = cloudFileToRemoteAsset(
          connector.source,
          connector.connectionId,
          file,
        );
        if (!input) continue;
        seenSourceIds.add(input.sourceId);
        counts.scanned += 1;
        const result = this.registry.upsertRemote(input);
        if (result.created) counts.created += 1;
        else counts.updated += 1;
      }
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < this.maxPages);

    if (!cursor) {
      counts.deleted += this.pruneMissingRemoteAssets(connector, seenSourceIds);
    }

    const completedAt = this.now();
    const nextState = recordAssetSyncSuccess(
      {
        source: connector.source,
        connectionId: connector.connectionId,
        cursor: new Date(completedAt).toISOString(),
        fullSyncAt: completedAt,
        lastSyncedAt: completedAt,
        lastError: null,
      },
      { db: this.db },
    );

    return {
      source: connector.source,
      connectionId: connector.connectionId,
      mode: 'full',
      ...counts,
      state: nextState,
    };
  }

  private pruneMissingRemoteAssets(
    connector: CatalogConnector,
    seenSourceIds: Set<string>,
  ): number {
    const rows = this.db
      .prepare(
        `SELECT source_id
         FROM assets
         WHERE source = ?
           AND connection_id = ?
           AND source_id IS NOT NULL
           AND deleted_at IS NULL`,
      )
      .all(connector.source, connector.connectionId) as { source_id: string }[];

    let deleted = 0;
    for (const row of rows) {
      if (seenSourceIds.has(row.source_id)) continue;
      if (
        this.registry.softDeleteRemote(
          connector.source,
          connector.connectionId,
          row.source_id,
        )
      ) {
        deleted += 1;
      }
    }
    return deleted;
  }

  private async deltaSync(
    connector: CatalogConnector,
    state: AssetSyncState,
    requestedLimit: number | undefined,
  ): Promise<AssetSyncResult> {
    const counts = emptyCounts();
    const limit = clampLimit(requestedLimit);
    let cursor = state.cursor ?? new Date(0).toISOString();
    let pages = 0;

    do {
      const page = await connector.delta({ cursor, limit });
      for (const change of page.changes) {
        if (change.type === 'deleted') {
          if (
            this.registry.softDeleteRemote(
              connector.source,
              connector.connectionId,
              change.itemId,
            )
          ) {
            counts.deleted += 1;
          }
          continue;
        }

        if (!change.item) continue;
        const input = cloudFileToRemoteAsset(
          connector.source,
          connector.connectionId,
          change.item,
        );
        if (!input) continue;
        counts.scanned += 1;
        const result = this.registry.upsertRemote(input);
        if (result.created) counts.created += 1;
        else counts.updated += 1;
      }
      cursor = page.nextCursor ?? cursor;
      pages += 1;
      if (!page.hasMore) break;
    } while (pages < this.maxPages);

    const completedAt = this.now();
    const nextState = recordAssetSyncSuccess(
      {
        source: connector.source,
        connectionId: connector.connectionId,
        cursor,
        fullSyncAt: state.fullSyncAt,
        lastSyncedAt: completedAt,
        lastError: null,
      },
      { db: this.db },
    );

    return {
      source: connector.source,
      connectionId: connector.connectionId,
      mode: 'delta',
      ...counts,
      state: nextState,
    };
  }
}

export function createAssetCatalogSyncScheduler(
  options: SchedulerOptions = {},
): AssetCatalogSyncScheduler {
  return new AssetCatalogSyncScheduler(options);
}

export function syncAssetsConnection(
  input: AssetSyncRequest,
  options: SchedulerOptions = {},
): Promise<AssetSyncResult> {
  return new AssetCatalogSyncScheduler(options).syncConnection(input);
}

export function syncAssetsSource(
  input: AssetSourceSyncRequest,
  options: SchedulerOptions = {},
): Promise<AssetSourceSyncResult> {
  return new AssetCatalogSyncScheduler(options).syncSource(input);
}

function defaultResolveAdapter(
  _source: AssetSource,
  connectionId: string,
): CloudStorageAdapter | null {
  // Mirror `remote-search.ts`: native cloud adapters (Box / Drive /
  // Dropbox / OneDrive) live outside `cloudStorageRegistry` and must be
  // resolved via the fixed `local_<provider>` id. Fall back to the
  // registry for providers that do live there (Immich, etc.).
  const native = resolveNativeLocalAdapter(connectionId);
  if (native) return native;
  try {
    return cloudStorageRegistry.resolve(connectionId);
  } catch {
    return null;
  }
}

function emptyCounts() {
  return {
    scanned: 0,
    created: 0,
    updated: 0,
    deleted: 0,
  };
}

function sum(
  results: AssetSyncResult[],
  key: keyof ReturnType<typeof emptyCounts>,
) {
  return results.reduce((total, result) => total + result[key], 0);
}

function clampLimit(limit: number | undefined): number {
  if (!limit) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT);
}
