/**
 * Defend tool/MCP output before it re-enters the model context.
 *
 * Pipeline:
 *   1. Unicode normalization (NFKC) — collapses confusables.
 *   2. Strip zero-width and bidi-control characters that hide instructions.
 *   3. Strip <script>, <style>, hidden HTML, and ARIA-hidden blocks.
 *   4. Run deterministic prompt-injection rules from prompt-injection-rules.ts.
 *   5. Decode-for-inspection any suspicious base64/hex chunks and re-run rules.
 *   6. Combine signals into a verdict (ALLOW | WARN | BLOCK | HITL_REQUIRED).
 *   7. Build a structural envelope so the model sees clearly tagged tool data,
 *      never inline pseudo-instructions.
 *
 * Returns:
 *   - modelContent     : the string that goes back into provider messages.
 *                         Replaced with a placeholder on BLOCK.
 *   - displayContent   : what the AG-UI shows (annotated for WARN).
 *   - verdict          : routing decision
 *   - scores           : per-category aggregate scores
 *   - audit            : structured fields for security_events
 *   - redactedSnippet  : <=512 char excerpt safe to log
 */

import { createHash } from 'node:crypto';

import {
  detectCredExfil,
  detectDangerousUrls,
  detectEncodedPayloadDensity,
  detectForgedRoleMarkers,
  detectSystemPromptExtraction,
  detectToolManipulation,
  detectTypoglycemia,
  type RuleCategory,
  type RuleHit,
} from './prompt-injection-rules';
import type { SecuritySession } from './session';

export type ToolOutputVerdict = 'ALLOW' | 'WARN' | 'BLOCK' | 'HITL_REQUIRED';

export interface ToolOutputDefenseInput {
  session?: SecuritySession;
  source: {
    /** Adapter that produced the content (e.g. 'openai-compat'). */
    adapter: string;
    /** Tool name as reported by the model. */
    toolName: string;
    /** Tool-call id (provider-specific). */
    toolUseId: string;
  };
  content: string | Buffer;
  /**
   * Hint to relax/strengthen the verdict, e.g. for tool outputs known to be
   * intrinsically high-risk (filesystem reads, fetched HTML).
   */
  riskHint?: 'low' | 'normal' | 'high';
}

export interface ToolOutputDefenseResult {
  verdict: ToolOutputVerdict;
  modelContent: string;
  displayContent: string;
  scores: Partial<Record<RuleCategory, number>>;
  totalScore: number;
  hits: RuleHit[];
  audit: {
    eventType:
      | 'tool_output.block'
      | 'tool_output.warn'
      | 'tool_output.hitl_required'
      | 'tool_output.allow';
    severity: 'info' | 'warn' | 'critical';
    payloadHash: string;
    redactedSnippet: string;
  };
  redactedSnippet: string;
}

const ZERO_WIDTH_AND_BIDI = /[​-‏‪-‮⁠-⁤⁦-⁯﻿]/g;

const HIDDEN_HTML_PATTERNS: RegExp[] = [
  /<script\b[\s\S]*?<\/script>/gi,
  /<style\b[\s\S]*?<\/style>/gi,
  /<noscript\b[\s\S]*?<\/noscript>/gi,
  /<!--([\s\S]*?)-->/g,
  // display:none / visibility:hidden inline styles → drop the whole element.
  /<[a-z][\w-]*\s[^>]*style="[^"]*(?:display\s*:\s*none|visibility\s*:\s*hidden)[^"]*"[^>]*>[\s\S]*?<\/[a-z][\w-]*>/gi,
  // aria-hidden=true blocks
  /<[a-z][\w-]*\s[^>]*aria-hidden\s*=\s*"?true"?[^>]*>[\s\S]*?<\/[a-z][\w-]*>/gi,
];

function toText(input: string | Buffer): string {
  return typeof input === 'string' ? input : input.toString('utf8');
}

function normalizeText(input: string): string {
  let t = input.normalize('NFKC');
  t = t.replace(ZERO_WIDTH_AND_BIDI, '');
  for (const re of HIDDEN_HTML_PATTERNS) {
    t = t.replace(re, '');
  }
  return t;
}

