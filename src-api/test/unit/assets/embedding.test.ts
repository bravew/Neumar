import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  AssetEmbeddingService,
  AssetSearchService,
  createAssetIndexer,
  createAssetRegistry,
  drainAssetJobs,
  type ActiveEmbeddingConfig,
} from '@/shared/assets';
import { migration as migration001 } from '@/shared/db/migrations/001_init';
import { migration as migration034 } from '@/shared/db/migrations/034_assets_catalog';
import { runMigrations } from '@/shared/db/migrations/runner';

import { createTestDb } from '../../helpers/db';

let workspaceRoot: string;

describe('asset embeddings and hybrid search', () => {
  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'assets-embed-'));
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('stores text embeddings and finds semantic matches when FTS has no hit', async () => {
    const { db, cleanup } = createTestDb();
    try {
      runMigrations(db, [migration001, migration034]);
      const embedding = new AssetEmbeddingService({
        db,
        localTextModelReady: () => true,
        textEmbedder: fakeTextEmbedder,
      });
      const registry = createAssetRegistry({
        db,
        getWorkspaceRoot: () => workspaceRoot,
      });
      const indexer = createAssetIndexer({
        db,
        registry,
        embedding,
        getWorkspaceRoot: () => workspaceRoot,
      });
      await fs.writeFile(
        path.join(workspaceRoot, 'red-photo.txt'),
        'scarlet skyline photograph',
      );
      await fs.writeFile(
        path.join(workspaceRoot, 'ledger.txt'),
        'quarterly ledger',
      );
      const red = await registry.ingest({
        source: 'local_fs',
        storagePath: 'red-photo.txt',
      });
      await registry.ingest({ source: 'local_fs', storagePath: 'ledger.txt' });

      await drainAssetJobs(10, { db, indexer });

      const rows = db
        .prepare(`SELECT asset_id, modality, model, dim FROM asset_embeddings`)
        .all();
      expect(rows).toHaveLength(2);
      expect(
        db.prepare(`SELECT COUNT(*) AS count FROM assets_vec_768`).get(),
      ).toEqual({ count: 2 });

      const search = new AssetSearchService({ db, registry, embedding });
      const result = await search.search({
        text: 'sunset city',
        semantic: true,
      });

      expect(result.items[0]?.asset.id).toBe(red.asset.id);
      expect(result.items[0]?.scoreBreakdown).toMatchObject({
        fts: 0,
        vector: expect.any(Number),
      });
    } finally {
      cleanup();
    }
  });

  it('excludes old vectors and queues reencode after a model swap', async () => {
    const { db, cleanup } = createTestDb();
    try {
      runMigrations(db, [migration001, migration034]);
      const embedding = new AssetEmbeddingService({
        db,
        localTextModelReady: () => true,
        textEmbedder: fakeTextEmbedder,
      });
      const registry = createAssetRegistry({
        db,
        getWorkspaceRoot: () => workspaceRoot,
      });
      const indexer = createAssetIndexer({
        db,
        registry,
        embedding,
        getWorkspaceRoot: () => workspaceRoot,
      });
      await fs.writeFile(
        path.join(workspaceRoot, 'red-photo.txt'),
        'scarlet skyline photograph',
      );
      await registry.ingest({
        source: 'local_fs',
        storagePath: 'red-photo.txt',
      });
      await drainAssetJobs(10, { db, indexer });

      db.prepare(
        `INSERT OR REPLACE INTO settings (key, value, updated_at)
         VALUES ('assets.embedding_model', 'new-text-model', datetime('now'))`,
      ).run();

      const search = new AssetSearchService({ db, registry, embedding });
      const result = await search.search({
        text: 'sunset city',
        semantic: true,
      });

      expect(result.items).toHaveLength(0);
      expect(
        db
          .prepare(
            `SELECT model, reencode_status
             FROM assets_embedding_config
             WHERE modality = 'text'`,
          )
          .get(),
      ).toEqual({ model: 'new-text-model', reencode_status: 'running' });
      expect(
        db
          .prepare(
            `SELECT kind, status, payload_json
             FROM asset_jobs
             WHERE kind = 'reencode'`,
          )
          .all(),
      ).toEqual([
        {
          kind: 'reencode',
          status: 'queued',
          payload_json: JSON.stringify({ modality: 'text' }),
        },
      ]);
    } finally {
      cleanup();
    }
  });

  it('applies SQL filters before the FTS candidate cap', async () => {
    const { db, cleanup } = createTestDb();
    try {
      runMigrations(db, [migration001, migration034]);
      const registry = createAssetRegistry({
        db,
        getWorkspaceRoot: () => workspaceRoot,
      });
      const now = Date.now();
      const insertAsset = db.prepare(
        `INSERT INTO assets (
          id, source, kind, mime, bytes, title, imported_at, modified_at, index_state
        )
        VALUES (?, 'local_fs', 'text', 'text/plain', 1, ?, ?, ?, 'embedded')`,
      );
      const insertTag = db.prepare(
        `INSERT INTO asset_tags (asset_id, tag) VALUES (?, ?)`,
      );
      const insertFts = db.prepare(
        `INSERT INTO assets_fts
         (asset_id, title, description, caption, ocr_text, transcript, tag_blob)
         VALUES (?, ?, '', '', '', '', ?)`,
      );
      for (let i = 0; i < 200; i += 1) {
        const id = `asset-noise-${i}`;
        const title = 'sunset sunset sunset high ranking note';
        insertAsset.run(id, title, now - i, now - i);
        insertTag.run(id, 'noise');
        insertFts.run(id, title, 'noise');
      }
      insertAsset.run('asset-target', 'sunset', now - 201, now - 201);
      insertTag.run('asset-target', 'target');
      insertFts.run('asset-target', 'sunset', 'target');
      const search = new AssetSearchService({
        db,
        registry,
        remoteSearch: async () => null,
      });

      const result = await search.search({
        text: 'sunset',
        semantic: false,
        tags: ['target'],
      });

      expect(result.items.map((item) => item.asset.id)).toEqual([
        'asset-target',
      ]);
    } finally {
      cleanup();
    }
  });
});

function fakeTextEmbedder(
  text: string,
  _config: ActiveEmbeddingConfig,
): Promise<Float32Array> {
  const lower = text.toLowerCase();
  const vector = new Float32Array(768);
  if (
    lower.includes('scarlet') ||
    lower.includes('skyline') ||
    lower.includes('sunset') ||
    lower.includes('city')
  ) {
    vector[0] = 1;
  } else {
    vector[1] = 1;
  }
  return Promise.resolve(vector);
}
