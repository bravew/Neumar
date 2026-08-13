/**
 * Condition Evaluator
 *
 * Three-layer evaluation for check-and-notify automations.
 * Cheapest checks first to minimize LLM costs.
 *
 * Layer 1: Hash/diff check (zero cost) — SHA-256 of result
 * Layer 2: Keyword heuristic (zero cost) — simple pattern matching
 * Layer 3: LLM judge (Haiku, ~$0.001/eval)
 */

import { createHash } from 'node:crypto';

import { errorMessage } from '@/shared/utils/errors';
import { createLogger } from '@/shared/utils/logger';

import type { AutomationCondition } from './types';

const logger = createLogger('ConditionEvaluator');

// ============================================================================
// Types
// ============================================================================

export interface ConditionEvalResult {
  satisfied: boolean;
  reason: string;
  /** True if Layer 1 (hash check) determined the result was unchanged */
  skippedByHash?: boolean;
  /** True if Layer 2 (heuristic) was used instead of LLM */
  usedHeuristic?: boolean;
  /** Updated hash of the result — caller should persist this for next comparison */
  resultHash?: string;
}

/** Function signature for calling the LLM judge */
export type LLMCallFn = (
  systemPrompt: string,
  userPrompt: string,
) => Promise<string>;

// ============================================================================
// Public API
// ============================================================================

/**
 * Evaluate whether a run result meets the automation's notification condition.
 *
 * Three-layer evaluation (cheapest first):
 * 1. Hash check: if result is identical to last run → skip
 * 2. Keyword heuristic: after N quiet runs, use simple matching
 * 3. LLM judge: ask Haiku to evaluate condition
 */
export async function evaluateCondition(
  result: string,
  condition: AutomationCondition,
  state: { lastResultHash?: string; consecutiveQuietRuns: number },
  callLLM: LLMCallFn,
): Promise<ConditionEvalResult> {
  // Layer 1: Hash/diff check
  const resultHash = hashResult(result);

  if (state.lastResultHash && resultHash === state.lastResultHash) {
    logger.debug('Condition Layer 1: result unchanged (hash match)');
    return {
      satisfied: false,
      reason: 'Result unchanged from previous run',
      skippedByHash: true,
      resultHash,
    };
  }

  // Layer 2: Keyword heuristic (after skipAfterQuietRuns threshold)
  const quietThreshold = condition.skipAfterQuietRuns ?? 5;
  if (state.consecutiveQuietRuns >= quietThreshold) {
    const heuristicResult = evaluateHeuristic(result, condition.description);
    if (!heuristicResult.mightMatch) {
      logger.debug('Condition Layer 2: heuristic says no match');
      return {
        satisfied: false,
        reason: `Heuristic: ${heuristicResult.reason}`,
        usedHeuristic: true,
        resultHash,
      };
    }
    // Heuristic suggests possible match — fall through to LLM
    logger.debug(
      'Condition Layer 2: heuristic suggests possible match, using LLM',
    );
  }

  // Layer 3: LLM judge
  try {
    const llmResult = await evaluateWithLLM(result, condition, callLLM);
    return { ...llmResult, resultHash };
  } catch (err) {
    logger.error('Condition Layer 3: LLM evaluation failed', { error: err });
    // On LLM failure, err on the side of delivering (satisfied = true)
    return {
      satisfied: true,
      reason: `LLM evaluation failed: ${errorMessage(err)}. Delivering as a precaution.`,
      resultHash,
    };
  }
}

// ============================================================================
// Layer 1: Hash Check
// ============================================================================

function hashResult(result: string): string {
  return createHash('sha256').update(result).digest('hex');
}

// ============================================================================
// Layer 2: Keyword Heuristic
// ============================================================================

function evaluateHeuristic(
  result: string,
  conditionDescription: string,
): { mightMatch: boolean; reason: string } {
  const lower = result.toLowerCase();
  const condLower = conditionDescription.toLowerCase();

  // Extract potential keywords from condition description
  // "price below $800" → look for price-related numbers
  // "build fails" → look for "fail", "error", "broken"

  const priceMatch = condLower.match(
    /(?:price|cost|below|under|above|over)\s+\$?(\d+)/,
  );
  if (priceMatch) {
    // Look for numbers in the result that might be prices
    const numbers = result.match(/\$\s*[\d,]+\.?\d*/g);
    if (numbers && numbers.length > 0) {
      return { mightMatch: true, reason: 'Found price-like numbers in result' };
    }
    return { mightMatch: false, reason: 'No price-like numbers found' };
  }

  // Check for failure/error keywords
  if (/fail|error|broken|crash|down/.test(condLower)) {
    if (/fail|error|broken|crash|down|exception/.test(lower)) {
      return { mightMatch: true, reason: 'Found error-related keywords' };
    }
    return { mightMatch: false, reason: 'No error-related keywords found' };
  }

  // Check for "new" / "update" keywords
  if (/new|update|change|release|announce/.test(condLower)) {
    if (/new|update|change|release|announce|launch|introduce/.test(lower)) {
      return { mightMatch: true, reason: 'Found update-related keywords' };
    }
    return { mightMatch: false, reason: 'No update-related keywords found' };
  }

  // Default: can't determine, use LLM
  return { mightMatch: true, reason: 'Heuristic inconclusive' };
}

// ============================================================================
// Layer 3: LLM Judge
// ============================================================================

async function evaluateWithLLM(
  result: string,
  condition: AutomationCondition,
  callLLM: LLMCallFn,
): Promise<ConditionEvalResult> {
  const systemPrompt = `You are a condition evaluator. Given a monitoring result and a condition, determine if the condition is satisfied.
Reply ONLY with a JSON object: { "satisfied": boolean, "reason": "brief explanation" }
Do not include any other text.`;

  const userPrompt = `Monitoring result:
${result.slice(0, 2000)}

Condition: "${condition.description}"

Is the condition satisfied? Reply with JSON only.`;

  const response = await callLLM(systemPrompt, userPrompt);

  try {
    // Parse JSON from response (handle markdown code blocks)
    const jsonStr = response.replace(/```json?\n?|\n?```/g, '').trim();
    const parsed = JSON.parse(jsonStr) as {
      satisfied: boolean;
      reason: string;
    };

    return {
      satisfied: parsed.satisfied,
      reason: parsed.reason,
    };
  } catch {
    logger.warn('Failed to parse LLM judge response, treating as satisfied', {
      response: response.slice(0, 200),
    });
    return {
      satisfied: true,
      reason: 'Could not parse LLM response. Delivering as a precaution.',
    };
  }
}
