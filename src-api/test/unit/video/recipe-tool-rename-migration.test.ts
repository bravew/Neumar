import { describe, expect, it } from 'vitest';

import { migration as migration032 } from '@/shared/db/migrations/032_video_conversation_mode';
import { migration as migration033 } from '@/shared/db/migrations/033_video_recipe_tool_rename';
import { runMigrations } from '@/shared/db/migrations/runner';

import { createTestDb } from '../../helpers/db';

describe('migration 033 video recipe tool rename', () => {
  it('renames built-in recipe tool sequence entries to video MCP names', () => {
    const { db, cleanup } = createTestDb();
    try {
      runMigrations(db, [migration032]);

      db.prepare(
        `
          INSERT INTO video_recipes (
            id,
            name,
            version,
            system_prompt,
            tool_sequence_json,
            defaults_json,
            output_preset,
            input_schema_json,
            is_builtin,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
        `,
      ).run(
        'custom',
        'Custom',
        1,
        'custom prompt',
        JSON.stringify([{ tool: 'propose_music', input: {} }]),
        '{}',
        'custom',
        '{}',
        '2026-05-31T00:00:00.000Z',
        '2026-05-31T00:00:00.000Z',
      );

      runMigrations(db, [migration033]);

      const builtInRows = db
        .prepare(
          `SELECT tool_sequence_json FROM video_recipes WHERE is_builtin = 1`,
        )
        .all() as Array<{ tool_sequence_json: string }>;
      const builtInJson = JSON.stringify(
        builtInRows.map((row) => JSON.parse(row.tool_sequence_json)),
      );
      expect(builtInJson).toContain('video_propose_timeline_ops');
      expect(builtInJson).toContain('video_generate_music');
      expect(builtInJson).toContain('video_add_captions');
      expect(builtInJson).not.toContain('propose_music');
      expect(builtInJson).not.toContain('subtitle_upsert');

      const costTable = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'video_session_cost'`,
        )
        .get() as { name: string } | undefined;
      expect(costTable?.name).toBe('video_session_cost');

      const custom = db
        .prepare(
          `SELECT tool_sequence_json FROM video_recipes WHERE id = 'custom'`,
        )
        .get() as { tool_sequence_json: string };
      expect(custom.tool_sequence_json).toContain('propose_music');
    } finally {
      cleanup();
    }
  });

  it('is idempotent — running twice leaves built-in recipes unchanged', () => {
    const { db, cleanup } = createTestDb();
    try {
      runMigrations(db, [migration032, migration033]);

      const snapshotAfterFirst = db
        .prepare(
          `SELECT id, tool_sequence_json FROM video_recipes WHERE is_builtin = 1 ORDER BY id`,
        )
        .all() as Array<{ id: string; tool_sequence_json: string }>;

      // Re-running the migration must not produce additional rewrites.
      migration033.up(db);

      const snapshotAfterSecond = db
        .prepare(
          `SELECT id, tool_sequence_json FROM video_recipes WHERE is_builtin = 1 ORDER BY id`,
        )
        .all() as Array<{ id: string; tool_sequence_json: string }>;

      expect(snapshotAfterSecond).toEqual(snapshotAfterFirst);
    } finally {
      cleanup();
    }
  });
});
