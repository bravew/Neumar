/**
 * Journal Distiller — extract durable memories from session journal entries.
 *
 * At session end (or on-demand), reads accumulated journal observations,
 * sends them to an LLM for extraction of durable facts/preferences/decisions,
 * deduplicates against existing memories, and creates new records.
 *
 * Inspired by Claude Code memdir's nightly distillation process.
 */

import { createLogger } from '@/shared/utils/logger';

import { getEmbedOptions, getMemoryConfig } from './config';
import { searchMemories } from './retriever';
import { clearJournal, getJournalEntries } from './session-journal';
import { createMemory, storeEmbedding } from './store';
import type { LLMCallFn } from './types';

const logger = createLogger('JournalDistiller');

/** Minimum entries to justify distillation (skip for trivial sessions). */
const MIN_ENTRIES_FOR_DISTILLATION = 3;

/**
 * Distill a session's journal entries into durable memories.
 *
 * @param sessionId - The session whose journal to distill
 * @param callLLM - Function to invoke an LLM for extraction
 * @param clearAfter - Whether to clear the journal after distillation (default: true)
 * @returns Number of new memories created
 */
export async function distillJournal(
  sessionId: string,
  callLLM: LLMCallFn,
  clearAfter = true,
): Promise<number> {
  const entries = getJournalEntries(sessionId);

  if (entries.length < MIN_ENTRIES_FOR_DISTILLATION) {
    logger.debug(
      `[${sessionId}] Skipping distillation — only ${entries.length} entries (min: ${MIN_ENTRIES_FOR_DISTILLATION})`,
    );
    return 0;
  }

  const journalText = entries
    .map((e) => `[${e.createdAt}] ${e.content}`)
    .join('\n');

  const prompt = `You are a memory distillation system. Analyze the following session journal and extract durable facts, preferences, decisions, and important context worth remembering long-term.

Rules:
- Only extract information that will be useful in future sessions
- Do NOT extract: code patterns, file paths, debugging steps, or transient task details
- Each extraction should be a self-contained sentence
- For preferences/corrections, structure as: "{what} — Why: {reason} — Apply: {when/how}"
- For decisions, structure as: "{decision} — Why: {motivation} — Apply: {how this shapes future work}"
- Categorize each as: preference, fact, decision, entity, correction, or other
- Rate importance 0.0-1.0
- Maximum 10 extractions
- Extract in the same language as the journal content — do not translate

Journal:
${journalText.slice(0, 4000)}

Return ONLY valid JSON array:
[{"content": "...", "category": "preference|fact|decision|entity|correction|other", "importance": 0.7}]`;

  try {
    const response = await callLLM(prompt);
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      logger.debug(`[${sessionId}] Distillation returned no JSON array`);
      return 0;
    }

    const extractions = JSON.parse(jsonMatch[0]) as Array<{
      content: string;
      category?: string;
      importance?: number;
    }>;

    if (!Array.isArray(extractions)) return 0;

    const config = getMemoryConfig();
    const embedOptions = getEmbedOptions(config);
    let created = 0;

    for (const ext of extractions.slice(0, 10)) {
      if (
        !ext.content ||
        typeof ext.content !== 'string' ||
        ext.content.length < 5
      )
        continue;

      // Dedup: check if a very similar memory already exists
      try {
        const existing = await searchMemories(ext.content, {
          limit: 1,
          threshold: 0.9,
          embedOptions,
        });
        if (existing.length > 0) {
          logger.debug(
            `[${sessionId}] Distillation dedup: "${ext.content.slice(0, 50)}..." matches existing`,
          );
          continue;
        }
      } catch {
        // Search may fail — proceed with creation
      }

      const mem = createMemory({
        content: ext.content.slice(0, 500),
        category: (ext.category ?? 'other') as
          | 'preference'
          | 'fact'
          | 'decision'
          | 'entity'
          | 'correction'
          | 'other',
        importance:
          typeof ext.importance === 'number'
            ? Math.max(0, Math.min(1, ext.importance))
            : 0.7,
        source: 'auto_capture',
        sessionId,
      });

      storeEmbedding(mem.id, ext.content, embedOptions).catch((err) => {
        logger.warn(`[${sessionId}] Distilled memory embedding failed: ${err}`);
      });
      created++;
      logger.info(
        `[${sessionId}] Distilled memory: "${ext.content.slice(0, 50)}..." (${ext.category})`,
      );
    }

    // Clear journal after successful distillation
    if (clearAfter && created > 0) {
      clearJournal(sessionId);
    }

    logger.info(
      `[${sessionId}] Journal distillation complete: ${created} memories from ${entries.length} entries`,
    );
    return created;
  } catch (err) {
    logger.warn(`[${sessionId}] Journal distillation failed: ${err}`);
    return 0;
  }
}
