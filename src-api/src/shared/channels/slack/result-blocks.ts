/**
 * Slack Result Blocks Builder
 *
 * Builds clean Block Kit blocks for the final result message.
 * Uses Slack's MarkdownBlock for LLM output — Slack handles the
 * markdown → rendering translation so standard markdown is preserved.
 *
 * @see https://docs.slack.dev/reference/block-kit/blocks/markdown-block/
 * @see https://docs.slack.dev/ai/ai-apps-best-practices
 */

import type { ContextBlock, KnownBlock, MarkdownBlock } from '@slack/types';

import { truncateForMarkdownBlock } from './formatter';
import { parseInteractiveBlocks } from './interactive-parser';

/**
 * Completion markers for extracting final result from agent text.
 *
 * IMPORTANT: Markers must be specific to actual completion phrases.
 * Generic tokens like ✅ or "Here is" are commonly used as content
 * (e.g. bullet points, data labels) and cause false positives that
 * truncate the beginning of multi-option responses.
 */
const RESULT_MARKERS_RE =
  /(?:Done!|Here's the (?:result|output|final)|Your .{3,30} (?:is|has been) (?:ready|converted|generated|created|completed|saved))/gi;

/**
 * Minimum ratio of extracted-to-original text length.
 * If slicing from the last marker would discard more than this fraction
 * of the response, we keep the full text instead.
 */
const MIN_EXTRACTION_RATIO = 0.5;

/**
 * Developer-facing scaffolding tokens that occasionally leak into agent
 * output when a profile system prompt over-constrains the response format
 * (the model emits a "transcript" with `[Tool: …]`, `User: [Name]:`, or
 * `[Current message from …]` markers instead of actually calling tools).
 *
 * These are never meaningful to end users on chat channels — strip them
 * defensively so the raw scratchpad never reaches Slack/Discord/Telegram.
 */
const SCAFFOLDING_STRIPPERS: ReadonlyArray<RegExp> = [
  // "[Current message from <sender>]" echoed from our prompt wrap
  /^[ \t]*\[Current message from [^\]\n]{1,120}\][ \t]*\r?\n?/gm,
  // "User: [<Sender>]: ..." — entire line is the echoed user turn
  /^[ \t]*User:\s*\[[^\]\n]{1,120}\]:[^\n]*\r?\n?/gm,
  // "[Tool: <name>]" scratchpad markers — strip whole line when alone,
  // otherwise strip inline occurrences.
  /^[ \t]*\[Tool:\s*[^\]\n]{1,200}\][ \t]*\r?\n?/gm,
  /\[Tool:\s*[^\]\n]{1,200}\][ \t]*/g,
  // "Saved to: /path/file.ext" or "saved to output/file.ext" — internal
  // file-path mentions that leak from tool outputs into user-facing text.
  // The file itself is delivered as a Slack attachment, so the path is noise.
  /[\s—–-]*saved to:?\s*\S+\.[A-Za-z0-9]{1,5}\.?/gi,
];

/**
 * Remove leaked agent scaffolding/narration tokens from a response before it
 * is rendered to a chat channel. Conservative — only targets obvious markers
 * so regular content like "[note]:" or "[build]" in code is untouched.
 */
export function stripAgentScaffolding(text: string): string {
  let out = text;
  for (const re of SCAFFOLDING_STRIPPERS) {
    out = out.replace(re, '');
  }
  // Persona prefix on the FIRST non-blank line only (e.g. "[Optimus]: ...").
  // Restricted to line 1 and to short bracketed identifiers (letters/spaces
  // only) to avoid eating legitimate "[feature]:" labels inside lists.
  out = out.replace(/^([ \t]*)\[[A-Za-z][A-Za-z0-9 _-]{1,30}\]:[ \t]*/, '$1');
  // Collapse the blank-line gaps left behind.
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

/**
 * Build clean result blocks from agent response text.
 * Uses MarkdownBlock so Slack translates standard markdown directly —
 * no manual mrkdwn conversion or chunking needed.
 */
export function buildResultBlocks(
  text: string,
  opts?: {
    elapsed?: number;
    fileCount?: number;
    preExtracted?: boolean;
    /** Whether to show "Completed in Xs" footer. Defaults to true. */
    showElapsed?: boolean;
  },
): KnownBlock[] {
  const blocks: KnownBlock[] = [];
  // Always scrub scaffolding — even "preExtracted" callers can pass text
  // that still contains leaked "[Tool: …]" or persona prefixes.
  const resultText = opts?.preExtracted
    ? stripAgentScaffolding(text)
    : extractFinalResult(text);

  // Parse interactive element markers (```buttons, ```select) from the text.
  // Returns cleaned text (markers removed) + Block Kit ActionsBlocks.
  const { cleanText, actions } = parseInteractiveBlocks(resultText);
  const safeText = cleanText || '_Task completed._';

  const mdBlock: MarkdownBlock = {
    type: 'markdown',
    text: truncateForMarkdownBlock(safeText),
  };
  blocks.push(mdBlock);

  // Interactive elements (buttons, select menus) parsed from agent text
  blocks.push(...actions);

  // Metadata context
  const showElapsed = opts?.showElapsed !== false; // default true
  const parts: string[] = [];
  if (showElapsed && opts?.elapsed) parts.push(`Completed in ${opts.elapsed}s`);
  if (opts?.fileCount) parts.push(`${opts.fileCount} file(s) attached`);
  if (parts.length > 0) {
    const context: ContextBlock = {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: parts.join(' \u2022 ') }],
    };
    blocks.push(context);
  }

  return blocks;
}

/**
 * Extract the "result" portion from concatenated agent text.
 * Strips short leading filler (e.g. "Let me search…") when a clear
 * completion marker appears later. Returns the full text when no marker
 * is found or when extraction would discard too much content.
 */
export function extractFinalResult(text: string): string {
  // Strip developer scaffolding BEFORE marker extraction so a leaked
  // "[Tool: …]" or user-echo line can't anchor the extraction point.
  const cleaned = stripAgentScaffolding(text);
  const matches = [...cleaned.matchAll(RESULT_MARKERS_RE)];
  const lastIdx = matches.length > 0 ? matches[matches.length - 1]!.index : -1;
  if (lastIdx > 0) {
    const extracted = cleaned.slice(lastIdx).trim();
    // Prevents discarding the main body just to show a trailing section
    // (e.g. "Sources:" list after a long analysis).
    if (extracted.length >= cleaned.length * MIN_EXTRACTION_RATIO) {
      return extracted;
    }
  }
  // No markers, marker at position 0, or extraction too aggressive → full text
  return cleaned.trim();
}
