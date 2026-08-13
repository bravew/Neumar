import type Database from 'better-sqlite3';

import { getDatabase } from '@/shared/db';
import { nativeLocalIdForProvider } from '@/shared/integrations/cloud-storage';

import type { AssetSource } from '../types';

const INDEX_SETTING_PREFIX = 'assets.index_connection:';

export interface AssetSyncState {
  source: AssetSource;
  connectionId: string;
  cursor: string | null;
  fullSyncAt: number | null;
  lastSyncedAt: number | null;
  lastError: string | null;
}

export interface AssetCatalogConnectionStatus {
  enabled: boolean;
  fullSyncAt: number | null;
  lastSyncedAt: number | null;
  lastError: string | null;
}

interface StateOptions {
  db?: Database.Database;
}

interface SyncStateRow {
  source: string;
  connection_id: string;
  cursor: string | null;
  full_sync_at: number | null;
  last_synced_at: number | null;
  last_error: string | null;
}

export function getAssetConnectionCatalogStatus(
  source: AssetSource,
  connectionId: string,
  options: StateOptions = {},
): AssetCatalogConnectionStatus {
  const state = getAssetSyncState(source, connectionId, options);
  return {
    enabled: isAssetConnectionIndexingEnabled(connectionId, options),
    fullSyncAt: state.fullSyncAt,
    lastSyncedAt: state.lastSyncedAt,
    lastError: state.lastError,
  };
}

// Opt-out flag: unset is treated as enabled. Only an explicit 'false' disables
// indexing, matching the `assets.catalog_enabled` convention in
// src-api/src/shared/assets/flags.ts.
export function isAssetConnectionIndexingEnabled(
  connectionId: string,
  options: StateOptions = {},
): boolean {
  const row = dbFrom(options)
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(indexSettingKey(connectionId)) as { value: string } | undefined;
  return row?.value !== 'false';
}

export function setAssetConnectionIndexingEnabled(
  connectionId: string,
  enabled: boolean,
  options: StateOptions = {},
): void {
  dbFrom(options)
    .prepare(
      `INSERT OR REPLACE INTO settings (key, value, updated_at)
       VALUES (?, ?, datetime('now'))`,
    )
    .run(indexSettingKey(connectionId), enabled ? 'true' : 'false');
}

export function clearAssetConnectionIndexing(
  connectionId: string,
  options: StateOptions = {},
): void {
  dbFrom(options)
    .prepare('DELETE FROM settings WHERE key = ?')
    .run(indexSettingKey(connectionId));
}

// Indexing is opt-out: every active connection of `source` is included unless
// its per-connection setting is explicitly 'false'.
export function listAssetIndexedConnectionIds(
  source: AssetSource,
  options: StateOptions = {},
): string[] {
  const db = dbFrom(options);
  const disabledRows = db
    .prepare(
      `SELECT key FROM settings
       WHERE key LIKE ? AND value = 'false'`,
    )
    .all(`${INDEX_SETTING_PREFIX}%`) as { key: string }[];
  const disabled = new Set(
    disabledRows.map((row) => row.key.slice(INDEX_SETTING_PREFIX.length)),
  );
  // Some test fixtures skip the cloud_storage migrations, so guard the lookup
  // and treat a missing table as "no cached connections".
  const connections = tableExists(db, 'cloud_storage_connections_cache')
    ? (db
        .prepare(
          `SELECT id FROM cloud_storage_connections_cache
           WHERE provider = ? AND status = 'active'
           ORDER BY id`,
        )
        .all(source) as { id: string }[])
    : [];
  const ids = connections.map((row) => row.id);
  // Native cloud providers (Box, Drive, Dropbox, OneDrive) are served by
  // in-process adapters that share a fixed connection id per provider. They
  // do not live in `cloud_storage_connections_cache`, so the query above
  // would miss them; surface the native id when the source matches.
  const nativeId = nativeLocalIdForProvider(source as never);
  if (nativeId && !ids.includes(nativeId)) ids.push(nativeId);
  return ids.filter((connectionId) => !disabled.has(connectionId));
}

export function getAssetSyncState(
  source: AssetSource,
  connectionId: string,
  options: StateOptions = {},
): AssetSyncState {
  const row = dbFrom(options)
    .prepare(
      `SELECT source, connection_id, cursor, full_sync_at, last_synced_at, last_error
       FROM asset_sync_state
       WHERE source = ? AND connection_id = ?`,
    )
    .get(source, connectionId) as SyncStateRow | undefined;
  if (!row) {
    return {
      source,
      connectionId,
      cursor: null,
      fullSyncAt: null,
      lastSyncedAt: null,
      lastError: null,
    };
  }
  return {
    source: row.source as AssetSource,
    connectionId: row.connection_id,
    cursor: row.cursor,
    fullSyncAt: row.full_sync_at,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error,
  };
}

export function recordAssetSyncSuccess(
  state: AssetSyncState,
  options: StateOptions = {},
): AssetSyncState {
  const db = dbFrom(options);
  db.prepare(
    `INSERT INTO asset_sync_state
     (source, connection_id, cursor, full_sync_at, last_synced_at, last_error)
     VALUES (@source, @connectionId, @cursor, @fullSyncAt, @lastSyncedAt, NULL)
     ON CONFLICT(source, connection_id) DO UPDATE SET
       cursor = excluded.cursor,
       full_sync_at = excluded.full_sync_at,
       last_synced_at = excluded.last_synced_at,
       last_error = NULL`,
  ).run({
    source: state.source,
    connectionId: state.connectionId,
    cursor: state.cursor,
    fullSyncAt: state.fullSyncAt,
    lastSyncedAt: state.lastSyncedAt,
  });
  return getAssetSyncState(state.source, state.connectionId, options);
}

export function recordAssetSyncError(
  source: AssetSource,
  connectionId: string,
  error: string,
  options: StateOptions = {},
): AssetSyncState {
  const current = getAssetSyncState(source, connectionId, options);
  dbFrom(options)
    .prepare(
      `INSERT INTO asset_sync_state
       (source, connection_id, cursor, full_sync_at, last_synced_at, last_error)
       VALUES (@source, @connectionId, @cursor, @fullSyncAt, @lastSyncedAt, @lastError)
       ON CONFLICT(source, connection_id) DO UPDATE SET
         last_error = excluded.last_error`,
    )
    .run({
      source,
      connectionId,
      cursor: current.cursor,
      fullSyncAt: current.fullSyncAt,
      lastSyncedAt: current.lastSyncedAt,
      lastError: error,
    });
  return getAssetSyncState(source, connectionId, options);
}

export function removeAssetSyncState(
  source: AssetSource,
  connectionId: string,
  options: StateOptions = {},
): void {
  dbFrom(options)
    .prepare(
      'DELETE FROM asset_sync_state WHERE source = ? AND connection_id = ?',
    )
    .run(source, connectionId);
}

function indexSettingKey(connectionId: string): string {
  return `${INDEX_SETTING_PREFIX}${connectionId}`;
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS present FROM sqlite_master
       WHERE type = 'table' AND name = ?`,
    )
    .get(name) as { present: number } | undefined;
  return Boolean(row);
}

function dbFrom(options: StateOptions): Database.Database {
  return options.db ?? getDatabase();
}
