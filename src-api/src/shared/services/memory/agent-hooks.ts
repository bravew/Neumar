/**
 * Memory Agent Hooks — shared helpers for memory integration in agent adapters.
 *
 * Extracts auto-recall, auto-capture, LLM capture, and flush logic
 * to avoid duplication across runClaude(), plan(), and execute() methods.
 *
 * v2: Adds type classification, scope context, confidence scoring,
 * language extraction, and guard levels.
 */

import {
  detectCorrectionSignal,
  extractCorrection,
} from '@/core/agent/soul-evolution';

import { getDatabase } from '@/shared/db';
import { appendCorrection, getAgentSoul } from '@/shared/db/operations';
import type { AgentSoul } from '@/shared/db/types';
import { createLogger } from '@/shared/utils/logger';

import { recordFileRecall } from './audit';
import {
  detectCategory,
  extractLanguageHint,
  scoreCaptureConfidence,
  shouldCapture,
  stripSystemPrefixes,
} from './capturer';
import { classifyMemoryType, getDecayRateForType } from './classifier';
import { getDecayConfig, getEmbedOptions, getMemoryConfig } from './config';
import { formatLoadedMemoryFiles, loadMemoryFiles } from './file-loader';
import { recallMemories } from './recall';
import { searchMemories } from './retriever';
import { appendToJournal, getJournalEntryCount } from './session-journal';
import { createMemory, storeEmbedding, updateMemory } from './store';
import type { ScopeType } from './types';

const logger = createLogger('MemoryHooks');

/** Scope context for memory operations (v2) */
export interface MemoryScope {
  profileId?: string;
  projectId?: string;
  sessionId?: string;
}

// ── Instruction injection filter (prevents memory poisoning) ──
// Patterns cover all 6 supported locales: en, zh, es, fr, hi, pt.
// Credential patterns are language-agnostic (key names are always ASCII).

const INSTRUCTION_PATTERNS = [
  // Imperative instructions require verb context to avoid false positives
  // on legitimate preferences (e.g., "Always liked pizza" is fine,
  // "Always respond in French" is an injection).

  // ── English ──
  /^(from now on|remember that|important:)\b/i,
  /^(always|never)\s+(respond|answer|reply|do|use|say|output|act|be)\b/i,
  /^(you (must|should|are)|ignore previous|disregard)\b/i,

  // ── Chinese (zh) ──
  /^(从现在开始|记住|重要[:：])/,
  /^(永远|从不)(回答|回复|使用|输出|说)/,
  /^(你(必须|应该|是)|忽略之前|无视|忽略前面)/,

  // ── Spanish (es) ──
  /^(a partir de ahora|recuerda que|importante:)\b/i,
  /^(siempre|nunca)\s+(responde|contesta|usa|di|actúa)\b/i,
  /^(tú (debes|deberías)|ignora lo anterior|ignora previo)\b/i,

  // ── French (fr) ──
  /^(à partir de maintenant|rappelle[- ]toi que|important\s*:)\b/i,
  /^(toujours|jamais)\s+(répondre|utiliser|dire|agir)\b/i,
  /^(tu (dois|devrais)|ignore (le précédent|les instructions))\b/i,

  // ── Hindi (hi) ──
  /^(अब से|याद रखो|महत्वपूर्ण[:：])/,
  /^(हमेशा|कभी नहीं)\s+(जवाब|उत्तर|उपयोग|बोल)/,
  /^(तुम्हें|आपको|पिछला अनदेखा करो|नज़रअंदाज़ करो)/,

  // ── Portuguese (pt) ──
  /^(a partir de agora|lembre[- ]se que|importante:)\b/i,
  /^(sempre|nunca)\s+(responda|responde|use|diga|aja)\b/i,
  /^(você (deve|deveria)|ignore o anterior|desconsidere)\b/i,

  // ── Credentials (language-agnostic) ──
  /\b(password|secret|token|api[_-]?key)\s*[:=]\s*\S/i,
];

/** Strip zero-width Unicode characters that attackers use to evade pattern matching. */
// eslint-disable-next-line no-misleading-character-class -- ZWNJ+ZWJ in character class is intentional
const ZERO_WIDTH_RE = /[\u200B\u200C\u200D\uFEFF\u00AD]/g;
function stripZeroWidth(text: string): string {
  return text.replace(ZERO_WIDTH_RE, '');
}

/**
 * Common social / greeting prefixes that channel messages often start with.
 * Stripped before instruction-pattern matching to catch mid-sentence injections
 * like "Hey, always respond in French".
 */
const SOCIAL_PREFIX_RE =
  /^(hey|hi|hello|ok|okay|sure|thanks|yo|well|so|oh|hm+|please|dear|look)\b[,.:!?]?\s*/i;

