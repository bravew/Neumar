/**
 * Deterministic prompt-injection rules.
 *
 * Each rule reads sanitized text and returns a numeric score in [0, 1] plus
 * a category. Scores are additive in the orchestrator, but the orchestrator
 * also uses categorical floors (e.g. forged role markers can BLOCK on their
 * own). Keeping the rules pure makes them easy to unit test against the
 * OWASP LLM cheat-sheet examples.
 *
 * Anti-pattern guard: documentation that legitimately discusses prompt
 * injection should not BLOCK on a single phrase. Combine multiple signals
 * in the orchestrator, not at the rule level.
 */

export type RuleCategory =
  | 'system_prompt_extraction'
  | 'tool_call_manipulation'
  | 'forged_role_marker'
  | 'credential_exfil'
  | 'dangerous_url'
  | 'encoded_payload'
  | 'hidden_html'
  | 'typoglycemia';

export interface RuleHit {
  category: RuleCategory;
  /** Score in [0, 1]. The orchestrator combines hits — do not over-weigh. */
  score: number;
  /**
   * Short, redacted-friendly snippet (e.g. matched substring with offsets).
   * Never include raw secrets — patterns here are public attack indicators.
   */
  evidence: string;
}

/**
 * Phrases an attacker uses to override the system prompt. Conservative scores
 * because legitimate documentation may mention these.
 */
const SYSTEM_PROMPT_PHRASES: Array<[RegExp, number]> = [
  [/\bignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions?\b/i, 0.5],
  [/\bdisregard\s+(?:all\s+)?(?:previous|prior|above)\s+instructions?\b/i, 0.5],
  [/\bforget\s+(?:everything|all\s+previous)\b/i, 0.4],
  [/\byour\s+new\s+instructions?\s+are\b/i, 0.5],
  [/\boverride\s+(?:your|the)\s+system\s+prompt\b/i, 0.6],
  [/\breveal\s+(?:your|the)\s+system\s+prompt\b/i, 0.6],
  [/\bprint\s+(?:your|the)\s+(?:system|hidden)\s+prompt\b/i, 0.6],
  [/\bact\s+as\s+(?:if\s+you\s+)?(?:dan|jailbreak)\b/i, 0.5],
];

/** Forged tool/role markers — high specificity, low false-positive. */
const FORGED_MARKERS: Array<[RegExp, number]> = [
  // Anthropic-style role markers smuggled in tool output.
  [/<\|?(?:human|assistant|system)\|?>/i, 0.7],
  // Plain "Human:" / "Assistant:" appear in legitimate transcripts, READMEs, and
  // help text. Score them low so two occurrences cannot alone breach the WARN
  // threshold (0.4); they only escalate when combined with another stronger
  // signal like an `<|im_start|>` marker or a system-prompt extraction phrase.
  [/\bHuman:\s/, 0.15],
  [/\bAssistant:\s/, 0.15],
  // OpenAI-style chat markers.
  [/<\|im_(?:start|end)\|>/i, 0.8],
  // Tool/function fence smuggling.
  [/<\/?tool_(?:use|result)\b/i, 0.6],
  [/<\/?function(?:_call|_response)\b/i, 0.6],
];

/** Tool-call manipulation — request to invoke specific tools. */
const TOOL_MANIPULATION: Array<[RegExp, number]> = [
  [
    /\bcall\s+(?:the\s+)?(?:read_file|exec|shell|run|fetch|http_request)\b/i,
    0.4,
  ],
  [/\bexecute\s+(?:this\s+)?(?:command|code|script|payload)\b/i, 0.4],
  [/\binvoke\s+(?:the\s+)?(?:tool|function)\s+\w+/i, 0.3],
];

/** Credential-exfil phrasing. Pairs naturally with high-risk file paths. */
const CRED_EXFIL: Array<[RegExp, number]> = [
  [
    /\b(?:exfiltrate|leak|send|post|upload)\s+.{0,40}(?:credentials?|secret|token|key|password|api[\s-]?key)\b/i,
    0.7,
  ],
  [/\bid_rsa\b/i, 0.5],
  [/\b\.ssh\/(?:id_rsa|id_ed25519|authorized_keys|known_hosts)\b/i, 0.7],
  [/\b\.aws\/credentials\b/i, 0.7],
  [/\.env(?:\.[a-z0-9_-]+)?\b/i, 0.3],
];

/** Dangerous URL schemes — never legitimate in tool output we feed to the model. */
const DANGEROUS_URL_SCHEMES = /\b(?:javascript|data|vbscript|file):/gi;

/** Cloud metadata endpoints embedded in tool output. */
const METADATA_URLS =
  /\b(?:169\.254\.169\.254|metadata\.google\.internal|metadata\.google|fd00:ec2::254|169\.254\.170\.2|168\.63\.129\.16)\b/i;

