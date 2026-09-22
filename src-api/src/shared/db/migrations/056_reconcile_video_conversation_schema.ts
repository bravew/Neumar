import type Database from 'better-sqlite3';

import { migration as videoConversationMode } from './032_video_conversation_mode';
import { migration as videoRecipeToolRename } from './033_video_recipe_tool_rename';
import type { Migration } from './runner';
import { addColumnIfMissing, hasTable } from './utils';

/**
 * Repairs databases whose versions 89 and 90 were recorded by a different
 * release line before the video conversation tables shipped here — the same
 * class of drift that 051 and 052 reconcile for the run schema. Those installs
 * have no `video_intent_log`, `video_recipes`, `video_host_capabilities`, or
 * `video_recipe_style_presets`, and the runner will never retry 89/90 because
 * `_migrations` records those versions as applied.
 *
 * Both source migrations are idempotent (`CREATE TABLE IF NOT EXISTS`,
 * `INSERT OR IGNORE`, and a stable rename map), so this re-applies their `up`
 * rather than copying the DDL: duplicating the built-in recipe seed data would
 * let the two definitions drift apart, and 033's tool renames must follow 032's
 * seed or the recipes keep pre-rename tool names that no longer resolve.
 *
 * It then re-applies the columns that 96 and 105 skip when the table is
 * missing, so a reconciled database ends up with the same schema as a fresh one.
 */
export const migration: Migration = {
  version: 108,
  description: 'Reconcile video conversation mode schema',
  up(db: Database.Database) {
    videoConversationMode.up(db);
    videoRecipeToolRename.up(db);

    if (!hasTable(db, 'video_intent_log')) {
      throw new Error(
        'video_intent_log missing after reconciling video conversation schema',
      );
    }

    addColumnIfMissing(db, 'video_intent_log', 'applied_plugin_json', 'TEXT');
    addColumnIfMissing(db, 'video_intent_log', 'plan_id', 'TEXT');
    addColumnIfMissing(db, 'video_intent_log', 'plan_revision', 'INTEGER');
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_video_intent_log_plan
        ON video_intent_log(project_id, plan_id, plan_revision)
    `);
  },
};
