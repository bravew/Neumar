/**
 * Maximal Marginal Relevance (MMR) Re-ranking
 *
 * Prevents the recall budget from being wasted on near-duplicate memories.
 * Balances relevance to the query and diversity among selected results.
 *
 * Score = λ × relevance(d, q) − (1−λ) × max(similarity(d, selected))
 *
 * Uses token-level Jaccard similarity with CJK bigram support for textual
 * diversity measurement (following OpenClaw's approach for multilingual
 * consistency — no embedding lookups needed).
 */

import type { MemorySearchResult } from './types';

// CJK Unicode ranges for bigram tokenization
const CJK_REGEX =
  /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF\u{20000}-\u{2A6DF}\u{2A700}-\u{2B73F}\u{2B740}-\u{2B81F}\u{2B820}-\u{2CEAF}\u{2CEB0}-\u{2EBEF}\u{30000}-\u{3134F}\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]/u;

/**
 * Token-level Jaccard similarity with CJK bigram support.
 *
 * For Latin text: tokenize on whitespace + punctuation, lowercase.
 * For CJK text: use character bigrams (each pair of adjacent CJK chars).
 * Mixed text: union of both tokenization strategies.
 */
export function jaccardSimilarity(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);

  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }

  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Tokenize text for Jaccard similarity.
 * Produces word tokens for Latin text and character bigrams for CJK text.
 */
function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  const lower = text.toLowerCase();

  // Latin word tokens
  const words = lower.match(/[\p{L}\p{N}]+/gu);
  if (words) {
    for (const word of words) {
      // Skip if the word is entirely CJK (handled by bigrams below)
      if (!CJK_REGEX.test(word)) {
        tokens.add(word);
      }
    }
  }

  // CJK character bigrams
  const cjkChars: string[] = [];
  for (const char of lower) {
    if (CJK_REGEX.test(char)) {
      cjkChars.push(char);
    }
  }

  // Single CJK chars as tokens too (for short text)
  for (const char of cjkChars) {
    tokens.add(char);
  }
  // Bigrams for better matching
  for (let i = 0; i < cjkChars.length - 1; i++) {
    tokens.add(cjkChars[i]! + cjkChars[i + 1]!);
  }

  return tokens;
}

/**
 * MMR re-ranking: select diverse, relevant results from a candidate pool.
 *
 * @param results  - Pre-scored results (relevance = result.score)
 * @param options.limit - Number of results to return
 * @param options.lambda - Balance: 1.0 = pure relevance, 0.0 = max diversity (default: 0.7)
 * @returns Re-ranked results preserving the top `limit` diverse items
 */
export function mmrRerank(
  results: MemorySearchResult[],
  options: {
    limit: number;
    lambda?: number;
  },
): MemorySearchResult[] {
  const { limit, lambda = 0.7 } = options;

  if (results.length <= 1 || results.length <= limit) {
    return results.slice(0, limit);
  }

  // Normalize scores to [0, 1] for fair comparison
  const maxScore = Math.max(...results.map((r) => r.score));
  const minScore = Math.min(...results.map((r) => r.score));
  const scoreRange = maxScore - minScore || 1;

  const normalizedScores = new Map<string, number>(
    results.map((r) => [r.memory.id, (r.score - minScore) / scoreRange]),
  );

  const selected: MemorySearchResult[] = [];
  const remaining = new Set(results.map((r) => r.memory.id));
  const resultMap = new Map(results.map((r) => [r.memory.id, r]));

  while (selected.length < limit && remaining.size > 0) {
    let bestId: string | null = null;
    let bestMmrScore = -Infinity;

    for (const candidateId of remaining) {
      const candidate = resultMap.get(candidateId)!;
      const relevance = normalizedScores.get(candidateId) ?? 0;

      // Max similarity to any already-selected result
      let maxSim = 0;
      for (const sel of selected) {
        const sim = jaccardSimilarity(
          candidate.memory.content,
          sel.memory.content,
        );
        if (sim > maxSim) maxSim = sim;
      }

      const mmrScore = lambda * relevance - (1 - lambda) * maxSim;

      if (mmrScore > bestMmrScore) {
        bestMmrScore = mmrScore;
        bestId = candidateId;
      }
    }

    if (!bestId) break;

    selected.push(resultMap.get(bestId)!);
    remaining.delete(bestId);
  }

  return selected;
}
