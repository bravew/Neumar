import { describe, expect, it } from 'vitest';

import { migration as migration027 } from '@/shared/db/migrations/027_video_mode_foundation';
import { migration as migration032 } from '@/shared/db/migrations/032_video_conversation_mode';
import { migration as migration039 } from '@/shared/db/migrations/039_video_intent_plugin_snapshot';
import { runMigrations } from '@/shared/db/migrations/runner';
import {
  getVideoRecipe,
  listVideoIntentLog,
  listVideoRecipes,
  recordVideoIntentLog,
} from '@/shared/video/recipes';

import { createTestDb } from '../../helpers/db';

describe('video conversation recipes', () => {
  it('creates conversation tables and seeds Phase 1 recipes', () => {
    const { db, cleanup } = createTestDb();
    try {
      runMigrations(db, [migration027, migration032, migration039]);

      const recipes = listVideoRecipes(db);

      expect(recipes.map((recipe) => recipe.id)).toEqual([
        'product-reel',
        'talking-head-explainer',
        'vertical-social-cut',
      ]);
      expect(getVideoRecipe('product-reel', undefined, db)).toMatchObject({
        id: 'product-reel',
        version: 1,
        outputPreset: 'social-vertical-1080p-h264',
        isBuiltin: true,
      });
    } finally {
      cleanup();
    }
  });

  it('records replayable intent-log turns per project', () => {
    const { db, cleanup } = createTestDb();
    try {
      runMigrations(db, [migration027, migration032, migration039]);
      db.prepare(
        `
          INSERT INTO video_projects (
            id,
            name,
            template,
            updated_at,
            render_status
          ) VALUES (?, ?, ?, ?, ?)
        `,
      ).run(
        'project-1',
        'Launch reel',
        'custom',
        '2026-05-30T00:00:00.000Z',
        'idle',
      );

      const proposed = recordVideoIntentLog(
        {
          id: 'intent-1',
          projectId: 'project-1',
          ts: '2026-05-30T12:00:00.000Z',
          userIntentText: 'make a short upbeat version',
          recipeId: 'product-reel',
          recipeVersion: 1,
          plan: { steps: [{ tool: 'propose_timeline_ops' }] },
          opsProposed: [
            {
              kind: 'clip.move',
              clipId: 'clip-1',
              from: { trackId: 'track-1', startMs: 0 },
              to: { trackId: 'track-1', startMs: 1000 },
            },
          ],
          diffSummary: 'Move intro later',
          applyMode: 'suggest',
          appliedPluginSnapshot: {
            id: 'snapshot-1',
            domain: 'video',
            plugin: {
              id: 'social-reel',
              name: 'social-reel',
              version: '1.0.0',
              trustTier: 'bundled',
              manifestDigest: 'digest-a',
            },
            capabilities: ['prompt:inject'],
            payload: {
              engine: { id: 'html' },
              stages: [],
              inputs: { topic: 'launch' },
              output: {},
              templates: [],
            },
            createdAt: '2026-05-30T12:00:00.000Z',
          },
        },
        db,
      );
      const accepted = recordVideoIntentLog(
        {
          id: 'intent-2',
          projectId: 'project-1',
          ts: '2026-05-30T12:01:00.000Z',
          userIntentText: 'accept it',
          opsApplied: proposed.opsProposed,
          accepted: true,
          applyMode: 'auto',
        },
        db,
      );

      expect(proposed.turn).toBe(1);
      expect(accepted.turn).toBe(2);
      expect(listVideoIntentLog('project-1', {}, db)).toMatchObject([
        {
          id: 'intent-1',
          recipeId: 'product-reel',
          accepted: false,
          opsProposed: [{ kind: 'clip.move' }],
          appliedPluginSnapshot: {
            plugin: { id: 'social-reel' },
            payload: { inputs: { topic: 'launch' } },
          },
        },
        {
          id: 'intent-2',
          accepted: true,
          opsApplied: [{ kind: 'clip.move' }],
        },
      ]);
    } finally {
      cleanup();
    }
  });
});
