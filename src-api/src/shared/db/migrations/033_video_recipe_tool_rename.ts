import type Database from 'better-sqlite3';

import type { Migration } from './runner';

const TOOL_RENAMES: Record<string, string> = {
  analyze_source: 'video_describe_scene',
  transcribe: 'video_add_captions',
  propose_timeline_ops: 'video_propose_timeline_ops',
  propose_music: 'video_generate_music',
  propose_auto_cuts: 'video_propose_timeline_ops',
  propose_broll: 'video_generate_broll',
  auto_color: 'video_restyle',
  auto_reframe: 'video_reframe',
  subtitle_upsert: 'video_add_captions',
  transition_set: 'video_set_transition',
  rank_moments: 'video_rank_moments',
};

interface RecipeRow {
  id: string;
  version: number;
  tool_sequence_json: string;
}

export const migration: Migration = {
  version: 90,
  description: 'Rename built-in video recipe tools and add session cost log',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS video_session_cost (
        project_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        cost_usd REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, session_id)
      );
    `);

    if (!tableExists(db, 'video_recipes')) return;

    const rows = db
      .prepare(
        `
          SELECT id, version, tool_sequence_json
          FROM video_recipes
          WHERE is_builtin = 1
        `,
      )
      .all() as RecipeRow[];

    const update = db.prepare(
      `
        UPDATE video_recipes
        SET tool_sequence_json = ?, updated_at = ?
        WHERE id = ? AND version = ? AND is_builtin = 1
      `,
    );
    const now = new Date().toISOString();

    for (const row of rows) {
      const parsed = JSON.parse(row.tool_sequence_json) as unknown;
      const next = renameToolSequence(parsed);
      if (JSON.stringify(parsed) === JSON.stringify(next)) continue;
      update.run(JSON.stringify(next), now, row.id, row.version);
    }
  },
};

function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(tableName);
  return Boolean(row);
}

function renameToolSequence(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(renameToolSequence);
  }
  if (!value || typeof value !== 'object') return value;

  const object = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(object)) {
    next[key] =
      key === 'tool' && typeof item === 'string'
        ? (TOOL_RENAMES[item] ?? item)
        : renameToolSequence(item);
  }
  return next;
}
