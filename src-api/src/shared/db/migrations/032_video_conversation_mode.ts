import type Database from 'better-sqlite3';

import type { Migration } from './runner';

const BUILTIN_RECIPE_VERSION = 1;

const BUILTIN_RECIPES = [
  {
    id: 'product-reel',
    name: 'Product reel',
    systemPrompt:
      'Create a concise product reel. Favor strong motion, clear benefit moments, captions when voiceover is present, and an end card that leaves the brand visible.',
    toolSequence: [
      { tool: 'analyze_source', input: { scope: 'all-clips' } },
      {
        tool: 'propose_timeline_ops',
        input: { clipLengthMs: [8000, 10000], targetDurationMs: 60000 },
      },
      { tool: 'propose_music', input: { mood: 'upbeat', bpm: [110, 128] } },
      { tool: 'auto_color', input: { preset: 'vivid' } },
      { tool: 'subtitle_upsert', input: { when: 'voiceover-present' } },
    ],
    defaults: {
      durationMs: 60000,
      aspectRatios: ['9:16', '16:9', '1:1'],
      captions: 'auto',
      music: { mood: 'upbeat', bedLufs: -18, voiceoverLufs: -14 },
    },
    outputPreset: 'social-vertical-1080p-h264',
    inputSchema: {
      kind: 'asset-shape',
      videoClips: { min: 3, max: 10 },
      optional: ['brand-logo', 'voiceover-script'],
    },
  },
  {
    id: 'talking-head-explainer',
    name: 'Talking-head explainer',
    systemPrompt:
      'Edit a single talking-head take into a clear explainer. Remove filler and long silences, preserve sentence boundaries, keep captions readable, and use B-roll only when it clarifies the spoken point.',
    toolSequence: [
      { tool: 'transcribe', input: { timestamps: 'word' } },
      {
        tool: 'propose_auto_cuts',
        input: { strategy: 'silence-and-filler', silenceMs: 400 },
      },
      { tool: 'subtitle_upsert', input: { style: 'bold' } },
      { tool: 'propose_broll', input: { source: 'transcript-keywords' } },
      { tool: 'auto_color', input: { preset: 'natural' } },
      { tool: 'transition_set', input: { kind: 'fade' } },
    ],
    defaults: {
      durationMs: 90000,
      aspectRatios: ['1:1', '9:16'],
      captions: 'always',
      music: 'off',
    },
    outputPreset: 'social-square-1080p-h264',
    inputSchema: {
      kind: 'asset-shape',
      talkingHeadClips: { min: 1, max: 1 },
      optional: ['broll-directory', 'title'],
    },
  },
  {
    id: 'vertical-social-cut',
    name: 'Vertical social cut',
    systemPrompt:
      'Extract a vertical short from long-form source media. Pick one strong moment, reframe for 9:16, preserve the hook, and caption speech prominently.',
    toolSequence: [
      { tool: 'transcribe', input: { timestamps: 'word' } },
      { tool: 'rank_moments', input: { signal: 'short-form-hook' } },
      { tool: 'propose_timeline_ops', input: { targetDurationMs: 30000 } },
      { tool: 'auto_reframe', input: { targetAspect: '9:16' } },
      { tool: 'subtitle_upsert', input: { style: 'bold' } },
      { tool: 'propose_music', input: { mood: 'low-energy-ambient' } },
    ],
    defaults: {
      durationMs: 30000,
      aspectRatios: ['9:16'],
      captions: 'always',
      music: { mood: 'low-energy-ambient' },
    },
    outputPreset: 'social-vertical-1080p-h264',
    inputSchema: {
      kind: 'asset-shape',
      longFormVideo: { min: 1, max: 1 },
      optional: ['source-url'],
    },
  },
] as const;

export const migration: Migration = {
  version: 89,
  description: 'Add video conversation mode recipes and intent log',
  up(db: Database.Database) {
    db.transaction(() => {
      db.exec(`
      CREATE TABLE IF NOT EXISTS video_recipes (
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        version INTEGER NOT NULL,
        system_prompt TEXT NOT NULL,
        tool_sequence_json TEXT NOT NULL,
        defaults_json TEXT NOT NULL,
        output_preset TEXT NOT NULL,
        input_schema_json TEXT NOT NULL,
        is_builtin INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (id, version)
      );

      CREATE TABLE IF NOT EXISTS video_intent_log (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES video_projects(id) ON DELETE CASCADE,
        turn INTEGER NOT NULL,
        ts TEXT NOT NULL,
        user_intent_text TEXT NOT NULL,
        recipe_id TEXT,
        recipe_version INTEGER,
        plan_json TEXT NOT NULL,
        ops_proposed_json TEXT NOT NULL,
        ops_applied_json TEXT,
        accepted INTEGER NOT NULL DEFAULT 0,
        diff_summary TEXT,
        apply_mode TEXT CHECK (apply_mode IN ('suggest','auto','review-each')),
        cost_usd REAL NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS video_host_capabilities (
        host_id TEXT PRIMARY KEY,
        os TEXT NOT NULL,
        gpu_vendor TEXT,
        has_videotoolbox INTEGER NOT NULL DEFAULT 0,
        has_nvenc INTEGER NOT NULL DEFAULT 0,
        has_qsv INTEGER NOT NULL DEFAULT 0,
        has_vaapi INTEGER NOT NULL DEFAULT 0,
        ffmpeg_version TEXT NOT NULL,
        probed_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS video_recipe_style_presets (
        recipe_id TEXT NOT NULL,
        sub_mode TEXT NOT NULL,
        preset_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (recipe_id, sub_mode)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS video_intent_log_project_turn
        ON video_intent_log(project_id, turn);
      CREATE INDEX IF NOT EXISTS idx_video_recipes_builtin
        ON video_recipes(is_builtin, name);
    `);

      const now = new Date().toISOString();
      const insertRecipe = db.prepare(`
      INSERT OR IGNORE INTO video_recipes (
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);
      for (const recipe of BUILTIN_RECIPES) {
        insertRecipe.run(
          recipe.id,
          recipe.name,
          BUILTIN_RECIPE_VERSION,
          recipe.systemPrompt,
          JSON.stringify(recipe.toolSequence),
          JSON.stringify(recipe.defaults),
          recipe.outputPreset,
          JSON.stringify(recipe.inputSchema),
          now,
          now,
        );
      }
    })();
  },
};