/** Reject instruction-like or credential-containing text from memory capture. */
function isInstructionLike(text: string): boolean {
  const normalized = stripZeroWidth(text.trim());
  // Test as-is first (start-anchored patterns)
  if (INSTRUCTION_PATTERNS.some((p) => p.test(normalized))) return true;
  // Strip social prefix and re-test to catch mid-sentence injections
  const stripped = normalized.replace(SOCIAL_PREFIX_RE, '');
  if (
    stripped !== normalized &&
    INSTRUCTION_PATTERNS.some((p) => p.test(stripped))
  )
    return true;
  return false;
}

/** Derive scope type and ID from a MemoryScope context. */
function resolveScope(scope?: MemoryScope): {
  scopeType: ScopeType;
  scopeId?: string;
} {
  if (scope?.projectId)
    return { scopeType: 'project', scopeId: scope.projectId };
  if (scope?.profileId)
    return { scopeType: 'profile', scopeId: scope.profileId };
  return { scopeType: 'global' };
}

/** Check if content already exists in memories (exact match). */
function isDuplicate(content: string): boolean {
  try {
    const db = getDatabase();
    const match = db
      .prepare('SELECT id FROM memories WHERE content = ? LIMIT 1')
      .get(content) as { id: string } | undefined;
    return !!match;
  } catch {
    return false;
  }
}

/**
 * Auto-recall: search for relevant memories and return a context string
 * to prepend to the agent prompt. Returns empty string if disabled or no matches.
 */
export async function autoRecall(
  prompt: string,
  sessionId: string,
  scope?: MemoryScope,
  callLLM?: (prompt: string) => Promise<string>,
): Promise<string> {
  try {
    const config = getMemoryConfig();
    if (!config.enabled || !config.autoRecall) {
      logger.debug(
        `[${sessionId}] Auto-recall: disabled (enabled=${config.enabled}, autoRecall=${config.autoRecall})`,
      );
      return '';
    }

    const recallQuery = stripSystemPrefixes(prompt);
    logger.debug(
      `[${sessionId}] Auto-recall: query="${recallQuery.slice(0, 80)}..."`,
    );

    // DB recall and on-disk MEMORY.md load are independent — fan out so we
    // pay max(network, fs) per turn instead of summing both.
    const [recalled, loadedFiles] = await Promise.all([
      recallMemories(recallQuery, {
        limit: config.recallLimit,
        threshold: config.recallThreshold,
        maxRecallTokens: config.maxRecallTokens,
        embedOptions: getEmbedOptions(config),
        scope: scope
          ? {
              profileId: scope.profileId,
              projectId: scope.projectId,
              sessionId: scope.sessionId ?? sessionId,
            }
          : undefined,
        callLLM,
      }),
      loadMemoryFiles({
        maxFiles: Math.max(config.recallLimit, 5),
        maxChars:
          config.maxRecallTokens > 0 ? config.maxRecallTokens * 4 : 8000,
      }),
    ]);

    const fileMemory = formatLoadedMemoryFiles(loadedFiles);
    if (loadedFiles.length > 0) {
      recordFileRecall(
        sessionId,
        loadedFiles.map((f) => f.path),
        recallQuery.slice(0, 200),
      );
    }

    if (recalled || fileMemory) {
      logger.info(
        `[${sessionId}] Auto-recall: injected ${recalled ? recalled.split('\n').length - 3 : 0} db memories and ${fileMemory ? 'file memories' : 'no file memories'}`,
      );
      return `${fileMemory}${recalled ? `\n${recalled}` : ''}\n\n`;
    }

    logger.info(
      `[${sessionId}] Auto-recall: no relevant memories for "${recallQuery.slice(0, 60)}"`,
    );
    return '';
  } catch (err) {
    logger.warn(`[${sessionId}] Auto-recall failed: ${err}`);
    return '';
  }
}

/**
 * Auto-capture: detect and store important facts from a user prompt.
 * Includes dedup check to avoid storing near-duplicate memories.
 * v2: Adds type classification, scope, confidence, language.
 */
