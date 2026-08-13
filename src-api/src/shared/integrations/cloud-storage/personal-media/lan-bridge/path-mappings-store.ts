import { randomUUID } from 'crypto';

import type Database from 'better-sqlite3';

import { getDatabase } from '@/shared/db';

import type { PathMapping } from './types';

interface PathMappingRow {
  id: string;
  connection_id: string;
  immich_path_prefix: string;
  local_mount_path: string;
  verified: number;
  verified_at: string | null;
  verification_hash: string | null;
  last_error: string | null;
  disabled: number;
  created_at: string;
  updated_at: string;
}

export interface UpsertPathMappingInput {
  id?: string;
  connectionId: string;
  immichPathPrefix: string;
  localMountPath: string;
  verified?: boolean;
  verifiedAt?: string;
  verificationHash?: string;
  lastError?: string;
  disabled?: boolean;
}

export class PathMappingsStore {
  constructor(private readonly db: Database.Database = getDatabase()) {}

  list(connectionId: string, includeDisabled = true): PathMapping[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM cloud_storage_path_mappings_local
         WHERE connection_id = ?
           AND (? = 1 OR disabled = 0)
         ORDER BY length(immich_path_prefix) DESC, immich_path_prefix ASC`,
      )
      .all(connectionId, includeDisabled ? 1 : 0) as PathMappingRow[];
    return rows.map(rowToPathMapping);
  }

  listDueForReverification({
    maxAgeMs,
    limit,
    now = new Date(),
  }: {
    maxAgeMs: number;
    limit: number;
    now?: Date;
  }): PathMapping[] {
    const cutoff = new Date(now.getTime() - maxAgeMs).toISOString();
    const rows = this.db
      .prepare(
        `SELECT * FROM cloud_storage_path_mappings_local
         WHERE disabled = 0
           AND verified = 1
           AND (verified_at IS NULL OR verified_at <= ?)
         ORDER BY COALESCE(verified_at, created_at) ASC
         LIMIT ?`,
      )
      .all(cutoff, limit) as PathMappingRow[];
    return rows.map(rowToPathMapping);
  }

  getForConnection(connectionId: string, id: string): PathMapping | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM cloud_storage_path_mappings_local
         WHERE connection_id = ? AND id = ?`,
      )
      .get(connectionId, id) as PathMappingRow | undefined;
    return row === undefined ? undefined : rowToPathMapping(row);
  }

  upsert(input: UpsertPathMappingInput): PathMapping {
    const id = input.id ?? randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO cloud_storage_path_mappings_local
          (id, connection_id, immich_path_prefix, local_mount_path, verified,
           verified_at, verification_hash, last_error, disabled, created_at, updated_at)
         VALUES (@id, @connectionId, @immichPathPrefix, @localMountPath, @verified,
           @verifiedAt, @verificationHash, @lastError, @disabled, @createdAt, @updatedAt)
         ON CONFLICT(connection_id, immich_path_prefix) DO UPDATE SET
           local_mount_path = excluded.local_mount_path,
           verified = excluded.verified,
           verified_at = excluded.verified_at,
           verification_hash = excluded.verification_hash,
           last_error = excluded.last_error,
           disabled = excluded.disabled,
           updated_at = excluded.updated_at`,
      )
      .run({
        id,
        connectionId: input.connectionId,
        immichPathPrefix: input.immichPathPrefix,
        localMountPath: input.localMountPath,
        verified: input.verified ? 1 : 0,
        verifiedAt: input.verifiedAt ?? null,
        verificationHash: input.verificationHash ?? null,
        lastError: input.lastError ?? null,
        disabled: input.disabled ? 1 : 0,
        createdAt: now,
        updatedAt: now,
      });

    const row = this.db
      .prepare(
        `SELECT * FROM cloud_storage_path_mappings_local
         WHERE connection_id = ? AND immich_path_prefix = ?`,
      )
      .get(input.connectionId, input.immichPathPrefix) as PathMappingRow;
    return rowToPathMapping(row);
  }

  markVerification(
    id: string,
    verified: boolean,
    options: { verificationHash?: string; lastError?: string; now?: Date } = {},
  ): void {
    const now = options.now ?? new Date();
    const timestamp = now.toISOString();
    this.db
      .prepare(
        `UPDATE cloud_storage_path_mappings_local
         SET verified = ?,
             verified_at = ?,
             verification_hash = ?,
             last_error = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(
        verified ? 1 : 0,
        verified ? timestamp : null,
        options.verificationHash ?? null,
        options.lastError ?? null,
        timestamp,
        id,
      );
  }

  delete(id: string): void {
    this.db
      .prepare('DELETE FROM cloud_storage_path_mappings_local WHERE id = ?')
      .run(id);
  }

  deleteForConnection(connectionId: string, id: string): boolean {
    const result = this.db
      .prepare(
        `DELETE FROM cloud_storage_path_mappings_local
         WHERE connection_id = ? AND id = ?`,
      )
      .run(connectionId, id);
    return result.changes > 0;
  }
}

function rowToPathMapping(row: PathMappingRow): PathMapping {
  return {
    id: row.id,
    connectionId: row.connection_id,
    immichPathPrefix: row.immich_path_prefix,
    localMountPath: row.local_mount_path,
    disabled: row.disabled === 1,
    verified: row.verified === 1,
    verifiedAt: row.verified_at ?? undefined,
    verificationHash: row.verification_hash ?? undefined,
    lastError: row.last_error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
