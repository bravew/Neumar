/**
 * Memory Flush Before Compaction
 *
 * Re-runs the auto-capture logic on recent conversation messages
 * to ensure important context is persisted before context window compaction.
 *
 * Simpler than OpenClaw's approach (which uses a full agentic turn):
 * we use the existing rule-based + optional LLM capture on recent messages.
 */

import { createLogger } from '@/shared/utils/logger';

import { detectCategory, shouldCapture } from './capturer';
import { getEmbedOptions } from './config';
import { searchMemories } from './retriever';
import { createMemory, storeEmbedding } from './store';
import type { MemoryConfig } from './types';

const logger = createLogger('MemoryFlush');

/**
 * Flush important memories from recent conversation messages.
 * Called before context window compaction.
 *
 * @param recentMessages - Recent conversation messages (user + assistant)
 * @param memoryConfig - Current memory configuration
 * @returns Number of memories flushed
 */
export async function flushMemoriesBeforeCompaction(
  recentMessages: { role: string; content: string }[],
  memoryConfig: MemoryConfig,
): Promise<number> {
  if (!memoryConfig.enabled || !memoryConfig.autoCapture) return 0;

  const embedOptions = getEmbedOptions(memoryConfig);
  let flushed = 0;
  const maxFlush = 5; // Cap to avoid flooding

  // Only process user messages (never capture agent output)
  const userMessages = recentMessages
    .filter((m) => m.role === 'user')
    .slice(-10); // Check last 10 user messages

  for (const msg of userMessages) {
    if (flushed >= maxFlush) break;
    const cleanedText = shouldCapture(
      msg.content,
      memoryConfig.captureMaxChars ?? 500,
    );
    if (!cleanedText) continue;

    // Dedup check
    try {
      const existing = await searchMemories(cleanedText, {
        limit: 1,
        threshold: 0.95,
        embedOptions,
      });
      if (existing.length > 0) continue;
    } catch {
      // Search may fail — proceed with store
    }

    const category = detectCategory(cleanedText);
    const memory = createMemory({
      content: cleanedText,
      category,
      importance: 0.7,
      source: 'auto_capture',
    });
    await storeEmbedding(memory.id, cleanedText, embedOptions);
    flushed++;
    logger.info(
      `Flushed memory: "${cleanedText.slice(0, 50)}..." as ${category}`,
    );
  }

  if (flushed > 0) {
    logger.info(
      `Memory flush complete: ${flushed} memories persisted before compaction`,
    );
  }

  return flushed;
}