const SNIPPET_MAX = 256;

function redact(value: string): string {
  return value.length > SNIPPET_MAX ? value.slice(0, SNIPPET_MAX) + '…' : value;
}

function aggregateScores(
  hits: RuleHit[],
): Partial<Record<RuleCategory, number>> {
  const out: Partial<Record<RuleCategory, number>> = {};
  for (const h of hits) {
    out[h.category] = Math.min(1, (out[h.category] ?? 0) + h.score);
  }
  return out;
}

function chooseVerdict(
  scores: Partial<Record<RuleCategory, number>>,
  hits: RuleHit[],
  riskHint: 'low' | 'normal' | 'high',
): { verdict: ToolOutputVerdict; total: number } {
  // Categorical floor: forged role markers BLOCK on their own — no legitimate
  // tool output ever needs an <|im_start|> or </tool_use> token.
  const forged = scores.forged_role_marker ?? 0;
  if (forged >= 0.7) return { verdict: 'BLOCK', total: forged };

  const total = Object.values(scores).reduce((s, v) => s + (v ?? 0), 0);

  // riskHint shifts thresholds; high-risk source (fetched HTML) blocks earlier.
  const blockThreshold = riskHint === 'high' ? 1.0 : 1.4;
  const hitlThreshold = riskHint === 'high' ? 0.7 : 1.0;
  const warnThreshold = 0.4;

  // Combine: credential_exfil + system_prompt_extraction together is a clear
  // attack pattern even if neither alone trips the block.
  const combo =
    (scores.credential_exfil ?? 0) > 0 &&
    ((scores.system_prompt_extraction ?? 0) > 0 ||
      (scores.tool_call_manipulation ?? 0) > 0);
  if (combo) return { verdict: 'BLOCK', total };

  if (total >= blockThreshold) return { verdict: 'BLOCK', total };
  if (total >= hitlThreshold) return { verdict: 'HITL_REQUIRED', total };
  if (total >= warnThreshold || hits.length > 0)
    return { verdict: 'WARN', total };
  return { verdict: 'ALLOW', total };
}

/**
 * Decode-for-inspection: extract candidate base64 chunks (≥80 chars, padded
 * properly), decode, and re-run pattern detectors. Failures are silent.
 */
function inspectEncoded(text: string): RuleHit[] {
  const hits: RuleHit[] = [];
  const candidates = text.match(/[A-Za-z0-9+/]{80,}={0,2}/g) ?? [];
  for (const cand of candidates.slice(0, 4)) {
    try {
      const decoded = Buffer.from(cand, 'base64').toString('utf8');
      // Only re-scan if decoded is mostly printable.
      const printable = decoded.replace(/[^\x20-\x7E\n\r\t]/g, '').length;
      if (printable / decoded.length < 0.85) continue;
      const sub = [
        ...detectSystemPromptExtraction(decoded),
        ...detectForgedRoleMarkers(decoded),
        ...detectCredExfil(decoded),
      ];
      // Tag origin so we know it came from a decode pass.
      for (const h of sub) hits.push({ ...h, evidence: `b64:${h.evidence}` });
    } catch {
      // ignore decode errors
    }
  }
  return hits;
}

function buildEnvelope(
  source: ToolOutputDefenseInput['source'],
  body: string,
  payloadHash: string,
): string {
  // Structural envelope. The model sees clearly tagged tool output and a
  // hash so a follow-up tool result can be correlated. Tags use rare
  // sentinels so a forged inner copy won't terminate the envelope.
  return [
    `<<<NEUMA_TOOL_OUTPUT adapter="${source.adapter}" tool="${source.toolName}" id="${source.toolUseId}" sha256="${payloadHash.slice(0, 16)}">>>`,
    body,
    `<<<END_NEUMA_TOOL_OUTPUT id="${source.toolUseId}">>>`,
  ].join('\n');
}

const BLOCK_PLACEHOLDER =
  '[Tool output blocked by neumar prompt-injection defense. The full output was redacted before reaching the model. See security audit for verdict and snippet.]';

