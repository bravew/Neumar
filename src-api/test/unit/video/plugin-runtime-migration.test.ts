import { describe, expect, it } from 'vitest';

import { migration as migration001 } from '@/shared/db/migrations/001_init';
import { migration as migration005 } from '@/shared/db/migrations/005_plugins';
import { migration as migration038 } from '@/shared/db/migrations/038_plugin_runtime_trust';
import { migration as migration040 } from '@/shared/db/migrations/040_video_plugin_candidate_source_id';
import { migration as migration043 } from '@/shared/db/migrations/043_plugin_config';
import { migration as migration044 } from '@/shared/db/migrations/044_task_plugin_snapshot';
import { runMigrations } from '@/shared/db/migrations/runner';

import { createTestDb } from '../../helpers/db';

describe('migration 095 plugin runtime trust', () => {
  it('adds host trust columns and video plugin candidates', () => {
    const { db, cleanup } = createTestDb();
    try {
      runMigrations(db, [migration001, migration005, migration038]);

      const installedColumns = db
        .prepare('PRAGMA table_info(installed_plugins)')
        .all() as Array<{ name: string }>;
      expect(installedColumns.map((column) => column.name)).toEqual(
        expect.arrayContaining([
          'trust_tier',
          'manifest_digest',
          'last_reviewed_digest',
        ]),
      );

      const candidateTable = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'video_plugin_candidates'`,
        )
        .get() as { name: string } | undefined;
      expect(candidateTable?.name).toBe('video_plugin_candidates');

      runMigrations(db, [migration040]);
      const candidateColumns = db
        .prepare('PRAGMA table_info(video_plugin_candidates)')
        .all() as Array<{ name: string }>;
      expect(candidateColumns.map((column) => column.name)).toContain(
        'source_plugin_id',
      );

      runMigrations(db, [migration043]);
      const configTable = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'plugin_config_values'`,
        )
        .get() as { name: string } | undefined;
      expect(configTable?.name).toBe('plugin_config_values');
      const configColumns = db
        .prepare('PRAGMA table_info(plugin_config_values)')
        .all() as Array<{ name: string }>;
      expect(configColumns.map((column) => column.name)).toEqual(
        expect.arrayContaining([
          'plugin_id',
          'key',
          'value_json',
          'secret_name',
        ]),
      );

      runMigrations(db, [migration044]);
      const taskColumns = db
        .prepare('PRAGMA table_info(tasks)')
        .all() as Array<{ name: string }>;
      expect(taskColumns.map((column) => column.name)).toEqual(
        expect.arrayContaining([
          'applied_plugin_id',
          'applied_plugin_snapshot_json',
        ]),
      );
    } finally {
      cleanup();
    }
  });
});
