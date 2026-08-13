/**
 * Recall Audit — persists per-recall provenance so the UI can show the user
 * which memories were injected into each agent turn, with what score and
 * by which retrieval method.
 *
 * Recorded inside `recallMemories` after the search completes. Reads served
 * via `GET /memory/audit/:sessionId` and surfaced in the TaskDetail sidebar.
 */

import { getDatabase } from '@/shared/db';
import { createLogger } from '@/shared/utils/logger';

import type { Memory, MemorySearchResult } from './types';

const logger = createLogger('RecallAudit');

export const RECALL_METHODS = [
  'vector',
  'fts',
  'hybrid',
  'pinned',
  'file',
] as const;
export type RecallMethod = (typeof RECALL_METHODS)[number];

export interface RecallAuditRow {
  id: number;
  sessionId: string;
  memoryId: string;
  score: number;
  method: RecallMethod;
  query: string | null;
  recalledAt: string;
}

export interface RecallAuditEntry extends RecallAuditRow {
  memory?: Memory;
}

export function recordRecall(
  sessionId: string,
  results: MemorySearchResult[],
  options: { method?: RecallMethod; query?: string } = {},
): void {
  if (!sessionId || results.length === 0) return;
  try {
    const db = getDatabase();
    const insert = db.prepare(
      `INSERT INTO recall_audit (session_id, memory_id, score, method, query)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const tx = db.transaction((rows: MemorySearchResult[]) => {
      for (const row of rows) {
        insert.run(
          sessionId,
          row.memory.id,
          row.score,
          options.method ?? 'hybrid',
          options.query ?? null,
        );
      }
    });
    tx(results);
  } catch (err) {
    logger.warn(`Failed to record recall audit: ${err}`);
  }
}

export function recordFileRecall(
  sessionId: string,
  paths: string[],
  query?: string,
): void {
  if (!sessionId || paths.length === 0) return;
  try {
    const db = getDatabase();
    const insert = db.prepare(
      `INSERT INTO recall_audit (session_id, memory_id, score, method, query)
       VALUES (?, ?, ?, 'file', ?)`,
    );
    const tx = db.transaction((items: string[]) => {
      for (const path of items) insert.run(sessionId, path, 1, query ?? null);
    });
    tx(paths);
  } catch (err) {
    logger.warn(`Failed to record file recall audit: ${err}`);
  }
}

export function listRecallAudit(
  sessionId: string,
  options: { limit?: number } = {},
): RecallAuditEntry[] {
  try {
    const db = getDatabase();
    const limit = Math.max(1, Math.min(options.limit ?? 200, 1000));
    const rows = db
      .prepare(
        `SELECT a.id, a.session_id AS sessionId, a.memory_id AS memoryId,
                a.score, a.method, a.query, a.recalled_at AS recalledAt
         FROM recall_audit a
         WHERE a.session_id = ?
         ORDER BY a.recalled_at DESC, a.id DESC
         LIMIT ?`,
      )
      .all(sessionId, limit) as RecallAuditRow[];

    if (rows.length === 0) return [];

    // Hydrate non-file rows with the memory record (file rows store a path
    // in memory_id and have no row in `memories`).
    const memoryIds = rows
      .filter((r) => r.method !== 'file')
      .map((r) => r.memoryId);
    let memoryById = new Map<string, Memory>();
    if (memoryIds.length > 0) {
      const placeholders = memoryIds.map(() => '?').join(',');
      const memRows = db
        .prepare(
          `SELECT id, content, category, importance, memory_type AS memoryType,
                  scope_type AS scopeType, created_at AS createdAt,
                  updated_at AS updatedAt
           FROM memories WHERE id IN (${placeholders})`,
        )
        .all(...memoryIds) as Memory[];
      memoryById = new Map(memRows.map((m) => [m.id, m]));
    }

    return rows.map((r) => ({
      ...r,
      memory: r.method === 'file' ? undefined : memoryById.get(r.memoryId),
    }));
  } catch (err) {
    logger.warn(`Failed to list recall audit for ${sessionId}: ${err}`);
    return [];
  }
}

export function clearRecallAudit(sessionId: string): number {
  try {
    const db = getDatabase();
    const result = db
      .prepare(`DELETE FROM recall_audit WHERE session_id = ?`)
      .run(sessionId);
    return result.changes;
  } catch (err) {
    logger.warn(`Failed to clear recall audit for ${sessionId}: ${err}`);
    return 0;
  }
}
