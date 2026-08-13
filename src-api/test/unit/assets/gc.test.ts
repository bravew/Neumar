import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AssetRegistry, runAssetGarbageCollection } from '@/shared/assets';
import { migration as migration001 } from '@/shared/db/migrations/001_init';
import { migration as migration034 } from '@/shared/db/migrations/034_assets_catalog';
import { migration as migration035 } from '@/shared/db/migrations/035_assets_materialization';
import { runMigrations } from '@/shared/db/migrations/runner';

import { createTestDb } from '../../helpers/db';

describe('asset garbage collection', () => {
  let workDir: string;
  let registry: AssetRegistry;
  let assetIds: string[];
  let db: ReturnType<typeof createTestDb>['db'];
  let cleanupDb: () => void;

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'assets-gc-'));
    assetIds = [];
    const testDb = createTestDb();
    db = testDb.db;
    cleanupDb = testDb.cleanup;
    runMigrations(db, [migration001, migration034, migration035]);
    registry = new AssetRegistry({ db, getWorkspaceRoot: () => workDir });
  });

  afterEach(async () => {
    for (const assetId of assetIds) {
      db.prepare('DELETE FROM asset_materializations WHERE asset_id = ?').run(
        assetId,
      );
      db.prepare('DELETE FROM assets WHERE id = ?').run(assetId);
    }
    cleanupDb();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('removes stale partial downloads while preserving fresh in-flight files', async () => {
    const now = 1_700_000_000_000;
    const remoteDir = path.join(
      workDir,
      '.cache',
      'assets',
      'remote',
      'pexels',
    );
    const stale = path.join(remoteDir, 'stale.partial');
    const fresh = path.join(remoteDir, 'fresh.partial');
    await fs.mkdir(remoteDir, { recursive: true });
    await fs.writeFile(stale, 'stale');
    await fs.writeFile(fresh, 'fresh');
    await fs.utimes(
      stale,
      new Date(now - 2 * 60 * 60 * 1000),
      new Date(now - 2 * 60 * 60 * 1000),
    );
    await fs.utimes(fresh, new Date(now - 1000), new Date(now - 1000));

    const result = await runAssetGarbageCollection({
      db,
      registry,
      now,
      partialMaxAgeMs: 60_000,
      sweepMaterializedAssets: false,
      workspaceRoot: workDir,
    });

    expect(result).toMatchObject({
      partialFilesPurged: 1,
      filesDeleted: 1,
      bytesFreed: 5,
      errors: [],
    });
    await expect(fs.access(stale)).rejects.toThrow();
    await expect(fs.access(fresh)).resolves.toBeUndefined();
  });

  it('reconciles missing materialization active files and cache rows', async () => {
    const now = 1_700_000_000_000;
    const { asset } = registry.upsertRemote({
      source: 'pexels',
      connectionId: `pexels-${randomUUID()}`,
      sourceId: `photo-${randomUUID()}`,
      kind: 'image',
      mime: 'image/png',
      bytes: 12,
      title: 'Missing active copy.png',
    });
    assetIds.push(asset.id);

    const contentHash = 'b'.repeat(64);
    const cachePath = path.join(
      workDir,
      '.cache',
      'assets',
      'remote',
      'pexels',
      'missing.png',
    );
    const proxyPath = path.join(
      workDir,
      '.cache',
      'assets',
      'proxies',
      contentHash,
      'edit_1080p.webm',
    );
    const posterPath = path.join(
      workDir,
      '.cache',
      'assets',
      'artifacts',
      contentHash,
      'poster.jpg',
    );
    const activePath = path.join(workDir, 'agent', 'missing-active.png');
    await fs.mkdir(path.dirname(proxyPath), { recursive: true });
    await fs.mkdir(path.dirname(posterPath), { recursive: true });
    await fs.writeFile(proxyPath, 'proxy');
    await fs.writeFile(posterPath, 'poster');
    db.prepare(
      `INSERT OR REPLACE INTO asset_cache (
        content_hash, cache_path, bytes, mime, fetched_at, last_used_at,
        origin_provider, origin_connection_id, origin_source_id,
        source_file_hint_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      contentHash,
      cachePath,
      12,
      'image/png',
      now,
      now,
      asset.source,
      asset.connectionId,
      asset.sourceId,
      null,
    );
    db.prepare(
      `INSERT INTO asset_proxies (
        content_hash, preset, proxy_path, bytes, generated_at, last_used_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(contentHash, 'edit_1080p', proxyPath, 5, now, now);
    db.prepare(
      `INSERT INTO asset_preview_artifacts (
        content_hash, kind, data_path, bytes, generated_at
      ) VALUES (?, ?, ?, ?, ?)`,
    ).run(contentHash, 'poster', posterPath, 6, now);
    db.prepare(
      `INSERT INTO asset_materializations (
        id, asset_id, scope, scope_id, active_path, content_hash, bytes,
        created_at, license_snapshot_json, client_request_id, role
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      `mat-${randomUUID()}`,
      asset.id,
      'agent_session',
      'session-missing',
      activePath,
      contentHash,
      12,
      now,
      null,
      null,
      null,
    );

    const result = await runAssetGarbageCollection({
      db,
      registry,
      now,
      sweepPartialDownloads: false,
      workspaceRoot: workDir,
    });

    expect(result.materializationsPurged).toBeGreaterThanOrEqual(1);
    expect(result.cacheRowsPurged).toBeGreaterThanOrEqual(1);
    expect(result.filesDeleted).toBeGreaterThanOrEqual(2);
    expect(result.bytesFreed).toBeGreaterThanOrEqual(11);
    expect(result.errors).toEqual([]);
    await expect(fs.access(proxyPath)).rejects.toThrow();
    await expect(fs.access(posterPath)).rejects.toThrow();
    expect(
      db
        .prepare('SELECT id FROM asset_materializations WHERE asset_id = ?')
        .get(asset.id),
    ).toBeUndefined();
    expect(
      db
        .prepare('SELECT content_hash FROM asset_cache WHERE content_hash = ?')
        .get(contentHash),
    ).toBeUndefined();
    expect(
      db
        .prepare(
          'SELECT content_hash FROM asset_proxies WHERE content_hash = ?',
        )
        .get(contentHash),
    ).toBeUndefined();
    expect(
      db
        .prepare(
          'SELECT content_hash FROM asset_preview_artifacts WHERE content_hash = ?',
        )
        .get(contentHash),
    ).toBeUndefined();
  });

  it('evicts a 100-row cache set by TTL before applying the size cap', async () => {
    const now = 1_700_000_000_000;
    db.prepare("UPDATE settings SET value = '30' WHERE key = ?").run(
      'assets.cache_ttl_days',
    );
    db.prepare("UPDATE settings SET value = '650' WHERE key = ?").run(
      'assets.cache_max_bytes',
    );

    const cacheDir = path.join(workDir, '.cache', 'assets', 'remote', 'box');
    const proxyDir = path.join(workDir, '.cache', 'assets', 'proxies');
    const artifactDir = path.join(workDir, '.cache', 'assets', 'artifacts');
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.mkdir(proxyDir, { recursive: true });
    await fs.mkdir(artifactDir, { recursive: true });

    for (let index = 0; index < 100; index += 1) {
      const contentHash = contentHashForIndex(index);
      const cachePath = path.join(cacheDir, `${contentHash}.bin`);
      await fs.writeFile(cachePath, Buffer.alloc(10, index));
      const lastUsedAt =
        index < 20 ? now - 31 * DAY_MS - index : now - (100 - index);
      db.prepare(
        `INSERT INTO asset_cache (
          content_hash, cache_path, bytes, mime, fetched_at, last_used_at,
          origin_provider, origin_connection_id, origin_source_id,
          source_file_hint_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        contentHash,
        cachePath,
        10,
        'application/octet-stream',
        now - 60 * DAY_MS,
        lastUsedAt,
        'box',
        'box-gc-fixture',
        `source-${index}`,
        null,
      );

      if (index < 5) {
        const proxyPath = path.join(proxyDir, `${contentHash}.webm`);
        const artifactPath = path.join(artifactDir, `${contentHash}.jsonl`);
        await fs.writeFile(proxyPath, Buffer.alloc(2, index));
        await fs.writeFile(artifactPath, Buffer.alloc(3, index));
        db.prepare(
          `INSERT INTO asset_proxies (
            content_hash, preset, proxy_path, bytes, generated_at, last_used_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(contentHash, 'edit_1080p', proxyPath, 2, now, lastUsedAt);
        db.prepare(
          `INSERT INTO asset_preview_artifacts (
            content_hash, kind, data_path, bytes, generated_at
          ) VALUES (?, ?, ?, ?, ?)`,
        ).run(contentHash, 'filmstrip', artifactPath, 3, now);
      }
    }

    const result = await runAssetGarbageCollection({
      db,
      registry,
      now,
      sweepPartialDownloads: false,
      workspaceRoot: workDir,
    });

    expect(result).toMatchObject({
      cacheRowsPurged: 35,
      filesDeleted: 45,
      bytesFreed: 375,
      errors: [],
    });
    expect(countTableRows(db, 'asset_cache')).toBe(65);
    expect(countTableRows(db, 'asset_proxies')).toBe(0);
    expect(countTableRows(db, 'asset_preview_artifacts')).toBe(0);
    expect(
      db
        .prepare(
          `SELECT origin_source_id
           FROM asset_cache
           ORDER BY last_used_at ASC
           LIMIT 1`,
        )
        .get(),
    ).toEqual({ origin_source_id: 'source-35' });
  });
});

const DAY_MS = 24 * 60 * 60 * 1000;

function contentHashForIndex(index: number): string {
  return index.toString(16).padStart(64, '0');
}

function countTableRows(
  db: ReturnType<typeof createTestDb>['db'],
  table: string,
): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    count: number;
  };
  return row.count;
}
