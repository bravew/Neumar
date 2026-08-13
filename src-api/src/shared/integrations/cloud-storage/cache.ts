import type Database from 'better-sqlite3';

import { getDatabase } from '@/shared/db';

import type {
  CachedCloudStorageConnection,
  Capabilities,
  CloudStorageProvider,
} from './types';

export interface SiteConnection {
  id: string;
  provider: CloudStorageProvider;
  accountEmail?: string | null;
  account_email?: string | null;
  displayName?: string | null;
  display_name?: string | null;
  status?: string | null;
  capabilities?: Capabilities | null;
  capabilitiesJson?: string | null;
  connectedAt?: string | null;
  connected_at?: string | null;
}

export function getCachedConnection(
  connectionId: string,
  db: Database.Database = getDatabase(),
): CachedCloudStorageConnection | null {
  const row = db
    .prepare(
      `SELECT
        id,
        provider,
        account_email AS accountEmail,
        display_name AS displayName,
        status,
        capabilities_json AS capabilitiesJson,
        connected_at AS connectedAt,
        last_synced_with_site_at AS lastSyncedWithSiteAt
      FROM cloud_storage_connections_cache
      WHERE id = ?`,
    )
    .get(connectionId) as CachedCloudStorageConnection | undefined;

  return row ?? null;
}

export function upsertCachedConnections(
  connections: SiteConnection[],
  db: Database.Database = getDatabase(),
): void {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO cloud_storage_connections_cache (
      id, provider, account_email, display_name, status,
      capabilities_json, connected_at, last_synced_with_site_at
    ) VALUES (
      @id, @provider, @accountEmail, @displayName, @status,
      @capabilitiesJson, @connectedAt, @lastSyncedWithSiteAt
    )
    ON CONFLICT(id) DO UPDATE SET
      provider = excluded.provider,
      account_email = excluded.account_email,
      display_name = excluded.display_name,
      status = excluded.status,
      capabilities_json = excluded.capabilities_json,
      last_synced_with_site_at = excluded.last_synced_with_site_at
  `);

  const tx = db.transaction((rows: SiteConnection[]) => {
    for (const connection of rows) {
      stmt.run({
        id: connection.id,
        provider: connection.provider,
        accountEmail:
          connection.accountEmail ?? connection.account_email ?? null,
        displayName: connection.displayName ?? connection.display_name ?? null,
        status: connection.status ?? 'active',
        capabilitiesJson:
          connection.capabilitiesJson ??
          (connection.capabilities
            ? JSON.stringify(connection.capabilities)
            : null),
        connectedAt: connection.connectedAt ?? connection.connected_at ?? now,
        lastSyncedWithSiteAt: now,
      });
    }
  });

  tx(connections);
}

export function markCachedConnectionsNeedsReauth(
  db: Database.Database = getDatabase(),
): void {
  db.prepare(
    `UPDATE cloud_storage_connections_cache
     SET status = 'needs_reauth', last_synced_with_site_at = ?
     WHERE status != 'needs_reauth'`,
  ).run(new Date().toISOString());
}
