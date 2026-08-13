/**
 * Migration 002: Add default_thinking_config to agent_profiles
 *
 * For existing databases, the column was added to 001_init's CREATE TABLE
 * but IF NOT EXISTS means it won't run again. This migration ensures the
 * column exists for databases created before this feature.
 */

import type Database from 'better-sqlite3';

import type { Migration } from './runner';
import { addColumnIfMissing } from './utils';

export const migration: Migration = {
  version: 28,
  description: 'Add default_thinking_config to agent_profiles',
  up(db: Database.Database) {
    addColumnIfMissing(
      db,
      'agent_profiles',
      'default_thinking_config',
      'TEXT DEFAULT NULL',
    );
  },
};
