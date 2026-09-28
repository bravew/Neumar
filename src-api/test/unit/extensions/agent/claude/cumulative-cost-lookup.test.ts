import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { lookupPersistedCumulativeCost } from '@/extensions/agent/claude/stream-signals';

import { closeDatabase, getDatabase } from '@/shared/db';

const SESSION = 'sdk-session-cost';

describe('lookupPersistedCumulativeCost', () => {
  let tempHome = '';

  beforeEach(() => {
    tempHome = mkdtempSync(path.join(tmpdir(), 'neuma-cost-baseline-'));
    vi.stubEnv('HOME', tempHome);
    closeDatabase();
  });

  afterEach(() => {
    closeDatabase();
    vi.unstubAllEnvs();
    rmSync(tempHome, { recursive: true, force: true });
  });

  function insert(
    id: string,
    taskId: string,
    metadata: Record<string, unknown>,
  ) {
    getDatabase()
      .prepare(
        `INSERT INTO usage_logs (id, task_id, call_type, metadata)
         VALUES (?, ?, 'agent', ?)`,
      )
      .run(id, taskId, JSON.stringify(metadata));
  }

  it('skips a zeroed crash row and uses rowid order within the task', () => {
    insert('older', 'task-1', {
      sdk_session_id: SESSION,
      sdk_cumulative_cost_usd: 0.2,
    });
    insert('good', 'task-1', {
      sdk_session_id: SESSION,
      sdk_cumulative_cost_usd: 0.5,
    });
    insert('crash', 'task-1', {
      sdk_session_id: SESSION,
      sdk_cumulative_cost_usd: 0,
      subtype: 'error_during_execution',
    });
    insert('other-task', 'task-2', {
      sdk_session_id: SESSION,
      sdk_cumulative_cost_usd: 9,
    });

    expect(lookupPersistedCumulativeCost(SESSION, 'task-1')).toBe(0.5);
  });
});
