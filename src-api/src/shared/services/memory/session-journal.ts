/**
 * Session Journal — append-only observation log for extended sessions.
 *
 * Instead of creating immediate memory records, journal mode accumulates
 * timestamped observations during a session. At session end, these are
 * distilled into durable memories via journal-distiller.ts.
 *
 * Inspired by Claude Code memdir's `buildAssistantDailyLogPrompt()`.
 */

import { randomUUID } from 'node:crypto';

import { getDatabase } from '@/shared/db';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('SessionJournal');

export interface JournalEntry {
  id: string;
  sessionId: string;
  content: string;
  createdAt: string;
}

interface JournalEntryRow {
  id: string;
  session_id: string;
  content: string;
  created_at: string;
}

export function appendToJournal(
  sessionId: string,
  entry: string,
): JournalEntry {
  const db = getDatabase();
  const id = randomUUID();

  db.prepare(
    `INSERT INTO session_journals (id, session_id, content) VALUES (?, ?, ?)`,
  ).run(id, sessionId, entry);

  logger.debug(`[${sessionId}] Journal entry appended (${entry.length} chars)`);

  return {
    id,
    sessionId,
    content: entry,
    createdAt: new Date().toISOString(),
  };
}

export function getJournalEntries(sessionId: string): JournalEntry[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT * FROM session_journals WHERE session_id = ? ORDER BY created_at ASC`,
    )
    .all(sessionId) as JournalEntryRow[];

  return rows.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    content: r.content,
    createdAt: r.created_at,
  }));
}

export function getJournalEntryCount(sessionId: string): number {
  const db = getDatabase();
  const result = db
    .prepare(
      `SELECT COUNT(*) as count FROM session_journals WHERE session_id = ?`,
    )
    .get(sessionId) as { count: number };
  return result.count;
}

export function clearJournal(sessionId: string): number {
  const db = getDatabase();
  const result = db
    .prepare(`DELETE FROM session_journals WHERE session_id = ?`)
    .run(sessionId);
  logger.info(`[${sessionId}] Journal cleared (${result.changes} entries)`);
  return result.changes;
}
