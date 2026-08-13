import { getDatabase } from '@/shared/db';
import { createLogger } from '@/shared/utils/logger';

/**
 * Memory System — public API
 *
 * Re-exports everything needed by routes, agent hooks, and MCP server.
 * Initialization loads sqlite-vec + creates virtual tables.
 */

export * from './types';
export * from './store';
export * from './config';
export * from './embedder';
export * from './retriever';
export * from './capturer';
export * from './recall';
export * from './llm-capturer';
export * from './session-indexer';
export * from './flush';
export * from './agent-hooks';
// v2 modules
export * from './decay';
export * from './mmr';
export * from './classifier';
export * from './entity-extractor';
export * from './consolidation';
export * from './file-loader';
export * from './file-mirror';
export * from './promoter';
export * from './audit';

const logger = createLogger('Memory');

let initialized = false;
let sqliteVecLoaded = false;

/**
 * Initialize the memory system.
 * - Loads sqlite-vec extension (if available)
 * - Creates vec_memories virtual table
 * - Creates FTS5 table + triggers
 *
 * Call once at server startup (in src-api/src/index.ts).
 */
export async function initializeMemory(): Promise<void> {
  if (initialized) return;

  const db = getDatabase();

  // Try to load sqlite-vec
  try {
    const sqliteVec = await import('sqlite-vec');
    sqliteVec.load(db);
    sqliteVecLoaded = true;
    logger.info('✅ sqlite-vec loaded successfully');
  } catch (err) {
    logger.warn(
      `⚠️ sqlite-vec not available — falling back to JS cosine similarity: ${err}`,
    );
    sqliteVecLoaded = false;
  }

  // Create vector tables (only if sqlite-vec loaded)
  if (sqliteVecLoaded) {
    const { getMemoryConfig } = await import('./config');
    const { embeddingDim } = getMemoryConfig();

    try {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_memories USING vec0(
          memory_id TEXT PARTITION KEY,
          embedding float[${embeddingDim}] distance_metric=cosine
        )
      `);
      logger.info(
        `vec_memories virtual table ready (${embeddingDim}-dim, cosine)`,
      );
    } catch (err) {
      logger.warn(`Failed to create vec_memories table: ${err}`);
      sqliteVecLoaded = false;
    }

    try {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_session_chunks USING vec0(
          chunk_id INTEGER PARTITION KEY,
          embedding float[${embeddingDim}] distance_metric=cosine
        )
      `);
      logger.info(
        `vec_session_chunks virtual table ready (${embeddingDim}-dim)`,
      );
    } catch (err) {
      logger.warn(`Failed to create vec_session_chunks table: ${err}`);
    }

    // Workspace RAG vector table — co-loaded with memory's sqlite-vec extension.
    try {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_workspace USING vec0(
          chunk_id TEXT PARTITION KEY,
          embedding float[${embeddingDim}] distance_metric=cosine
        )
      `);
      logger.info(
        `vec_workspace virtual table ready (${embeddingDim}-dim, cosine)`,
      );
    } catch (err) {
      logger.warn(`Failed to create vec_workspace table: ${err}`);
    }

    try {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_linked_assets USING vec0(
          linked_asset_id TEXT PARTITION KEY,
          embedding float[${embeddingDim}] distance_metric=cosine
        )
      `);
      logger.info(
        `vec_linked_assets virtual table ready (${embeddingDim}-dim, cosine)`,
      );
    } catch (err) {
      logger.warn(`Failed to create vec_linked_assets table: ${err}`);
    }

    try {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_media_frames USING vec0(
          frame_id TEXT PARTITION KEY,
          embedding float[${embeddingDim}] distance_metric=cosine
        )
      `);
      logger.info(
        `vec_media_frames virtual table ready (${embeddingDim}-dim, cosine)`,
      );
    } catch (err) {
      logger.warn(`Failed to create vec_media_frames table: ${err}`);
    }
  }

  // Create FTS5 content-sync table (always available — built into SQLite).
  // IMPORTANT: This relies on the implicit SQLite rowid of the `memories` table.
  // The `memories` table uses TEXT `id` as PRIMARY KEY, so SQLite auto-assigns an
  // integer rowid. If `memories` is ever changed to WITHOUT ROWID, the FTS sync
  // and the JOIN in retriever.ts (memories_fts.rowid → memories.rowid) will break.
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      content,
      content='memories',
      content_rowid='rowid',
      tokenize='unicode61'
    )
  `);

  // FTS5 sync triggers — keep FTS index in sync with the memories table
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
    END
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.rowid, old.content);
    END
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE OF content ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.rowid, old.content);
      INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
    END
  `);

  initialized = true;
  logger.info(
    `🚀 Memory system initialized (sqlite-vec: ${sqliteVecLoaded ? 'yes' : 'no'})`,
  );
}

/** Whether sqlite-vec is loaded and vec_memories is available */
export function isSqliteVecAvailable(): boolean {
  return sqliteVecLoaded;
}

/** Shutdown — nothing to do for SQLite (connection managed by db module) */
export function shutdownMemory(): void {
  initialized = false;
  logger.info('Memory system shut down');
}
