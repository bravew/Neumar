import { describe, expect, it } from 'vitest';

import {
  accumulateVideoSessionCost,
  extractCostUsd,
} from '@/extensions/agent/video/cost-hook';

import { migration as migration032 } from '@/shared/db/migrations/032_video_conversation_mode';
import { migration as migration033 } from '@/shared/db/migrations/033_video_recipe_tool_rename';
import { runMigrations } from '@/shared/db/migrations/runner';

import { createTestDb } from '../../helpers/db';

describe('video cost telemetry hook helpers', () => {
  it('extracts cost from MCP text results', () => {
    expect(
      extractCostUsd({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ result: { totalCostUsd: 0.42 } }),
          },
        ],
      }),
    ).toBe(0.42);
  });

  it('accumulates per-project session costs', () => {
    const { db, cleanup } = createTestDb();
    try {
      runMigrations(db, [migration032, migration033]);

      accumulateVideoSessionCost('project-1', 'session-1', 0.25, db);
      accumulateVideoSessionCost('project-1', 'session-1', 0.1, db);

      const row = db
        .prepare(
          `SELECT cost_usd FROM video_session_cost WHERE project_id = ? AND session_id = ?`,
        )
        .get('project-1', 'session-1') as { cost_usd: number };
      expect(row.cost_usd).toBeCloseTo(0.35);
    } finally {
      cleanup();
    }
  });
});
