import type Database from 'better-sqlite3';

import type { Migration } from './runner';
import { addColumnIfMissing } from './utils';

export const migration: Migration = {
  version: 94,
  description: 'Store video project workspace roots',
  up(db: Database.Database) {
    addColumnIfMissing(db, 'video_projects', 'workspace_root', 'TEXT');
  },
};
