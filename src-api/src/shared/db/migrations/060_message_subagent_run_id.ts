import type Database from 'better-sqlite3';

import type { Migration } from './runner';
import { addColumnIfMissing } from './utils';

/**
 * Record which sub-agent invocation produced a message row.
 *
 * Child text and tool rows used to be indistinguishable from the parent's, so
 * history could not rebuild the nesting the live AG-UI stream shows. The
 * column holds the AG-UI `subagentRunId`; NULL means the parent run owns it.
 * Existing rows stay NULL, which is correct: nothing recorded ownership.
 */
export const migration: Migration = {
  version: 112,
  description: 'Record the sub-agent invocation that owns a message row',
  up(db: Database.Database) {
    addColumnIfMissing(db, 'messages', 'subagent_run_id', 'TEXT');
  },
};