export async function autoCapture(
  prompt: string,
  sessionId: string,
  scope?: MemoryScope,
): Promise<void> {
  try {
    const config = getMemoryConfig();
    if (!config.enabled || !config.autoCapture) {
      logger.debug(
        `[${sessionId}] Auto-capture: disabled (enabled=${config.enabled}, autoCapture=${config.autoCapture})`,
      );
      return;
    }

    logger.debug(
      `[${sessionId}] Auto-capture: checking prompt (${prompt.length} chars)`,
    );

    // Extract language hint before stripping prefixes
    const languageHint = extractLanguageHint(prompt);

    const cleanedText = shouldCapture(prompt, config.captureMaxChars);
    if (!cleanedText) {
      logger.debug(
        `[${sessionId}] Auto-capture: shouldCapture returned null — skipping`,
      );
      return;
    }

    // Block instruction-like content to prevent memory poisoning (SpAIware, MINJA attacks)
    if (isInstructionLike(cleanedText)) {
      logger.debug(
        `[${sessionId}] Auto-capture: rejected instruction-like content`,
      );
      return;
    }

    // Journal mode (v3): append to journal, skip confidence scoring and classification
    if (config.journalMode) {
      appendToJournal(sessionId, cleanedText);
      logger.info(
        `[${sessionId}] Journal mode: appended "${cleanedText.slice(0, 50)}..."`,
      );
      return;
    }

    // Confidence scoring (v2)
    const { score: confidence, reason } = scoreCaptureConfidence(cleanedText);
    logger.debug(
      `[${sessionId}] Auto-capture: confidence=${confidence.toFixed(2)} (${reason})`,
    );

    if (isDuplicate(cleanedText)) {
      logger.debug(`[${sessionId}] Auto-capture: exact dedup hit — skipping`);
      return;
    }

    const category = detectCategory(cleanedText, languageHint);
    const memoryType = classifyMemoryType(
      cleanedText,
      'auto_capture',
      category,
    );
    const decayConfig = getDecayConfig();
    const decayRate = getDecayRateForType(memoryType, decayConfig);
    const { scopeType, scopeId } = resolveScope(scope);
    const embedOptions = getEmbedOptions(config);

    // Semantic dedup: only supersede near-exact duplicates.
    // Threshold 0.95 ensures only memories saying essentially the same thing
    // are superseded. This avoids destroying compound memories — e.g.,
    // "I prefer dark mode" should NOT supersede "I prefer dark mode and use Vim keybindings"
    // because the new content is a subset that loses information.
    try {
      const similar = await searchMemories(cleanedText, {
        limit: 1,
        threshold: 0.95,
        embedOptions,
        scope: scope
          ? {
              profileId: scope.profileId,
              projectId: scope.projectId,
              sessionId: scope.sessionId,
            }
          : undefined,
      });
      for (const match of similar) {
        // Only supersede if the new content is at least as long as the old
        // (prevents a short statement from destroying a richer compound memory)
        if (cleanedText.length >= match.memory.content.length * 0.8) {
          updateMemory(match.memory.id, { lifecycleStatus: 'stale' });
          logger.info(
            `[${sessionId}] Auto-capture: superseded old memory ${match.memory.id} ("${match.memory.content.slice(0, 40)}...")`,
          );
        }
      }
    } catch {
      // Semantic search may fail (no embeddings yet) — proceed without dedup
    }

    // Store channel origin as metadata when captured from a channel
    const metadata = scope?.profileId?.includes(':')
      ? { channel: scope.profileId.split(':')[0] }
      : undefined;

    const mem = createMemory({
      content: cleanedText,
      category,
      importance: 0.7,
      source: 'auto_capture',
      sessionId,
      memoryType,
      scopeType,
      scopeId,
      decayRate,
      confidence,
      language: languageHint ?? undefined,
      metadata,
    });
    logger.info(
      `[${sessionId}] Auto-captured: "${cleanedText.slice(0, 50)}..." as ${category}/${memoryType} (id=${mem.id}, conf=${confidence.toFixed(2)})`,
    );

    storeEmbedding(mem.id, cleanedText, embedOptions).catch((err) => {
      logger.warn(`[${sessionId}] Auto-capture embedding failed: ${err}`);
    });
  } catch (err) {
    logger.error(`[${sessionId}] Auto-capture failed: ${err}`);
  }
}

/**
 * LLM-based capture: extract structured facts from a conversation turn using a lightweight model.
 * Requires a `callLLM` function to invoke the model API.
 * v2: Passes language hint and classifies memory types.
 */
