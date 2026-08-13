import { describe, expect, it } from 'vitest';

import { migration as migration001 } from '@/shared/db/migrations/001_init';
import { migration as migration033 } from '@/shared/db/migrations/033_video_recipe_tool_rename';
import { migration as migration034 } from '@/shared/db/migrations/034_assets_catalog';
import { migration as migration035 } from '@/shared/db/migrations/035_assets_materialization';
import { runMigrations } from '@/shared/db/migrations/runner';

import { createTestDb } from '../../helpers/db';

describe('assets catalog migration', () => {
  it('continues after older databases that lack video_recipes', () => {
    const { db, cleanup } = createTestDb();
    try {
      runMigrations(db, [migration001, migration033, migration034]);

      expect(
        db
          .prepare(`SELECT name FROM sqlite_master WHERE name = 'assets'`)
          .get(),
      ).toBeTruthy();
    } finally {
      cleanup();
    }
  });

  it('creates the catalog tables and seeds rollout settings', () => {
    const { db, cleanup } = createTestDb();
    try {
      runMigrations(db, [migration001, migration034]);

      const tables = db
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type IN ('table', 'virtual table')
           ORDER BY name`,
        )
        .all() as { name: string }[];
      const tableNames = new Set(tables.map((row) => row.name));

      expect(tableNames.has('assets')).toBe(true);
      expect(tableNames.has('asset_tags')).toBe(true);
      expect(tableNames.has('asset_attachments')).toBe(true);
      expect(tableNames.has('asset_jobs')).toBe(true);
      expect(tableNames.has('asset_accounts')).toBe(false);

      const settings = db
        .prepare(
          `SELECT key, value FROM settings
           WHERE key IN ('assets.catalog_enabled', 'assets.vec_available')
           ORDER BY key`,
        )
        .all() as { key: string; value: string }[];
      // `assets.catalog_enabled` is intentionally not seeded — the opt-out flag
      // defaults to enabled when absent. Only `assets.vec_available` is written.
      expect(settings).toEqual([
        {
          key: 'assets.vec_available',
          value: expect.stringMatching(/^(true|false)$/),
        },
      ]);

      const configs = db
        .prepare(
          `SELECT modality, model, dim, reencode_status
           FROM assets_embedding_config
           ORDER BY modality`,
        )
        .all();
      expect(configs).toEqual([
        {
          modality: 'image',
          model: null,
          dim: null,
          reencode_status: 'idle',
        },
        {
          modality: 'text',
          model: 'gte-multilingual-base',
          dim: 768,
          reencode_status: 'idle',
        },
      ]);
    } finally {
      cleanup();
    }
  });

  it('creates materialization cache tables and seeds budget settings', () => {
    const { db, cleanup } = createTestDb();
    try {
      runMigrations(db, [migration001, migration034, migration035]);

      const tables = db
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'table'
             AND name IN (
               'asset_cache',
               'asset_materializations',
               'asset_proxies',
               'asset_preview_artifacts'
             )
           ORDER BY name`,
        )
        .all();
      expect(tables).toEqual([
        { name: 'asset_cache' },
        { name: 'asset_materializations' },
        { name: 'asset_preview_artifacts' },
        { name: 'asset_proxies' },
      ]);

      const settings = db
        .prepare(
          `SELECT key, value FROM settings
           WHERE key IN (
             'assets.materialize_session_budget_bytes',
             'assets.materialize_project_budget_bytes',
             'assets.cache_max_bytes',
             'assets.cache_ttl_days',
             'assets.materialize_concurrency',
             'assets.proxy_thresholds_json',
             'assets.range_download_min_bytes'
           )
           ORDER BY key`,
        )
        .all();
      expect(settings).toEqual([
        { key: 'assets.cache_max_bytes', value: '53687091200' },
        { key: 'assets.cache_ttl_days', value: '90' },
        { key: 'assets.materialize_concurrency', value: '3' },
        {
          key: 'assets.materialize_project_budget_bytes',
          value: '21474836480',
        },
        { key: 'assets.materialize_session_budget_bytes', value: '5368709120' },
        {
          key: 'assets.proxy_thresholds_json',
          value:
            '{"minPixelCount":8294400,"minDurationSeconds":600,"minBytes":524288000}',
        },
        { key: 'assets.range_download_min_bytes', value: '33554432' },
      ]);
    } finally {
      cleanup();
    }
  });
});
