/**
 * Task complexity classifier.
 *
 * Used by the /plan route to short-circuit simple prompts:
 * - 'simple'   → emit direct_answer immediately, skip planning LLM call
 * - 'moderate' → normal plan flow (current behavior)
 * - 'complex'  → plan flow; caller may enforce mandatory approval gate
 */
export type TaskComplexity = 'simple' | 'moderate' | 'complex';

// Module-level — stable references, no per-call allocation
const COMPLEX_PATTERNS = [
  /\b(then|after that|next|finally|step \d|first.*then)\b/i,
  /\b(multiple|several|all|each|every|batch)\b/i,
  /\b(set up|configure|integrate|deploy|migrate|refactor)\b/i,
  /\band\b.*\band\b/i,
  /\b(email|slack|calendar|send|post|publish)\b/i,
] as const;

const SIMPLE_PATTERNS = [
  /^(write|create|make|show|list|print|display|generate)\s+a?\s*\w+/i,
  /^(fix|correct|update|rename|add)\s+(the\s+)?\w+/i,
  /^(explain|describe|summarize|translate)\s+/i,
  /^(what|which|how|why|when|where|who|do i|does|is there|are there|tell me)\s+/i,
  /^(i (prefer|like|love|hate|use|am|need|want)\b|i'm\b|my (name|team|project)\b|remember\b)/i,
] as const;

const COMPLEX_LENGTH_THRESHOLD = 600;

/**
 * Classify a task prompt as simple, moderate, or complex.
 *
 * - simple   → heuristic patterns suggest single-action, no multi-step
 * - complex  → prompt length or multi-step keywords indicate high complexity
 * - moderate → ambiguous; falls through to the planning LLM (default behavior)
 *
 * False-positive on 'simple' is safe: plan shown instead of skipped.
 * False-positive on 'complex' is also safe: extra approval gate shown.
 */
export function classifyTask(prompt: string): TaskComplexity {
  const clean = prompt.trim();
  if (clean.length > COMPLEX_LENGTH_THRESHOLD) return 'complex';
  if (COMPLEX_PATTERNS.some((re) => re.test(clean))) return 'complex';
  if (SIMPLE_PATTERNS.some((re) => re.test(clean))) return 'simple';
  return 'moderate';
}
