/**
 * Auto-Capture — detect and store important information from user messages.
 *
 * Only captures from user messages (never agent output) to prevent self-poisoning.
 * Includes prompt injection detection as a safety guard.
 *
 * v2: Multilingual triggers (6 languages), confidence scoring, LLM boundary
 * judgment, guard levels, language context extraction.
 */

import { createLogger } from '@/shared/utils/logger';

import type { CaptureGuardLevel, LLMCallFn, MemoryCategory } from './types';
import { GUARD_THRESHOLDS } from './types';

const logger = createLogger('Capturer');

// ── System prefix patterns to strip before capture ──
// These are injected by buildEnhancedPrompt() / formatRuntimeContext() in agent.ts.
// Each pattern is applied repeatedly (not just at the start) because multiple
// bracketed lines appear in sequence at the top of the enhanced prompt.

const SYSTEM_PREFIX_PATTERNS = [
  /^\[Current date and time: [^\]]+\]\s*/i,
  /^\[User locale: [^\]]+\]\s*/i,
  /^\[Platform: [^\]]+\]\s*/i,
  /^\[Approximate location: [^\]]+\]\s*/i,
  /^\[Please respond in [^\]]+\]\s*/i,
  /^\[Working directory: [^\]]+\]\s*/i,
  /^## CRITICAL: Workspace Configuration[\s\S]*?(?=\n[^#\n])/,
];

// ── Trigger patterns — multilingual (all 6 supported languages) ──

const MEMORY_TRIGGERS = [
  // English
  /remember|don't forget|keep in mind/i,
  /i (like|prefer|hate|love|want|need|always|never)/i,
  /my .+ is|i am|i'm/i,
  /we decided|we agreed|the plan is|going forward/i,
  /[\w.-]+@[\w.-]+\.\w+/, // Email
  /\+\d{10,}/, // Phone
  /important|crucial|critical|must/i,

  // Chinese
  /记住|别忘了|记下来/,
  /我(喜欢|偏好|讨厌|爱|想要|需要)/,
  /我(是|叫|名字是)/,
  /我们(决定|同意|计划)/,
  /重要|关键|必须|一定/,

  // Spanish
  /recuerda|no olvides|ten en cuenta/i,
  /me gusta|prefiero|odio|quiero|necesito/i,
  /mi .+ es|soy|me llamo/i,
  /decidimos|acordamos|el plan es/i,

  // French
  /souviens-toi|n'oublie pas|retiens/i,
  /j'aime|je préfère|je déteste|je veux|j'ai besoin/i,
  /je suis|je m'appelle|mon .+ est/i,
  /nous avons décidé|nous sommes convenus|le plan est/i,

  // Hindi
  /याद रखो|भूलना मत|ध्यान रखो/,
  /मुझे पसंद|मैं चाहता|मुझे नापसंद|मुझे ज़रूरत/,
  /मैं हूं|मेरा नाम|मैं .+ हूं/,
  /हमने फैसला किया|हम सहमत हुए|योजना है/,

  // Portuguese
  /lembre-se|não esqueça|tenha em mente/i,
  /eu gosto|prefiro|odeio|quero|preciso/i,
  /eu sou|meu nome é|me chamo/i,
  /decidimos|concordamos|o plano é/i,
];

// ── Prompt injection patterns — messages matching these are NEVER stored ──

const INJECTION_PATTERNS = [
  /ignore (all|any|previous|above|prior) instructions/i,
  /do not follow (the )?(system|developer)/i,
  /system prompt/i,
  /developer message/i,
  /<\s*(system|assistant|developer|tool|function|relevant-memories)\b/i,
  /\b(run|execute|call|invoke)\b.{0,40}\b(tool|command)\b/i,
];

