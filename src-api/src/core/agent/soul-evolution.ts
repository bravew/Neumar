/**
 * Soul Evolution Engine
 *
 * Provides correction detection, learning extraction, and soul evolution
 * proposals for the self-improvement loop.
 *
 * Key flows:
 * 1. Correction detection: fast regex scan + LLM-based extraction
 * 2. Learning extraction: periodic LLM-based pattern recognition
 * 3. Soul evolution: accumulated corrections → proposed amendments
 */

import crypto from 'crypto';

import type {
  AgentSoul,
  Correction,
  CorrectionTrigger,
  Learning,
  LearningCategory,
  SoulAmendment,
} from '@/shared/db/types';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('SoulEvolution');

const MIN_CORRECTION_CONFIDENCE = 0.7;

/** Escape delimiters and placeholders in user content to prevent prompt injection. */
function escapeDelimiters(text: string): string {
  return text.replace(/"""/g, "'''").replace(/\{/g, '(').replace(/\}/g, ')');
}

// ============================================================================
// Multilingual Correction Signal Detection
// ============================================================================

const CORRECTION_SIGNALS: Record<string, RegExp[]> = {
  en: [
    /\b(no|wrong|don't|stop|that's not right|incorrect|not what I meant|undo)\b/i,
  ],
  zh: [/不对|不要|错了|别这样|停|不是这样|搞错了|不行|不对的/],
  es: [/\b(no|mal|incorrecto|para|detente|equivocado|no es así)\b/i],
  fr: [/\b(non|faux|incorrect|arrête|pas comme ça|mauvais)\b/i],
  hi: [/नहीं|गलत|रुको|मत करो|सही नहीं|ग़लत/],
  pt: [/\b(não|errado|incorreto|pare|não é assim|parar)\b/i],
};

/**
 * Fast regex scan: does this message look like a correction?
 */
export function detectCorrectionSignal(text: string): boolean {
  for (const patterns of Object.values(CORRECTION_SIGNALS)) {
    for (const pattern of patterns) {
      if (pattern.test(text)) return true;
    }
  }
  return false;
}

// ============================================================================
// LLM-Based Correction Extraction
// ============================================================================

const CORRECTION_EXTRACTION_PROMPT = `You are analyzing a user message that appears to contain a correction or negative feedback to an AI agent.

User message:
"""
{prompt}
"""

If this is a genuine correction (the user is telling the agent it did something wrong), extract:
1. what_went_wrong: What the agent did incorrectly (1 sentence)
2. correct_approach: What the agent should do instead (1 sentence)
3. confidence: How confident you are this is a real correction (0.0-1.0)

If this is NOT a correction (just a normal message containing words like "no" in a non-corrective context), respond with: NOT_A_CORRECTION

Respond in this exact JSON format (no markdown):
{"what_went_wrong": "...", "correct_approach": "...", "confidence": 0.8}
Or: NOT_A_CORRECTION`;

export async function extractCorrection(
  prompt: string,
  callLLM: (p: string) => Promise<string>,
): Promise<Correction | null> {
  try {
    const response = await callLLM(
      CORRECTION_EXTRACTION_PROMPT.replace(
        '{prompt}',
        escapeDelimiters(prompt.slice(0, 500)),
      ),
    );

    const trimmed = response.trim();
    if (
      trimmed === 'NOT_A_CORRECTION' ||
      trimmed.startsWith('NOT_A_CORRECTION')
    ) {
      return null;
    }

    // Try to extract JSON from the response
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as {
      what_went_wrong: string;
      correct_approach: string;
      confidence: number;
    };

    if (!parsed.what_went_wrong || !parsed.correct_approach) return null;
    if (
      typeof parsed.confidence !== 'number' ||
      parsed.confidence < MIN_CORRECTION_CONFIDENCE
    )
      return null;

    return {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      trigger: 'user_negative_feedback' as CorrectionTrigger,
      context: prompt.slice(0, 300),
      what_went_wrong: parsed.what_went_wrong.slice(0, 500),
      correct_approach: parsed.correct_approach.slice(0, 500),
      confidence: Math.min(1, Math.max(0, parsed.confidence)),
    };
  } catch (err) {
    logger.debug(`Correction extraction failed: ${err}`);
    return null;
  }
}

// ============================================================================
// Learning Extraction
// ============================================================================

const LEARNING_EXTRACTION_PROMPT = `Review the following conversation turns and extract useful patterns or learnings about what worked well or what the user prefers.

Conversation:
"""
{conversation}
"""

Extract 0-3 learnings. Each learning should be a concise, reusable pattern.
Categorize each as: pattern, preference, tool_usage, domain_knowledge, or communication.
Mark source as: correction, success, or observation.

Respond in this exact JSON array format (no markdown):
[{"category": "preference", "content": "User prefers concise responses", "source": "observation"}]
Or empty array if no learnings: []`;

export async function extractLearnings(
  conversation: Array<{ role: string; content: string }>,
  callLLM: (p: string) => Promise<string>,
): Promise<Learning[]> {
  try {
    // Build a compact conversation string (last 10 turns, max 2000 chars)
    const recentTurns = conversation.slice(-10);
    const convText = recentTurns
      .map((t) => `${t.role}: ${t.content.slice(0, 200)}`)
      .join('\n')
      .slice(0, 2000);

    const response = await callLLM(
      LEARNING_EXTRACTION_PROMPT.replace(
        '{conversation}',
        escapeDelimiters(convText),
      ),
    );

    const trimmed = response.trim();
    const jsonMatch = trimmed.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      category: string;
      content: string;
      source: string;
    }>;

    if (!Array.isArray(parsed)) return [];

    const validCategories = new Set<string>([
      'pattern',
      'preference',
      'tool_usage',
      'domain_knowledge',
      'communication',
    ]);
    const validSources = new Set<string>([
      'correction',
      'success',
      'observation',
    ]);

    return parsed
      .filter(
        (l) =>
          l.content &&
          validCategories.has(l.category) &&
          validSources.has(l.source),
      )
      .slice(0, 3)
      .map((l) => ({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        category: l.category as LearningCategory,
        content: l.content.slice(0, 500),
        source: l.source as 'correction' | 'success' | 'observation',
        times_applied: 0,
      }));
  } catch (err) {
    logger.debug(`Learning extraction failed: ${err}`);
    return [];
  }
}

// ============================================================================
// Soul Evolution Proposals
// ============================================================================

const EVOLUTION_PROMPT = `You are reviewing corrections and learnings accumulated by an AI agent to propose improvements to its soul configuration.

Current soul identity role: {role}
Current soul tone: {tone}

Accumulated corrections (mistakes to avoid):
{corrections}

Accumulated learnings (proven patterns):
{learnings}

Based on these, propose 0-5 amendments to the agent's soul configuration.
Each amendment should specify which field to modify and what change to make.

Fields you can modify:
- voice.style_rules (add a new style rule)
- cognition.approach_preferences (add a new approach preference)
- identity.opinions (add a new opinion)
- boundaries.escalation_rules (add a new escalation rule)

Do NOT propose changes to:
- identity.core_values (immutable)
- boundaries.red_lines (immutable)

Respond in this exact JSON array format (no markdown):
[{"field": "voice.style_rules", "action": "add", "new_value": "...", "reason": "Based on correction: ..."}]
Or empty array if no changes needed: []`;

export async function proposeSoulEvolution(
  soul: AgentSoul,
  corrections: Correction[],
  learnings: Learning[],
  callLLM: (p: string) => Promise<string>,
): Promise<SoulAmendment[]> {
  try {
    if (corrections.length === 0 && learnings.length === 0) return [];

    const corrText = corrections
      .slice(-20)
      .map(
        (c) =>
          `- Wrong: ${escapeDelimiters(c.what_went_wrong)} → Correct: ${escapeDelimiters(c.correct_approach)}`,
      )
      .join('\n');

    const learnText = learnings
      .slice(-20)
      .map((l) => `- [${l.category}] ${escapeDelimiters(l.content)}`)
      .join('\n');

    const prompt = EVOLUTION_PROMPT.replace(
      '{role}',
      escapeDelimiters(soul.identity.role),
    )
      .replace('{tone}', escapeDelimiters(soul.voice.tone))
      .replace('{corrections}', corrText || 'None')
      .replace('{learnings}', learnText || 'None');

    const response = await callLLM(prompt);
    const trimmed = response.trim();
    const jsonMatch = trimmed.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      field: string;
      action: string;
      old_value?: string;
      new_value: string;
      reason: string;
    }>;

    if (!Array.isArray(parsed)) return [];

    const validActions = new Set(['add', 'modify', 'remove']);
    const immutableFields = new Set([
      'identity.core_values',
      'boundaries.red_lines',
    ]);

    return parsed
      .filter(
        (a) =>
          a.field &&
          a.new_value &&
          a.reason &&
          validActions.has(a.action) &&
          !immutableFields.has(a.field),
      )
      .slice(0, 5)
      .map((a) => ({
        field: a.field,
        action: a.action as 'add' | 'modify' | 'remove',
        old_value: a.old_value,
        new_value: a.new_value,
        reason: a.reason,
      }));
  } catch (err) {
    logger.debug(`Soul evolution proposal failed: ${err}`);
    return [];
  }
}
