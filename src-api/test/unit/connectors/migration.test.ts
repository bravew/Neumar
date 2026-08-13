import { describe, expect, it } from 'vitest';

import { migration as connectorToolOverrides } from '@/shared/db/migrations/023_connector_tool_overrides';

import { createTestDb } from '../../helpers/db';

describe('connector tool override migration', () => {
  it('creates the override table and connector index', () => {
    const { db, cleanup } = createTestDb();
    try {
      connectorToolOverrides.up(db);
      const table = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'connector_tool_overrides'",
        )
        .get();
      const index = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'connector_tool_overrides_by_connector'",
        )
        .get();

      expect(table).toBeTruthy();
      expect(index).toBeTruthy();
    } finally {
      cleanup();
    }
  });
});
