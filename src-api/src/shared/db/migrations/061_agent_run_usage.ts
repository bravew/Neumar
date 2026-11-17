import type Database from 'better-sqlite3';

import type { Migration } from './runner';
import { addColumnIfMissing } from './utils';

/**
 * Keep a run's reported usage as the producer gave it.
 *
 * `tokens_in`, `tokens_out` and `cost_usd` are NOT NULL DEFAULT 0, so they
 * cannot tell "the provider reported zero" from "the provider reported nothing".
 * `usage_json` holds the AG-UI terminal event's `usage` entries (one per
 * provider and model, with cache and reasoning subsets) and the reported
 * spend. NULL means nothing was reported, which is what every existing row
 * is: no history is invented for runs that predate the column.
 */
export const migration: Migration = {
  version: 113,
  description: 'Record the usage a run reported on its terminal event',
  up(db: Database.Database) {
    addColumnIfMissing(db, 'agent_runs', 'usage_json', 'TEXT');
  },
};
