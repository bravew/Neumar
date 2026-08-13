import { randomUUID } from 'node:crypto';

import type { TimelineOp } from '@neumar/video-ir';
import type Database from 'better-sqlite3';

import { getDatabase } from '@/shared/db';
import type { AppliedSnapshot } from '@/shared/plugins/runtime';
import type { VideoPluginSnapshotPayload } from '@/shared/video/plugins/types';

export type VideoIntentApplyMode = 'suggest' | 'auto' | 'review-each';
export type VideoAppliedPluginSnapshot =
  AppliedSnapshot<VideoPluginSnapshotPayload>;

export interface VideoRecipe {
  id: string;
  name: string;
  version: number;
  systemPrompt: string;
  toolSequence: unknown[];
  defaults: Record<string, unknown>;
  outputPreset: string;
  inputSchema: Record<string, unknown>;
  isBuiltin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VideoIntentLogEntry {
  id: string;
  projectId: string;
  turn: number;
  ts: string;
  userIntentText: string;
  recipeId?: string;
  recipeVersion?: number;
  plan: unknown;
  opsProposed: TimelineOp[];
  opsApplied?: TimelineOp[];
  accepted: boolean;
  diffSummary?: string;
  applyMode?: VideoIntentApplyMode;
  appliedPluginSnapshot?: VideoAppliedPluginSnapshot;
  costUsd: number;
}

export interface RecordVideoIntentLogInput {
  id?: string;
  projectId: string;
  turn?: number;
  ts?: string;
  userIntentText: string;
  recipeId?: string;
  recipeVersion?: number;
  plan?: unknown;
  opsProposed?: TimelineOp[];
  opsApplied?: TimelineOp[];
  accepted?: boolean;
  diffSummary?: string;
  applyMode?: VideoIntentApplyMode;
  appliedPluginSnapshot?: VideoAppliedPluginSnapshot;
  costUsd?: number;
}

interface VideoRecipeRow {
  id: string;
  name: string;
  version: number;
  system_prompt: string;
  tool_sequence_json: string;
  defaults_json: string;
  output_preset: string;
  input_schema_json: string;
  is_builtin: number;
  created_at: string;
  updated_at: string;
}

interface VideoIntentLogRow {
  id: string;
  project_id: string;
  turn: number;
  ts: string;
  user_intent_text: string;
  recipe_id: string | null;
  recipe_version: number | null;
  plan_json: string;
  ops_proposed_json: string;
  ops_applied_json: string | null;
  accepted: number;
  diff_summary: string | null;
  apply_mode: VideoIntentApplyMode | null;
  applied_plugin_json: string | null;
  cost_usd: number;
}

export function listVideoRecipes(
  db: Database.Database = getDatabase(),
): VideoRecipe[] {
  const rows = db
    .prepare(
      `
        SELECT recipe.*
        FROM video_recipes recipe
        JOIN (
          SELECT id, MAX(version) AS version
          FROM video_recipes
          GROUP BY id
        ) latest
          ON latest.id = recipe.id
          AND latest.version = recipe.version
        ORDER BY recipe.is_builtin DESC, recipe.name COLLATE NOCASE
      `,
    )
    .all() as VideoRecipeRow[];
  return rows.map(recipeFromRow);
}

export function getVideoRecipe(
  recipeId: string,
  version?: number,
  db: Database.Database = getDatabase(),
): VideoRecipe {
  const row = db
    .prepare(
      version === undefined
        ? `
          SELECT *
          FROM video_recipes
          WHERE id = ?
          ORDER BY version DESC
          LIMIT 1
        `
        : `
          SELECT *
          FROM video_recipes
          WHERE id = ? AND version = ?
          LIMIT 1
        `,
    )
    .get(...(version === undefined ? [recipeId] : [recipeId, version])) as
    | VideoRecipeRow
    | undefined;
  if (!row) {
    throw new Error(`Video recipe not found: ${recipeId}`);
  }
  return recipeFromRow(row);
}

const INTENT_TURN_RETRY_LIMIT = 5;

export function recordVideoIntentLog(
  input: RecordVideoIntentLogInput,
  db: Database.Database = getDatabase(),
): VideoIntentLogEntry {
  const baseEntry = {
    id: input.id ?? randomUUID(),
    projectId: input.projectId,
    ts: input.ts ?? new Date().toISOString(),
    userIntentText: input.userIntentText,
    recipeId: input.recipeId,
    recipeVersion: input.recipeVersion,
    plan: input.plan ?? { steps: [] },
    opsProposed: input.opsProposed ?? [],
    opsApplied: input.opsApplied,
    accepted: input.accepted ?? false,
    diffSummary: input.diffSummary,
    applyMode: input.applyMode,
    appliedPluginSnapshot: input.appliedPluginSnapshot,
    costUsd: input.costUsd ?? 0,
  };

  const insert = db.prepare(
    `
      INSERT INTO video_intent_log (
        id,
        project_id,
        turn,
        ts,
        user_intent_text,
        recipe_id,
        recipe_version,
        plan_json,
        ops_proposed_json,
        ops_applied_json,
        accepted,
        diff_summary,
        apply_mode,
        applied_plugin_json,
        cost_usd
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  );

  const runOnce = db.transaction((turn: number): VideoIntentLogEntry => {
    const entry: VideoIntentLogEntry = { ...baseEntry, turn };
    insert.run(
      entry.id,
      entry.projectId,
      entry.turn,
      entry.ts,
      entry.userIntentText,
      entry.recipeId ?? null,
      entry.recipeVersion ?? null,
      JSON.stringify(entry.plan),
      JSON.stringify(entry.opsProposed),
      entry.opsApplied ? JSON.stringify(entry.opsApplied) : null,
      entry.accepted ? 1 : 0,
      entry.diffSummary ?? null,
      entry.applyMode ?? null,
      entry.appliedPluginSnapshot
        ? JSON.stringify(entry.appliedPluginSnapshot)
        : null,
      entry.costUsd,
    );
    return entry;
  });

  // Caller-supplied turn must be honored as-is; conflicts surface to caller.
  if (input.turn !== undefined) {
    return runOnce(input.turn);
  }

  for (let attempt = 0; attempt < INTENT_TURN_RETRY_LIMIT; attempt += 1) {
    try {
      return runOnce(nextIntentTurn(db, input.projectId));
    } catch (error) {
      if (!isUniqueTurnError(error)) throw error;
    }
  }
  throw new Error(
    `Failed to allocate intent log turn for project ${input.projectId}`,
  );
}

function isUniqueTurnError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE' &&
    error.message.includes('video_intent_log_project_turn')
  );
}

export const VIDEO_INTENT_LOG_DEFAULT_LIMIT = 500;
export const VIDEO_INTENT_LOG_MAX_LIMIT = 2000;

export function listVideoIntentLog(
  projectId: string,
  options: { limit?: number; offset?: number } = {},
  db: Database.Database = getDatabase(),
): VideoIntentLogEntry[] {
  const limit = Math.min(
    Math.max(1, options.limit ?? VIDEO_INTENT_LOG_DEFAULT_LIMIT),
    VIDEO_INTENT_LOG_MAX_LIMIT,
  );
  const offset = Math.max(0, options.offset ?? 0);
  const rows = db
    .prepare(
      `
        SELECT *
        FROM video_intent_log
        WHERE project_id = ?
        ORDER BY turn ASC, ts ASC
        LIMIT ? OFFSET ?
      `,
    )
    .all(projectId, limit, offset) as VideoIntentLogRow[];
  return rows.map(intentFromRow);
}

function nextIntentTurn(db: Database.Database, projectId: string): number {
  const row = db
    .prepare(
      `
        SELECT COALESCE(MAX(turn), 0) + 1 AS next_turn
        FROM video_intent_log
        WHERE project_id = ?
      `,
    )
    .get(projectId) as { next_turn: number };
  return row.next_turn;
}

function recipeFromRow(row: VideoRecipeRow): VideoRecipe {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    systemPrompt: row.system_prompt,
    toolSequence: parseJson<unknown[]>(row.tool_sequence_json),
    defaults: parseJson<Record<string, unknown>>(row.defaults_json),
    outputPreset: row.output_preset,
    inputSchema: parseJson<Record<string, unknown>>(row.input_schema_json),
    isBuiltin: Boolean(row.is_builtin),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function intentFromRow(row: VideoIntentLogRow): VideoIntentLogEntry {
  return {
    id: row.id,
    projectId: row.project_id,
    turn: row.turn,
    ts: row.ts,
    userIntentText: row.user_intent_text,
    recipeId: row.recipe_id ?? undefined,
    recipeVersion: row.recipe_version ?? undefined,
    plan: parseJson<unknown>(row.plan_json),
    opsProposed: parseJson<TimelineOp[]>(row.ops_proposed_json),
    opsApplied: row.ops_applied_json
      ? parseJson<TimelineOp[]>(row.ops_applied_json)
      : undefined,
    accepted: Boolean(row.accepted),
    diffSummary: row.diff_summary ?? undefined,
    applyMode: row.apply_mode ?? undefined,
    appliedPluginSnapshot: row.applied_plugin_json
      ? parseJson<VideoAppliedPluginSnapshot>(row.applied_plugin_json)
      : undefined,
    costUsd: row.cost_usd,
  };
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}