// ── Question patterns — questions are queries, not facts to store ──
// Multilingual: en, zh, es, fr, hi, pt question starters + trailing question mark
const QUESTION_PATTERNS = [
  /^(what|which|who|where|when|why|how|do i|does|is there|are there|can you|could you|would you|should i|tell me)\b/i,
  /^(qué|cuál|quién|dónde|cuándo|por qué|cómo)\b/i,
  /^(qu'est-ce|qui|où|quand|pourquoi|comment|quel)\b/i,
  /^(o que|qual|quem|onde|quando|por que|como)\b/i,
  /[?？؟]\s*$/,
];

/**
 * Check if text is a question (query) rather than a declarative fact.
 * Questions should not be stored as memories.
 */
function isQuestion(text: string): boolean {
  return QUESTION_PATTERNS.some((p) => p.test(text));
}

// ── Derivable content patterns — content that can be derived from codebase/git ──
// These should not be stored as memories (inspired by Claude Code memdir exclusion list).

const DERIVABLE_PATTERNS = [
  // Git log/commit output (language-neutral)
  /^commit [a-f0-9]{7,40}/m,
  /^Merge (branch|pull request)/im,
  /^Author:\s/m,
  // Stack traces (JS/Python)
  /at\s+[\w.$]+\s*\(.*:\d+:\d+\)/,
  /^\s+File ".*", line \d+/m,
];

// Additional derivable content patterns (module scope per CLAUDE.md)
const CODE_BLOCK_RE = /```[\s\S]{50,}```/;
const FILE_PATH_SEGMENT_RE = /(\/[\w.-]+){3,}/g;

/**
 * Check if text is predominantly derivable from the codebase or git history.
 * Returns true if the content should NOT be stored as a memory.
 */
export function isDerivableContent(text: string): boolean {
  if (DERIVABLE_PATTERNS.some((p) => p.test(text))) return true;

  if (CODE_BLOCK_RE.test(text)) return true;

  // File-path-dominant: >3 multi-segment paths in the message
  const pathMatches = text.match(FILE_PATH_SEGMENT_RE);
  if (pathMatches && pathMatches.length > 3) return true;

  return false;
}

/**
 * Extract language hint from system prefixes before they're stripped.
 * Returns ISO locale code (e.g. 'zh-CN') or language name (e.g. 'Chinese'), or null.
 */
export function extractLanguageHint(text: string): string | null {
  const localeMatch = text.match(/\[User locale:\s*([^\]]+)\]/i);
  if (localeMatch?.[1]) return sanitizeLanguageHint(localeMatch[1]);

  const respondMatch = text.match(/\[Please respond in\s+([^\]]+)\]/i);
  if (respondMatch?.[1]) return sanitizeLanguageHint(respondMatch[1]);

  return null;
}

/** Strip newlines/control chars and cap length for safe DB storage. */
function sanitizeLanguageHint(raw: string): string {
  return raw
    .replace(/[\n\r\t]/g, ' ')
    .trim()
    .slice(0, 50);
}

/**
 * Strip system-injected prefixes from a prompt to extract the raw user message.
 * The agent service prepends runtime context lines (`[Current date and time: ...]`,
 * `[User locale: ...]`, `[Platform: ...]`, etc.) followed by the actual user text.
 * These should never be stored as memories.
 *
 * Loops until no more prefixes match, because multiple bracketed lines appear
 * in sequence and each `^`-anchored pattern only fires once per pass.
 */
export function stripSystemPrefixes(text: string): string {
  let cleaned = text.trim();
  let prev: string;
  do {
    prev = cleaned;
    for (const pattern of SYSTEM_PREFIX_PATTERNS) {
      cleaned = cleaned.replace(pattern, '').trim();
    }
  } while (cleaned !== prev);
  return cleaned;
}

/** Check if text contains prompt injection attempts. */
export function looksLikePromptInjection(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return INJECTION_PATTERNS.some((p) => p.test(normalized));
}

/**
 * Score capture confidence with rule-based signals.
 * Base: 0.5, adjusted by signal detection.
 * Returns confidence score (0-1) and the reason for the score.
 */
