/**
 * Session Transcript Indexer
 *
 * Indexes conversation messages for cross-session semantic recall.
 * Uses delta-based sync: only processes new messages since last index.
 *
 * Chunking: ~400 tokens per chunk with 80-token overlap
 * (matches OpenClaw's chunking strategy for consistent quality).
 */

import { getDatabase } from '@/shared/db';
import { createLogger } from '@/shared/utils/logger';

import { embed, getModelName, type EmbedOptions } from './embedder';
import { cacheEmbedding, getCachedEmbedding } from './store';

const logger = createLogger('SessionIndexer');

// Chunking parameters
const TARGET_TOKENS = 400;
const OVERLAP_TOKENS = 80;
const CHARS_PER_TOKEN = 4; // Rough approximation

const TARGET_CHARS = TARGET_TOKENS * CHARS_PER_TOKEN;
const OVERLAP_CHARS = OVERLAP_TOKENS * CHARS_PER_TOKEN;

/**
 * Chunk text into overlapping segments.
 */
export function chunkText(
  text: string,
  targetChars = TARGET_CHARS,
  overlapChars = OVERLAP_CHARS,
): string[] {
  if (text.length <= targetChars) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + targetChars;

    // Try to break at a sentence or paragraph boundary
    if (end < text.length) {
      const breakPoint = text.lastIndexOf('\n', end);
      if (breakPoint > start + targetChars * 0.5) {
        end = breakPoint + 1;
      } else {
        const sentenceBreak = text.lastIndexOf('. ', end);
        if (sentenceBreak > start + targetChars * 0.5) {
          end = sentenceBreak + 2;
        }
      }
    } else {
      end = text.length;
    }

    chunks.push(text.slice(start, end));

    // If we've reached the end, stop
    if (end >= text.length) break;

    // Advance start by (end - overlapChars), but guarantee forward progress
    // to prevent infinite loops when overlapChars >= (end - start)
    const nextStart = Math.max(start + 1, end - overlapChars);
    start = nextStart;
  }

  return chunks;
}

/**
 * Format a task's messages into indexable text.
 * Only includes user and assistant messages (not tool calls).
 */
function formatTaskMessages(
  messages: { type: string; content: string | null }[],
): string {
  return messages
    .filter((m) => (m.type === 'text' || m.type === 'answer') && m.content)
    .map((m) => m.content!)
    .join('\n\n');
}

/**
 * Index a single task's conversation for session memory search.
 * Delta-based: only creates chunks for tasks not yet indexed.
 */
export async function indexTask(
  taskId: string,
  embedOptions: EmbedOptions,
): Promise<number> {
  const db = getDatabase();

  // Check if already indexed
  const existingCount = (
    db
      .prepare(
        'SELECT COUNT(*) as count FROM session_memory_chunks WHERE task_id = ?',
      )
      .get(taskId) as { count: number }
  ).count;

  if (existingCount > 0) {
    logger.debug(`Task ${taskId} already indexed (${existingCount} chunks)`);
    return 0;
  }

  // Fetch messages for this task
  const messages = db
    .prepare(
      'SELECT type, content FROM messages WHERE task_id = ? ORDER BY created_at',
    )
    .all(taskId) as { type: string; content: string | null }[];

  if (messages.length === 0) return 0;

  const fullText = formatTaskMessages(messages);
  if (fullText.length < 50) return 0; // Skip trivially short conversations

  // Chunk the text
  const chunks = chunkText(fullText);

  const modelName = getModelName(embedOptions);

  let indexed = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const tokenCount = Math.ceil(chunk.length / CHARS_PER_TOKEN);

    // Insert chunk row
    const result = db
      .prepare(
        `
      INSERT INTO session_memory_chunks (task_id, chunk_index, content, token_count)
      VALUES (?, ?, ?, ?)
    `,
      )
      .run(taskId, i, chunk, tokenCount);

    const chunkId = result.lastInsertRowid as number;

    // Generate and store embedding (vec insert + metadata update in one transaction)
    try {
      let vector = getCachedEmbedding(chunk, modelName);
      if (!vector) {
        vector = await embed(chunk, embedOptions);
        cacheEmbedding(chunk, modelName, vector);
      }

      db.transaction(() => {
        db.prepare(
          'INSERT INTO vec_session_chunks (chunk_id, embedding) VALUES (?, ?)',
        ).run(chunkId, vector);
        db.prepare(
          'UPDATE session_memory_chunks SET has_embedding = 1 WHERE id = ?',
        ).run(chunkId);
      })();
      indexed++;
    } catch (err) {
      logger.warn(`Failed to embed session chunk ${chunkId}: ${err}`);
    }
  }

  logger.info(`Indexed task ${taskId}: ${indexed}/${chunks.length} chunks`);
  return indexed;
}

