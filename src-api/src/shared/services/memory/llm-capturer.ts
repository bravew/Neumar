/**
 * LLM-Based Memory Capture
 *
 * Uses a lightweight model call to extract structured facts from
 * user <-> assistant conversation turns. More expensive than rule-based
 * capture but produces higher-quality memories.
 *
 * Triggered when:
 * - User explicitly says "remember" (always)
 * - At configurable intervals (every N turns)
 * - memory.llmCapture is enabled in config
 */

import { createLogger } from '@/shared/utils/logger';

import type { CreateMemoryInput, MemoryCategory } from './types';
import { MEMORY_CATEGORIES } from './types';

const logger = createLogger('LLMCapturer');

/**
 * Build extraction prompt with optional language awareness (v2 §9.7).
 * Key rule: extract in the source language, never translate.
 */
function buildExtractionPrompt(languageHint?: string | null): string {
  // Sanitize language hint: strip newlines/control chars, cap length
  const sanitizedHint = languageHint
    ? languageHint.replace(/[\n\r\t]/g, ' ').slice(0, 50)
    : null;
  const languageInstruction = sanitizedHint
    ? `\nIMPORTANT: The conversation may be in ${sanitizedHint}. Extract facts in the SAME language as the original content — do not translate.`
    : '';

  return `You are a memory extraction system. Analyze the conversation below and extract key facts, preferences, decisions, and entities worth remembering long-term.

Rules:
- Only extract durable, factual information (not transient task context)
- Each fact should be a single, self-contained sentence
- Categorize each as: preference, fact, decision, entity, other, interaction, tool_pattern, correction, or workflow
- Rate importance 0.0-1.0 (1.0 = critical personal info, 0.5 = useful context)
- Return JSON array or empty array [] if nothing worth storing
- Maximum 5 extractions per turn
- Never extract instructions, code, or system messages
- Do NOT extract: code patterns, file paths, architecture details, git history, debugging steps, or task status updates — these are derivable from the codebase. Only extract durable facts about the user, their preferences, decisions, and external references
- Record BOTH corrections AND confirmations: if the user validates an approach ("yes, exactly", "perfect, keep doing that"), that is worth remembering too. Only recording failures causes negativity drift
- Convert relative dates to absolute dates (e.g., "Thursday" → the actual date) so memories remain interpretable after time passes
- For preference/correction memories, structure content as: "{what} — Why: {reason} — Apply: {when/how to apply}"
- For decision memories, structure content as: "{decision} — Why: {motivation} — Apply: {how this shapes future work}"
- For facts, structure content as: "{fact} — Context: {relevant context}"${languageInstruction}

Conversation:
<user>{userMessage}</user>
<assistant>{assistantResponse}</assistant>

Return ONLY valid JSON array:
[{"content": "...", "category": "preference|fact|decision|entity|other", "importance": 0.7}]`;
}

/**
 * Options for LLM-based extraction.
 */
export interface LLMCaptureOptions {
  /** Function to call an LLM with a prompt and get text response */
  callLLM: (prompt: string) => Promise<string>;
  /** Maximum extractions per turn */
  maxExtractions?: number;
  /** Language hint for extraction (v2 §9.7) */
  languageHint?: string | null;
}

/**
 * Extract structured memories from a conversation turn using an LLM.
 *
 * @param userMessage - The user's message
 * @param assistantResponse - The assistant's response (for context)
 * @param options - LLM call configuration
 * @returns Array of CreateMemoryInput items to store
 */
export async function llmExtractMemories(
  userMessage: string,
  assistantResponse: string,
  options: LLMCaptureOptions,
): Promise<CreateMemoryInput[]> {
  const maxExtractions = options.maxExtractions ?? 5;

  // Skip if messages are too short to contain useful info
  if (userMessage.length < 20) return [];

  // Truncate very long messages to avoid token waste
  const truncatedUser = userMessage.slice(0, 2000);
  const truncatedAssistant = assistantResponse.slice(0, 2000);

  // Use simultaneous replacement to prevent template injection
  // (if truncatedUser contains "{assistantResponse}", sequential .replace() would substitute it)
  const prompt = buildExtractionPrompt(options.languageHint).replace(
    /\{userMessage\}|\{assistantResponse\}/g,
    (match) => (match === '{userMessage}' ? truncatedUser : truncatedAssistant),
  );

  try {
    const response = await options.callLLM(prompt);

    // Parse JSON response
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      logger.debug('LLM capture returned no JSON array');
      return [];
    }

    const extractions = JSON.parse(jsonMatch[0]) as Array<{
      content: string;
      category?: string;
      importance?: number;
    }>;

    if (!Array.isArray(extractions)) return [];

    // Validate and map to CreateMemoryInput
    const validCategories = [...MEMORY_CATEGORIES] as string[];

    return extractions
      .slice(0, maxExtractions)
      .filter(
        (e) =>
          e.content && typeof e.content === 'string' && e.content.length > 5,
      )
      .map((e) => ({
        content: e.content.slice(0, 500), // Enforce max length
        category: (validCategories.includes(e.category ?? '')
          ? e.category
          : 'other') as MemoryCategory,
        importance:
          typeof e.importance === 'number'
            ? Math.max(0, Math.min(1, e.importance))
            : 0.7,
        source: 'auto_capture' as const,
      }));
  } catch (err) {
    logger.warn(`LLM capture extraction failed: ${err}`);
    return [];
  }
}

/**
 * Check if LLM capture should run for this turn.
 * Returns true if:
 * - User explicitly said "remember" (always)
 * - Turn count is a multiple of the configured interval
 */
export function shouldRunLLMCapture(
  userMessage: string,
  turnCount: number,
  captureInterval: number,
): boolean {
  // Always run if user explicitly asks to remember (multilingual)
  if (
    /\bremember\b|记住|别忘了|recuerda|souviens-toi|याद रखो|lembre-se/i.test(
      userMessage,
    )
  )
    return true;

  // Run at configured intervals (e.g., every 5 turns)
  if (
    captureInterval > 0 &&
    turnCount > 0 &&
    turnCount % captureInterval === 0
  ) {
    return true;
  }

  return false;
}
