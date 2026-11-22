import type Database from 'better-sqlite3';

import type { Migration } from './runner';
import { addColumnIfMissing } from './utils';

/**
 * Keep a saved download's library file id apart from its asset id.
 *
 * The library deduplicates files by task and path, so a new download saved at
 * a path an earlier (since moved) download used gets the earlier library row.
 * Reusing that row's id as the asset id made the second asset collide with the
 * first. The asset id is now its own UUID, and `library_file_id` keeps the link
 * the Files panel uses to show the file once. NULL is an asset saved before
 * this column, whose asset id is its library file id.
 */
export const migration: Migration = {
  version: 116,
  description: 'Record the library file each saved download names',
  up(db: Database.Database) {
    addColumnIfMissing(db, 'download_assets', 'library_file_id', 'TEXT');
  },
};
