/**
 * Migration 004: File provenance
 *
 * Adds a `provenance` TEXT column to the `files` table. Stores the JSON
 * record written by the media-generation provenance writer so the Library
 * view can show which AI model produced each asset even after the session
 * the file was generated in is closed.
 */

import type Database from 'better-sqlite3';

import type { Migration } from './runner';
import { addColumnIfMissing } from './utils';

export const migration: Migration = {
  version: 30,
  description: 'Add provenance JSON column to files table',
  up(db: Database.Database) {
    addColumnIfMissing(db, 'files', 'provenance', 'TEXT DEFAULT NULL');
  },
};