export function scoreCaptureConfidence(text: string): {
  score: number;
  reason: string;
} {
  let score = 0.5;
  let reason = 'baseline';

  // Positive signals (multilingual)
  if (
    /remember|don't forget|记住|别忘了|recuerda|no olvides|souviens-toi|n'oublie pas|याद रखो|lembre-se/i.test(
      text,
    )
  ) {
    score += 0.35;
    reason = 'explicit_remember';
  }
  if (
    /\b(my|i am|i'm)\b|我是|我叫|soy|me llamo|je suis|je m'appelle|मैं हूं|eu sou/i.test(
      text,
    )
  ) {
    score += 0.2;
    reason = 'personal_profile';
  }
  if (
    /\b(prefer|like|love|hate)\b|喜欢|偏好|讨厌|me gusta|prefiero|j'aime|je préfère|पसंद|gosto|prefiro/i.test(
      text,
    )
  ) {
    score += 0.15;
    reason = 'preference';
  }
  if (
    /\b(decided|agreed)\b|决定|同意|decidimos|décidé|फैसला|concordamos/i.test(
      text,
    )
  ) {
    score += 0.12;
    reason = 'decision';
  }
  // Confirmation signals — recording validated approaches prevents negativity drift
  if (
    /\b(yes exactly|perfect|keep doing that|that works|good approach|right call)\b|没错|就这样|很好|exactamente|parfait|exatamente/i.test(
      text,
    )
  ) {
    score += 0.15;
    reason = 'confirmation';
  }

  // Negative signals (multilingual)
  if (
    /^(ok|thanks|好的|谢谢|sure|yes|no|gracias|merci|obrigado|sí|oui|ठीक)\s*$/i.test(
      text,
    )
  ) {
    score -= 0.4;
    reason = 'small_talk';
  }
  if (
    /请帮我|你看|能否|could you|can you|please|por favor|s'il vous plaît|कृपया/i.test(
      text,
    )
  ) {
    score -= 0.15;
    reason = 'request';
  }
  if (/```/.test(text)) {
    score -= 0.3;
    reason = 'code_block';
  }
  if (text.length < 10) {
    score -= 0.15;
    reason = 'too_short';
  }
  if (text.length > 300) {
    score -= 0.1;
    reason = 'long_text';
  }

  return { score: Math.max(0, Math.min(1, score)), reason };
}

/**
 * LLM judgment for borderline capture decisions.
 * Only called when |confidence - threshold| <= 0.08.
 * Uses a lightweight LLM call (typically Haiku for cost).
 */
export async function llmJudgeCapture(
  text: string,
  ruleScore: number,
  ruleReason: string,
  callLLM: LLMCallFn,
): Promise<{ accepted: boolean; confidence: number; reason: string }> {
  try {
    // Sanitize text to prevent prompt manipulation via embedded quotes
    const safeText = text.slice(0, 300).replace(/"/g, "'");
    const prompt = `You are a memory capture judge. Decide if this user message contains information worth remembering long-term (personal facts, preferences, decisions, important context).

Message: "${safeText}"
Rule score: ${ruleScore.toFixed(2)} (reason: ${ruleReason})

Reply with ONLY a JSON object: {"store": true/false, "confidence": 0.0-1.0, "reason": "brief reason"}`;

    const response = await callLLM(prompt);
    const match = response.match(/\{[\s\S]*\}/);
    if (!match) {
      return {
        accepted: ruleScore >= 0.5,
        confidence: ruleScore,
        reason: 'llm_parse_failed',
      };
    }

    const parsed = JSON.parse(match[0]) as {
      store: boolean;
      confidence: number;
      reason: string;
    };
    return {
      accepted: parsed.store,
      confidence: Math.max(0, Math.min(1, parsed.confidence ?? ruleScore)),
      reason: `llm_judge: ${parsed.reason}`,
    };
  } catch {
    // If LLM fails, fall back to rule-based score
    return {
      accepted: ruleScore >= 0.5,
      confidence: ruleScore,
      reason: 'llm_judge_error',
    };
  }
}

/**
 * Determine if a message should be auto-captured.
 * Returns the cleaned text to store if capture is warranted, or null to skip.
 * Strips system prefixes before evaluating triggers and storing.
 */
export function shouldCapture(text: string, maxChars = 500): string | null {
  // Strip system-injected prefixes first
  const cleaned = stripSystemPrefixes(text);

  logger.debug(
    `shouldCapture: input=${text.length} chars -> cleaned=${cleaned.length} chars, maxChars=${maxChars}`,
  );

  // Skip trivial or overly long messages
  // Min 5 chars to allow short identity statements like "I am X"
  if (cleaned.length < 5 || cleaned.length > maxChars) {
    logger.debug(
      `shouldCapture: skipped — length ${cleaned.length} outside [5, ${maxChars}]`,
    );
    return null;
  }

  // Skip injected recall context
  if (cleaned.includes('<relevant-memories>')) {
    logger.debug('shouldCapture: skipped — contains <relevant-memories>');
    return null;
  }

  // Skip XML-like system content
  if (cleaned.startsWith('<') && cleaned.includes('</')) {
    logger.debug('shouldCapture: skipped — XML-like system content');
    return null;
  }

  // Skip agent-formatted markdown output
  if (cleaned.includes('**') && cleaned.includes('\n-')) {
    logger.debug('shouldCapture: skipped — agent-formatted markdown');
    return null;
  }

  // Reject prompt injection attempts
  if (looksLikePromptInjection(cleaned)) {
    logger.debug('shouldCapture: skipped — prompt injection detected');
    return null;
  }

  // Count emojis — skip emoji-heavy output (likely agent-generated)
  const emojiCount = (cleaned.match(/[\u{1F300}-\u{1F9FF}]/gu) || []).length;
  if (emojiCount > 3) {
    logger.debug(`shouldCapture: skipped — too many emojis (${emojiCount})`);
    return null;
  }

  // Check if any trigger pattern matches — return cleaned text if so
  if (MEMORY_TRIGGERS.some((r) => r.test(cleaned))) {
    // Reject questions — they're queries, not facts to remember
    if (isQuestion(cleaned)) {
      logger.debug('shouldCapture: skipped — question, not a fact');
      return null;
    }
    // Reject derivable content even if triggers matched
    if (isDerivableContent(cleaned)) {
      logger.debug(
        'shouldCapture: skipped — derivable content (git/code/paths)',
      );
      return null;
    }
    logger.info(
      `shouldCapture: triggered — "${cleaned.slice(0, 80)}${cleaned.length > 80 ? '...' : ''}"`,
    );
    return cleaned;
  }

  logger.debug(
    `shouldCapture: no trigger matched — "${cleaned.slice(0, 60)}..."`,
  );
  return null;
}

/**
 * Determine if capture should proceed based on confidence and guard level.
 * Returns true if the confidence meets the threshold for the given guard level.
 */
export function meetsGuardThreshold(
  confidence: number,
  isExplicit: boolean,
  guardLevel: CaptureGuardLevel = 'standard',
): boolean {
  const thresholds = GUARD_THRESHOLDS[guardLevel];
  return confidence >= (isExplicit ? thresholds.explicit : thresholds.implicit);
}

/**
 * Check if confidence is borderline (within ±0.08 of threshold).
 * Used to decide whether to invoke LLM judgment.
 */
export function isBorderlineConfidence(
  confidence: number,
  isExplicit: boolean,
  guardLevel: CaptureGuardLevel = 'standard',
): boolean {
  const thresholds = GUARD_THRESHOLDS[guardLevel];
  const threshold = isExplicit ? thresholds.explicit : thresholds.implicit;
  return Math.abs(confidence - threshold) <= 0.08;
}

/**
 * Detect the memory category from text content (multilingual).
 */
export function detectCategory(
  text: string,
  _languageHint?: string | null,
): MemoryCategory {
  // English patterns
  if (/\b(prefer|like|love|hate|want|need|always|never)\b/i.test(text))
    return 'preference';
  if (/\b(decided|agreed|will use|going forward|the plan is)\b/i.test(text))
    return 'decision';

  // Chinese patterns
  if (/喜欢|偏好|讨厌|爱|想要|需要|总是|从不/.test(text)) return 'preference';
  if (/决定|同意|计划|方案是|以后/.test(text)) return 'decision';
  if (/我是|我叫|名字是|他是|她是/.test(text)) return 'entity';

  // Spanish patterns
  if (/\b(gusta|prefiero|odio|quiero|necesito|siempre|nunca)\b/i.test(text))
    return 'preference';
  if (/\b(decidimos|acordamos|el plan es|de ahora en adelante)\b/i.test(text))
    return 'decision';

  // French patterns
  if (/\b(aime|préfère|déteste|veux|besoin|toujours|jamais)\b/i.test(text))
    return 'preference';
  if (/\b(décidé|convenu|le plan est|dorénavant)\b/i.test(text))
    return 'decision';

  // Hindi patterns
  if (/पसंद|नापसंद|चाहिए|हमेशा|कभी नहीं/.test(text)) return 'preference';
  if (/फैसला|सहमत|योजना|आगे से/.test(text)) return 'decision';

  // Portuguese patterns
  if (/\b(gosto|prefiro|odeio|quero|preciso|sempre|nunca)\b/i.test(text))
    return 'preference';
  if (/\b(decidimos|concordamos|o plano é|daqui em diante)\b/i.test(text))
    return 'decision';

  // Language-agnostic patterns
  if (/\+\d{10,}|[\w.-]+@[\w.-]+\.\w+|\bis called\b/i.test(text))
    return 'entity';
  if (/\b(my|the|this|that|it|its)\b.{1,30}\b(is|are|has|have)\b/i.test(text))
    return 'fact';

  return 'other';
}

/**
 * Escape memory text for safe injection into prompts.
 * Prevents stored memories from containing HTML/XML that could be
 * interpreted as system instructions.
 */
const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeForPrompt(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPE_MAP[c] ?? c);
}