/**
 * Index all un-indexed tasks (delta sync).
 * Processes most recent tasks first, up to `maxTasks`.
 */
export async function syncSessionIndex(
  embedOptions: EmbedOptions,
  maxTasks = 50,
): Promise<{ tasksProcessed: number; chunksIndexed: number }> {
  const db = getDatabase();

  // Find tasks that have messages but no session_memory_chunks
  const unindexedTasks = db
    .prepare(
      `
    SELECT DISTINCT t.id
    FROM tasks t
    INNER JOIN messages m ON m.task_id = t.id
    LEFT JOIN session_memory_chunks smc ON smc.task_id = t.id
    WHERE smc.id IS NULL
      AND t.status = 'completed'
    ORDER BY t.created_at DESC
    LIMIT ?
  `,
    )
    .all(maxTasks) as { id: string }[];

  let tasksProcessed = 0;
  let chunksIndexed = 0;

  for (const task of unindexedTasks) {
    const indexed = await indexTask(task.id, embedOptions);
    if (indexed > 0) {
      tasksProcessed++;
      chunksIndexed += indexed;
    }

    // Yield to event loop between tasks
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  if (tasksProcessed > 0) {
    logger.info(
      `Session index sync: ${tasksProcessed} tasks, ${chunksIndexed} chunks indexed`,
    );
  }

  return { tasksProcessed, chunksIndexed };
}

/**
 * Search session transcripts for relevant context.
 * Returns chunks with relevance scores.
 */
export async function searchSessions(
  queryText: string,
  embedOptions: EmbedOptions,
  limit = 3,
): Promise<
  { content: string; taskId: string; score: number; createdAt: string }[]
> {
  const { isSqliteVecAvailable } = await import('./index');
  if (!isSqliteVecAvailable()) return [];

  try {
    const queryVector = await embed(queryText, embedOptions);
    const db = getDatabase();

    const results = db
      .prepare(
        `
      SELECT chunk_id, distance
      FROM vec_session_chunks
      WHERE embedding MATCH ?
        AND k = ?
      ORDER BY distance
    `,
      )
      .all(queryVector, limit * 2) as { chunk_id: number; distance: number }[];

    if (results.length === 0) return [];

    // Fetch chunk details
    const placeholders = results.map(() => '?').join(',');
    const chunkIds = results.map((r) => r.chunk_id);

    const chunks = db
      .prepare(
        `
      SELECT id, task_id, content, created_at
      FROM session_memory_chunks
      WHERE id IN (${placeholders})
    `,
      )
      .all(...chunkIds) as {
      id: number;
      task_id: string;
      content: string;
      created_at: string;
    }[];

    const distanceMap = new Map(results.map((r) => [r.chunk_id, r.distance]));

    return chunks
      .map((c) => ({
        content: c.content,
        taskId: c.task_id,
        score: 1 - (distanceMap.get(c.id) ?? 1) / 2, // Convert cosine distance to similarity
        createdAt: c.created_at,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  } catch (err) {
    logger.warn(`Session search failed: ${err}`);
    return [];
  }
}
