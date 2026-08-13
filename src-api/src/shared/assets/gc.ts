import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { getDatabase } from '@/shared/db';
import { createLogger } from '@/shared/utils/logger';

import {
  DEFAULT_ASSET_GC_RETENTION_MS,
  getAssetRegistry,
  type AssetRegistry,
  type AssetGarbageCollectOptions,
  type AssetGarbageCollectResult,
} from './registry';
import { getAssetsWorkspaceRoot } from './workspace';

const logger = createLogger('Assets/GC');
const ASSET_GC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const PARTIAL_DOWNLOAD_MAX_AGE_MS = 60 * 60 * 1000;

let gcTimer: NodeJS.Timeout | undefined;
let gcRunning = false;

export function startAssetGcScheduler(): void {
  if (gcTimer) return;
  gcTimer = setInterval(() => {
    void runAssetGarbageCollection().catch((error) => {
      logger.warn('assets.gc.failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, ASSET_GC_INTERVAL_MS);
  gcTimer.unref?.();
}

export function stopAssetGcScheduler(): void {
  if (!gcTimer) return;
  clearInterval(gcTimer);
  gcTimer = undefined;
}

export async function runAssetGarbageCollection(
  options: AssetGarbageCollectOptions & {
    db?: ReturnType<typeof getDatabase>;
    partialMaxAgeMs?: number;
    registry?: AssetRegistry;
    sweepMaterializedAssets?: boolean;
    sweepPartialDownloads?: boolean;
    workspaceRoot?: string;
  } = {},
): Promise<
  AssetGarbageCollectResult & {
    partialFilesPurged: number;
    materializationsPurged: number;
    cacheRowsPurged: number;
  }
> {
  if (gcRunning) {
    return {
      scanned: 0,
      purged: 0,
      skippedAttached: 0,
      bytesFreed: 0,
      filesDeleted: 0,
      errors: [{ assetId: '*', message: 'asset GC already running' }],
      partialFilesPurged: 0,
      materializationsPurged: 0,
      cacheRowsPurged: 0,
    };
  }

  gcRunning = true;
  try {
    const {
      db: injectedDb,
      partialMaxAgeMs,
      registry: injectedRegistry,
      sweepMaterializedAssets,
      sweepPartialDownloads,
      workspaceRoot: injectedWorkspaceRoot,
      ...gcOptions
    } = options;
    const db = injectedDb ?? getDatabase();
    const registry = injectedRegistry ?? getAssetRegistry();
    const workspaceRoot = injectedWorkspaceRoot ?? getAssetsWorkspaceRoot();
    const now = gcOptions.now ?? Date.now();
    const result = registry.garbageCollectDeleted({
      retentionMs: DEFAULT_ASSET_GC_RETENTION_MS,
      ...gcOptions,
    });
    const shouldSweepMaterializedAssets = sweepMaterializedAssets ?? true;
    const materialized = shouldSweepMaterializedAssets
      ? await sweepMaterializations(db, workspaceRoot)
      : emptySweepResult();
    const cache = shouldSweepMaterializedAssets
      ? await sweepCache(db, workspaceRoot, now)
      : emptySweepResult();
    const partials =
      (sweepPartialDownloads ?? true)
        ? await sweepPartialDownloadsFiles({
            maxAgeMs: partialMaxAgeMs ?? PARTIAL_DOWNLOAD_MAX_AGE_MS,
            now,
            workspaceRoot,
          })
        : emptySweepResult();
    const combined = {
      ...result,
      bytesFreed:
        result.bytesFreed +
        materialized.bytesFreed +
        cache.bytesFreed +
        partials.bytesFreed,
      filesDeleted:
        result.filesDeleted +
        materialized.filesDeleted +
        cache.filesDeleted +
        partials.filesDeleted,
      errors: [
        ...result.errors,
        ...materialized.errors,
        ...cache.errors,
        ...partials.errors,
      ],
      partialFilesPurged: partials.filesDeleted,
      materializationsPurged: materialized.rowsPurged,
      cacheRowsPurged: cache.rowsPurged,
    };
    if (
      combined.purged > 0 ||
      combined.materializationsPurged > 0 ||
      combined.cacheRowsPurged > 0 ||
      combined.partialFilesPurged > 0 ||
      combined.errors.length > 0
    ) {
      logger.info('assets.gc.completed', combined);
    }
    return combined;
  } finally {
    gcRunning = false;
  }
}

interface MaterializationGcRow {
  id: string;
  scope: string;
  scope_id: string;
  active_path: string;
  bytes: number;
}

interface CacheGcRow {
  content_hash: string;
  cache_path: string;
  bytes: number;
  last_used_at: number;
}

interface GeneratedDerivativeGcRow {
  file_path: string;
  bytes: number;
}

async function sweepMaterializations(
  db: ReturnType<typeof getDatabase>,
  workspaceRoot: string,
) {
  if (!tableExists(db, 'asset_materializations')) {
    return emptySweepResult();
  }
  const rows = db
    .prepare(
      `SELECT id, scope, scope_id, active_path, bytes
       FROM asset_materializations
       ORDER BY created_at ASC`,
    )
    .all() as MaterializationGcRow[];
  let rowsPurged = 0;
  let filesDeleted = 0;
  let bytesFreed = 0;
  const errors: Array<{ assetId: string; message: string }> = [];
  for (const row of rows) {
    try {
      const status = await workspaceFileStatus(row.active_path, workspaceRoot);
      if (status === 'missing') {
        db.prepare('DELETE FROM asset_materializations WHERE id = ?').run(
          row.id,
        );
        rowsPurged += 1;
        continue;
      }
      if (status === 'outside') continue;
      if (status !== 'file') {
        errors.push({
          assetId: row.id,
          message: 'Materialized asset path is not a file',
        });
        continue;
      }
      if (scopeExists(db, workspaceRoot, row.scope, row.scope_id)) continue;
      await unlinkWorkspaceFile(row.active_path, workspaceRoot);
      db.prepare('DELETE FROM asset_materializations WHERE id = ?').run(row.id);
      rowsPurged += 1;
      filesDeleted += 1;
      bytesFreed += row.bytes;
    } catch (error) {
      errors.push({
        assetId: row.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { rowsPurged, filesDeleted, bytesFreed, errors };
}

async function sweepCache(
  db: ReturnType<typeof getDatabase>,
  workspaceRoot: string,
  now: number,
) {
  if (
    !tableExists(db, 'asset_cache') ||
    !tableExists(db, 'asset_materializations')
  ) {
    return emptySweepResult();
  }
  const missing = await sweepMissingCacheFiles(db, workspaceRoot);
  const ttlDays = settingNumberFromDb(db, 'assets.cache_ttl_days', 90);
  const maxBytes = settingNumberFromDb(
    db,
    'assets.cache_max_bytes',
    53_687_091_200,
  );
  const ttlCutoff = now - Math.max(0, ttlDays) * DAY_MS;
  const unreferenced = db
    .prepare(
      `SELECT c.content_hash, c.cache_path, c.bytes, c.last_used_at
       FROM asset_cache c
       LEFT JOIN asset_materializations m ON m.content_hash = c.content_hash
       WHERE m.id IS NULL
       ORDER BY c.last_used_at ASC`,
    )
    .all() as CacheGcRow[];
  let runningBytes = cacheManagedBytes(db);
  const toEvict = unreferenced.filter((row) => {
    const managedBytes = cacheRowManagedBytes(db, row);
    if (row.last_used_at < ttlCutoff) {
      runningBytes -= managedBytes;
      return true;
    }
    if (maxBytes > 0 && runningBytes > maxBytes) {
      runningBytes -= managedBytes;
      return true;
    }
    return false;
  });
  let rowsPurged = 0;
  let filesDeleted = 0;
  let bytesFreed = 0;
  const errors: Array<{ assetId: string; message: string }> = [];
  for (const row of toEvict) {
    try {
      await unlinkWorkspaceFile(row.cache_path, workspaceRoot);
      const derivatives = await purgeGeneratedDerivativesForCache(
        db,
        workspaceRoot,
        row.content_hash,
      );
      db.prepare('DELETE FROM asset_cache WHERE content_hash = ?').run(
        row.content_hash,
      );
      rowsPurged += 1;
      filesDeleted += 1 + derivatives.filesDeleted;
      bytesFreed += row.bytes + derivatives.bytesFreed;
      errors.push(...derivatives.errors);
    } catch (error) {
      errors.push({
        assetId: row.content_hash,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return combineSweepResults(missing, {
    rowsPurged,
    filesDeleted,
    bytesFreed,
    errors,
  });
}

async function sweepMissingCacheFiles(
  db: ReturnType<typeof getDatabase>,
  workspaceRoot: string,
) {
  const rows = db
    .prepare(
      `SELECT content_hash, cache_path, bytes, last_used_at
       FROM asset_cache
       ORDER BY last_used_at ASC`,
    )
    .all() as CacheGcRow[];
  let rowsPurged = 0;
  let filesDeleted = 0;
  let bytesFreed = 0;
  const errors: Array<{ assetId: string; message: string }> = [];
  for (const row of rows) {
    try {
      const status = await workspaceFileStatus(row.cache_path, workspaceRoot);
      if (status === 'missing') {
        const derivatives = await purgeGeneratedDerivativesForCache(
          db,
          workspaceRoot,
          row.content_hash,
        );
        db.prepare('DELETE FROM asset_cache WHERE content_hash = ?').run(
          row.content_hash,
        );
        rowsPurged += 1;
        filesDeleted += derivatives.filesDeleted;
        bytesFreed += derivatives.bytesFreed;
        errors.push(...derivatives.errors);
        continue;
      }
      if (status === 'outside') continue;
      if (status !== 'file') {
        errors.push({
          assetId: row.content_hash,
          message: 'Cache path is not a file',
        });
      }
    } catch (error) {
      errors.push({
        assetId: row.content_hash,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { rowsPurged, filesDeleted, bytesFreed, errors };
}

async function purgeGeneratedDerivativesForCache(
  db: ReturnType<typeof getDatabase>,
  workspaceRoot: string,
  contentHash: string,
) {
  const rows: GeneratedDerivativeGcRow[] = [];
  if (tableExists(db, 'asset_proxies')) {
    rows.push(
      ...((db
        .prepare(
          `SELECT proxy_path AS file_path, bytes
           FROM asset_proxies
           WHERE content_hash = ?`,
        )
        .all(contentHash) as GeneratedDerivativeGcRow[]) ?? []),
    );
  }
  if (tableExists(db, 'asset_preview_artifacts')) {
    rows.push(
      ...((db
        .prepare(
          `SELECT data_path AS file_path, bytes
           FROM asset_preview_artifacts
           WHERE content_hash = ?`,
        )
        .all(contentHash) as GeneratedDerivativeGcRow[]) ?? []),
    );
  }

  let filesDeleted = 0;
  let bytesFreed = 0;
  const errors: Array<{ assetId: string; message: string }> = [];
  for (const row of rows) {
    try {
      const status = await workspaceFileStatus(row.file_path, workspaceRoot);
      if (status === 'missing' || status === 'outside') continue;
      if (status !== 'file') {
        errors.push({
          assetId: contentHash,
          message: 'Generated derivative path is not a file',
        });
        continue;
      }
      await unlinkWorkspaceFile(row.file_path, workspaceRoot);
      filesDeleted += 1;
      bytesFreed += row.bytes;
    } catch (error) {
      errors.push({
        assetId: contentHash,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (tableExists(db, 'asset_proxies')) {
    db.prepare('DELETE FROM asset_proxies WHERE content_hash = ?').run(
      contentHash,
    );
  }
  if (tableExists(db, 'asset_preview_artifacts')) {
    db.prepare(
      'DELETE FROM asset_preview_artifacts WHERE content_hash = ?',
    ).run(contentHash);
  }
  return { rowsPurged: 0, filesDeleted, bytesFreed, errors };
}

async function sweepPartialDownloadsFiles(options: {
  maxAgeMs: number;
  now: number;
  workspaceRoot: string;
}) {
  const remoteRoot = path.join(
    options.workspaceRoot,
    '.cache',
    'assets',
    'remote',
  );
  const files = await listPartialFiles(remoteRoot);
  let filesDeleted = 0;
  let bytesFreed = 0;
  const errors: Array<{ assetId: string; message: string }> = [];
  for (const filePath of files) {
    try {
      const resolved = resolveWorkspaceFile(filePath, options.workspaceRoot);
      const stat = await fs.stat(resolved);
      if (options.now - stat.mtimeMs < options.maxAgeMs) continue;
      await fs.rm(resolved, { force: true });
      filesDeleted += 1;
      bytesFreed += stat.size;
    } catch (error) {
      errors.push({
        assetId: filePath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { rowsPurged: 0, filesDeleted, bytesFreed, errors };
}

async function listPartialFiles(dir: string): Promise<string[]> {
  const entries = await fs
    .readdir(dir, { withFileTypes: true })
    .catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listPartialFiles(entryPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.partial')) {
      files.push(entryPath);
    }
  }
  return files;
}

function scopeExists(
  db: ReturnType<typeof getDatabase>,
  workspaceRoot: string,
  scope: string,
  scopeId: string,
): boolean {
  if (scope === 'design_project') {
    return Boolean(
      db.prepare('SELECT id FROM design_projects WHERE id = ?').get(scopeId),
    );
  }
  if (scope === 'video_project') {
    return fileExists(
      path.join(workspaceRoot, 'videos', scopeId, 'project.json'),
    );
  }
  return true;
}

function fileExists(filePath: string): boolean {
  return existsSync(filePath);
}

function tableExists(
  db: ReturnType<typeof getDatabase>,
  table: string,
): boolean {
  return Boolean(
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get(table),
  );
}

function settingNumberFromDb(
  db: ReturnType<typeof getDatabase>,
  key: string,
  fallback: number,
): number {
  if (!tableExists(db, 'settings')) return fallback;
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key) as { value: string | null } | undefined;
  const parsed = Number(row?.value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cacheManagedBytes(db: ReturnType<typeof getDatabase>): number {
  let bytes = sumTableBytes(db, 'asset_cache');
  bytes += sumTableBytes(db, 'asset_proxies');
  bytes += sumTableBytes(db, 'asset_preview_artifacts');
  return bytes;
}

function cacheRowManagedBytes(
  db: ReturnType<typeof getDatabase>,
  row: CacheGcRow,
): number {
  return (
    row.bytes +
    generatedDerivativeBytesForHash(db, 'asset_proxies', row.content_hash) +
    generatedDerivativeBytesForHash(
      db,
      'asset_preview_artifacts',
      row.content_hash,
    )
  );
}

function generatedDerivativeBytesForHash(
  db: ReturnType<typeof getDatabase>,
  table: string,
  contentHash: string,
): number {
  if (!tableExists(db, table)) return 0;
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(bytes), 0) AS bytes
       FROM ${table}
       WHERE content_hash = ?`,
    )
    .get(contentHash) as { bytes: number };
  return row.bytes;
}

function sumTableBytes(
  db: ReturnType<typeof getDatabase>,
  table: string,
): number {
  if (!tableExists(db, table)) return 0;
  const row = db
    .prepare(`SELECT COALESCE(SUM(bytes), 0) AS bytes FROM ${table}`)
    .get() as { bytes: number };
  return row.bytes;
}

function emptySweepResult() {
  return {
    rowsPurged: 0,
    filesDeleted: 0,
    bytesFreed: 0,
    errors: [] as Array<{ assetId: string; message: string }>,
  };
}

function combineSweepResults(
  first: ReturnType<typeof emptySweepResult>,
  second: ReturnType<typeof emptySweepResult>,
) {
  return {
    rowsPurged: first.rowsPurged + second.rowsPurged,
    filesDeleted: first.filesDeleted + second.filesDeleted,
    bytesFreed: first.bytesFreed + second.bytesFreed,
    errors: [...first.errors, ...second.errors],
  };
}

async function workspaceFileStatus(
  filePath: string,
  workspaceRoot: string,
): Promise<'file' | 'missing' | 'other' | 'outside'> {
  const resolved = path.resolve(filePath);
  if (!isInsideWorkspace(resolved, workspaceRoot)) return 'outside';
  const stat = await fs.stat(resolved).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (!stat) return 'missing';
  if (stat.isFile()) return 'file';
  return 'other';
}

async function unlinkWorkspaceFile(
  filePath: string,
  workspaceRoot: string,
): Promise<void> {
  const resolved = resolveWorkspaceFile(filePath, workspaceRoot);
  await fs.rm(resolved, { force: true });
}

function resolveWorkspaceFile(filePath: string, workspaceRoot: string): string {
  const resolved = path.resolve(filePath);
  if (!isInsideWorkspace(resolved, workspaceRoot)) {
    throw new Error('Refusing to delete asset file outside workspace');
  }
  return resolved;
}

function isInsideWorkspace(
  resolvedPath: string,
  workspaceRoot: string,
): boolean {
  const root = path.resolve(workspaceRoot);
  return resolvedPath === root || resolvedPath.startsWith(`${root}${path.sep}`);
}