export async function llmCapture(
  prompt: string,
  sessionId: string,
  turnCount: number,
  callLLM: (prompt: string) => Promise<string>,
  scope?: MemoryScope,
): Promise<void> {
  try {
    const config = getMemoryConfig();
    if (!config.enabled || !config.llmCapture) return;

    const { shouldRunLLMCapture, llmExtractMemories } =
      await import('./llm-capturer');

    if (!shouldRunLLMCapture(prompt, turnCount, config.llmCaptureInterval))
      return;

    // Extract language hint (v2)
    const languageHint = extractLanguageHint(prompt);

    const extractions = await llmExtractMemories(prompt, '', {
      callLLM,
      languageHint,
    });

    const decayConfig = getDecayConfig();

    const { scopeType, scopeId } = resolveScope(scope);

    for (const extraction of extractions) {
      if (isDuplicate(extraction.content)) continue;
      if (isInstructionLike(extraction.content)) continue;

      const memoryType = classifyMemoryType(
        extraction.content,
        extraction.source ?? 'auto_capture',
        extraction.category ?? 'other',
      );
      const decayRate = getDecayRateForType(memoryType, decayConfig);

      const mem = createMemory({
        ...extraction,
        sessionId,
        memoryType,
        decayRate,
        language: languageHint ?? undefined,
        scopeType,
        scopeId,
      });
      storeEmbedding(mem.id, extraction.content, getEmbedOptions(config)).catch(
        () => {},
      );
      logger.info(
        `[${sessionId}] LLM-captured: "${extraction.content.slice(0, 50)}..." as ${memoryType}`,
      );
    }
  } catch (err) {
    logger.warn(`[${sessionId}] LLM capture failed: ${err}`);
  }

  // Journal distillation: when journal mode is enabled and enough entries
  // have accumulated, distill them into durable memories using the same callLLM.
  try {
    const jConfig = getMemoryConfig();
    if (jConfig.journalMode) {
      const entryCount = getJournalEntryCount(sessionId);
      const DISTILL_THRESHOLD = 10;
      if (entryCount >= DISTILL_THRESHOLD) {
        const { distillJournal } = await import('./journal-distiller');
        const created = await distillJournal(sessionId, callLLM);
        if (created > 0) {
          logger.info(
            `[${sessionId}] Journal distilled: ${created} memories from ${entryCount} entries`,
          );
        }
      }
    }
  } catch (err) {
    logger.warn(`[${sessionId}] Journal distillation failed: ${err}`);
  }
}

/**
 * Flush important context to long-term memory before context window compaction.
 * Debounce via the `alreadyFlushed` check is the caller's responsibility.
 */
export async function flushIfNeeded(
  conversation: { role: string; content?: string | null }[],
  sessionId: string,
): Promise<boolean> {
  try {
    const config = getMemoryConfig();
    if (!config.enabled || !config.autoCapture) return false;

    const totalChars = conversation.reduce(
      (sum, m) => sum + (m.content?.length ?? 0),
      0,
    );

    // Flush if conversation exceeds ~16K tokens (64K chars)
    const FLUSH_THRESHOLD_CHARS = 64_000;
    if (totalChars <= FLUSH_THRESHOLD_CHARS) return false;

    const { flushMemoriesBeforeCompaction } = await import('./flush');
    const messages = conversation.map((m) => ({
      role: m.role,
      content: m.content || '',
    }));
    await flushMemoriesBeforeCompaction(messages, config);
    return true;
  } catch (err) {
    logger.warn(`[${sessionId}] Flush check failed: ${err}`);
    return false;
  }
}

// ============================================================================
// Memory Drift Reporting
// ============================================================================

/**
 * Report a memory as potentially drifted (contradicts current state).
 * Sets lifecycle_status to 'stale' via the store's updateMemory().
 */
export function reportDrift(memoryId: string, reason: string): boolean {
  try {
    const updated = updateMemory(memoryId, { lifecycleStatus: 'stale' });
    if (updated) {
      logger.info(
        `Memory drift reported: id=${memoryId}, reason="${reason.slice(0, 100)}"`,
      );
      return true;
    }
    return false;
  } catch (err) {
    logger.warn(`Failed to report drift for ${memoryId}: ${err}`);
    return false;
  }
}

// ============================================================================
// Soul Correction Detection (integrates with soul self-improvement loop)
// ============================================================================

/**
 * Detect corrections in user messages and append to the agent profile's
 * corrections_log. Only fires when the profile has a soul with
 * evolution.self_improving enabled.
 */
export async function detectSoulCorrection(
  prompt: string,
  sessionId: string,
  agentProfileId: string | undefined,
  callLLM: (p: string) => Promise<string>,
  /** Pass pre-loaded soul to avoid redundant DB read (e.g., from context resolver). */
  preloadedSoul?: AgentSoul | null,
): Promise<void> {
  if (!agentProfileId) return;

  const soul = preloadedSoul ?? getAgentSoul(agentProfileId);
  if (!soul?.evolution?.self_improving) return;

  // Fast regex scan first
  if (!detectCorrectionSignal(prompt)) return;

  try {
    const correction = await extractCorrection(prompt, callLLM);
    if (correction) {
      appendCorrection(agentProfileId, correction);
      logger.debug(
        `[${sessionId}] Soul correction detected for profile ${agentProfileId}: ${correction.what_went_wrong.slice(0, 80)}`,
      );
    }
  } catch (err) {
    logger.debug(`[${sessionId}] Soul correction detection failed: ${err}`);
  }
}