// HITL_REQUIRED currently acts as a hard block: this placeholder is what the
// model sees, with no actual human-approval round-trip. Until that flow exists
// (UI surface, queue, reviewer decision threading), HITL_REQUIRED and BLOCK
// are functionally identical from the model's point of view.
const HITL_PLACEHOLDER =
  '[Tool output flagged for human review. Awaiting approval before reaching the model.]';

export function defendToolOutput(
  input: ToolOutputDefenseInput,
): ToolOutputDefenseResult {
  const raw = toText(input.content);
  const payloadHash = createHash('sha256').update(raw, 'utf8').digest('hex');

  const normalized = normalizeText(raw);

  const hits: RuleHit[] = [
    ...detectSystemPromptExtraction(normalized),
    ...detectForgedRoleMarkers(normalized),
    ...detectToolManipulation(normalized),
    ...detectCredExfil(normalized),
    ...detectDangerousUrls(normalized),
    ...detectEncodedPayloadDensity(normalized),
    ...detectTypoglycemia(normalized),
    ...inspectEncoded(normalized),
  ];

  const scores = aggregateScores(hits);
  const { verdict, total } = chooseVerdict(
    scores,
    hits,
    input.riskHint ?? 'normal',
  );

  const redactedSnippet = redact(normalized);

  const eventType: ToolOutputDefenseResult['audit']['eventType'] =
    verdict === 'BLOCK'
      ? 'tool_output.block'
      : verdict === 'HITL_REQUIRED'
        ? 'tool_output.hitl_required'
        : verdict === 'WARN'
          ? 'tool_output.warn'
          : 'tool_output.allow';

  const severity: ToolOutputDefenseResult['audit']['severity'] =
    verdict === 'BLOCK'
      ? 'critical'
      : verdict === 'HITL_REQUIRED' || verdict === 'WARN'
        ? 'warn'
        : 'info';

  const audit = {
    eventType,
    severity,
    payloadHash,
    redactedSnippet,
  };

  if (input.session && verdict !== 'ALLOW') {
    input.session.audit.recordEvent({
      eventType,
      severity,
      source: 'ToolOutputDefense',
      action: verdict.toLowerCase(),
      payloadHash,
      redactedSnippet,
      metadata: {
        adapter: input.source.adapter,
        toolName: input.source.toolName,
        toolUseId: input.source.toolUseId,
        scores,
        totalScore: total,
        riskHint: input.riskHint ?? 'normal',
      },
    });
  }

  if (verdict === 'BLOCK') {
    return {
      verdict,
      modelContent: BLOCK_PLACEHOLDER,
      displayContent: BLOCK_PLACEHOLDER,
      scores,
      totalScore: total,
      hits,
      audit,
      redactedSnippet,
    };
  }
  if (verdict === 'HITL_REQUIRED') {
    return {
      verdict,
      modelContent: HITL_PLACEHOLDER,
      displayContent: HITL_PLACEHOLDER,
      scores,
      totalScore: total,
      hits,
      audit,
      redactedSnippet,
    };
  }

  const envelope = buildEnvelope(input.source, normalized, payloadHash);
  return {
    verdict,
    modelContent: envelope,
    displayContent: normalized,
    scores,
    totalScore: total,
    hits,
    audit,
    redactedSnippet,
  };
}

/**
 * Defend an entire batch of agent messages (e.g. before pipeline insertion).
 * Currently delegates to defendToolOutput per message; preserved as a hook
 * for future cross-message correlation (see Task 9 PRP notes).
 */
export function defendAgentMessages<
  T extends { role: string; content: string },
>(
  messages: T[],
  base: Omit<ToolOutputDefenseInput, 'content'>,
): { messages: T[]; verdicts: ToolOutputVerdict[] } {
  const verdicts: ToolOutputVerdict[] = [];
  const out: T[] = messages.map((m) => {
    // Only tool-role messages need defense. User-role messages come from a
    // human and are already trusted in the same way the prompt itself is —
    // wrapping them in an envelope would just confuse the model.
    if (m.role !== 'tool') {
      verdicts.push('ALLOW');
      return m;
    }
    const r = defendToolOutput({ ...base, content: m.content });
    verdicts.push(r.verdict);
    return { ...m, content: r.modelContent };
  });
  return { messages: out, verdicts };
}