function clip(text: string, len = 80): string {
  return text.length > len ? text.slice(0, len) + '…' : text;
}

function scoreFromPatterns(
  text: string,
  patterns: Array<[RegExp, number]>,
  category: RuleCategory,
  cap = 1,
): RuleHit[] {
  const hits: RuleHit[] = [];
  for (const [pat, score] of patterns) {
    const m = pat.exec(text);
    if (m) {
      hits.push({
        category,
        score: Math.min(cap, score),
        evidence: clip(m[0]),
      });
    }
  }
  return hits;
}

export function detectSystemPromptExtraction(text: string): RuleHit[] {
  return scoreFromPatterns(
    text,
    SYSTEM_PROMPT_PHRASES,
    'system_prompt_extraction',
  );
}

export function detectForgedRoleMarkers(text: string): RuleHit[] {
  return scoreFromPatterns(text, FORGED_MARKERS, 'forged_role_marker');
}

export function detectToolManipulation(text: string): RuleHit[] {
  return scoreFromPatterns(text, TOOL_MANIPULATION, 'tool_call_manipulation');
}

export function detectCredExfil(text: string): RuleHit[] {
  return scoreFromPatterns(text, CRED_EXFIL, 'credential_exfil');
}

export function detectDangerousUrls(text: string): RuleHit[] {
  const hits: RuleHit[] = [];
  let m: RegExpExecArray | null;
  const pattern = new RegExp(DANGEROUS_URL_SCHEMES.source, 'gi');
  while ((m = pattern.exec(text)) !== null) {
    hits.push({
      category: 'dangerous_url',
      score: 0.6,
      evidence: clip(m[0]),
    });
    if (hits.length >= 3) break;
  }
  const meta = METADATA_URLS.exec(text);
  if (meta) {
    hits.push({
      category: 'dangerous_url',
      score: 0.8,
      evidence: clip(meta[0]),
    });
  }
  return hits;
}

/**
 * Heuristic encoded-payload detection. We do NOT decode and re-scan with full
 * rules here (that path lives in tool-output-defense to keep this module
 * pure); we just flag suspicious blob density.
 */
export function detectEncodedPayloadDensity(text: string): RuleHit[] {
  const hits: RuleHit[] = [];
  const totalLen = text.length;
  if (totalLen < 80) return hits;

  // Suspicious base64 chunk: 60+ chars of base64 alphabet without spaces.
  const base64 = /[A-Za-z0-9+/]{60,}={0,2}/g;
  let m;
  while ((m = base64.exec(text)) !== null) {
    hits.push({
      category: 'encoded_payload',
      score: 0.3,
      evidence: clip(m[0], 32),
    });
    if (hits.length >= 3) break;
  }

  // Long hex run.
  const hex = /[A-Fa-f0-9]{80,}/g;
  while ((m = hex.exec(text)) !== null) {
    hits.push({
      category: 'encoded_payload',
      score: 0.2,
      evidence: clip(m[0], 32),
    });
    if (hits.length >= 5) break;
  }
  return hits;
}

/**
 * Typoglycemia / letter-substitution variants of high-risk phrases. Catches
 * "ignroe previous instructions", "ig n ore previous", "1gn0re", etc.
 *
 * Strategy: collapse whitespace + punctuation, lower-case, then check for the
 * presence of skeleton spellings that no normal English text produces.
 */
export function detectTypoglycemia(text: string): RuleHit[] {
  const hits: RuleHit[] = [];
  // Collapse weird separators & leetspeak digit→letter substitutions.
  const cleaned = text
    .toLowerCase()
    .replace(/[\s\-_.,;:!?'"()\[\]\\\/`*]/g, ' ')
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/@/g, 'a')
    .replace(/\$/g, 's');
  // Strip everything but letters and spaces, then collapse spaces.
  const collapsed = cleaned.replace(/[^a-z ]/g, '').replace(/\s+/g, ' ');
  // Build a "no-space" version so "ig n ore previous" matches "ignoreprevious".
  const dense = collapsed.replace(/\s/g, '');

  const SKELETONS: Array<[string, number]> = [
    ['ignorepreviousinstructions', 0.6],
    ['ignoreallprevious', 0.5],
    ['ignoreabove', 0.4],
    ['disregardprevious', 0.5],
    ['forgeteverything', 0.4],
    ['revealsystemprompt', 0.6],
    ['printsystemprompt', 0.6],
    ['systempromptis', 0.4],
    ['actasdan', 0.5],
  ];
  for (const [skel, score] of SKELETONS) {
    if (dense.includes(skel)) {
      hits.push({
        category: 'typoglycemia',
        score,
        evidence: skel,
      });
    }
  }
  return hits;
}
