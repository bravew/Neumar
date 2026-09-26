// Model parsing helpers shared across runtime defs.

import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk';

import type { ModelOption } from './types.js';

export const DEFAULT_MODEL_OPTION: ModelOption = {
  id: 'default',
  label: 'Default (CLI config)',
};

/**
 * Map the Claude Agent SDK's `supportedModels()` rows to picker options.
 *
 * The CLI reports aliases (`opus`, `sonnet`) alongside the canonical id they
 * resolve to, e.g. `{ value: 'opus', resolvedModel: 'claude-opus-5-5',
 * description: 'Opus 5.5 · Best for everyday, complex tasks' }`. Rows are
 * keyed by `resolvedModel` so persisted selections, pricing, and version
 * gating keep matching real model ids, and so the id stays valid for the
 * direct Messages API paths — CLI-only spellings such as the
 * `claude-fable-5-1[1m]` context suffix would be rejected there. The CLI's
 * own `default` row is skipped in favour of DEFAULT_MODEL_OPTION.
 * Returns null when nothing usable remains so detection falls back.
 */
export function parseClaudeSupportedModels(
  models: readonly ModelInfo[],
): ModelOption[] | null {
  const out: ModelOption[] = [DEFAULT_MODEL_OPTION];
  const seen = new Set<string>([DEFAULT_MODEL_OPTION.id]);
  for (const model of models) {
    const value = model.value.trim();
    if (!value || value === DEFAULT_MODEL_OPTION.id) continue;
    const id = model.resolvedModel?.trim() || value;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    // "Opus 5.5 · Best for everyday, complex tasks · ~2× usage" → the head
    // names the concrete version; `displayName` is only the family ("Opus").
    const [head, ...rest] = model.description
      .split(' · ')
      .map((part) => part.trim());
    const option: ModelOption = {
      id,
      label: head || model.displayName || id,
    };
    const description = head ? rest.join(' · ') : model.description.trim();
    if (description) option.description = description;
    if (model.supportedEffortLevels?.length) {
      option.compatibleReasoningTiers = [...model.supportedEffortLevels];
    }
    out.push(option);
  }
  return out.length > 1 ? out : null;
}

interface CodexCatalogModel {
  slug: string;
  display_name?: string;
  description?: string;
  visibility?: string;
  priority?: number;
  context_window?: number;
  input_modalities?: string[];
  supported_reasoning_levels?: { effort?: string }[];
}

function isCodexCatalogModel(value: unknown): value is CodexCatalogModel {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { slug?: unknown }).slug === 'string'
  );
}

/**
 * Parse `codex debug models` — the JSON model catalog the Codex CLI renders
 * for its own picker (`{ "models": [{ slug, display_name, visibility,
 * priority, … }] }`). Only `visibility: "list"` rows are user-selectable
 * (hidden rows are internal, e.g. the auto-review model); they are ordered by
 * the CLI's `priority`. Returns null for unparseable output so detection
 * falls back (older CLIs lack the subcommand entirely).
 */
export function parseCodexModelCatalog(stdout: string): ModelOption[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  const rows = (parsed as { models?: unknown } | null)?.models;
  if (!Array.isArray(rows)) return null;

  const listed = rows
    .filter(isCodexCatalogModel)
    .filter((model) => model.visibility === 'list' && model.slug.trim())
    .sort(
      (a, b) =>
        (a.priority ?? Number.MAX_SAFE_INTEGER) -
        (b.priority ?? Number.MAX_SAFE_INTEGER),
    );

  const out: ModelOption[] = [DEFAULT_MODEL_OPTION];
  const seen = new Set<string>([DEFAULT_MODEL_OPTION.id]);
  for (const model of listed) {
    const id = model.slug.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    const option: ModelOption = {
      id,
      label: model.display_name?.trim() || id,
    };
    if (model.description?.trim())
      option.description = model.description.trim();
    if (typeof model.context_window === 'number' && model.context_window > 0) {
      option.contextWindowTokens = model.context_window;
    }
    if (model.input_modalities?.includes('image')) {
      option.capabilityTags = ['chat', 'vision'];
    }
    const efforts = (model.supported_reasoning_levels ?? [])
      .map((level) => level.effort)
      .filter((effort): effort is string => typeof effort === 'string');
    if (efforts.length > 0) option.compatibleReasoningTiers = efforts;
    out.push(option);
  }
  return out.length > 1 ? out : null;
}

export function withModelSource(
  models: ModelOption[],
  source: NonNullable<ModelOption['source']>,
): ModelOption[] {
  return models.map((model) => ({
    ...model,
    source: model.source ?? source,
    availability: model.availability ?? 'unknown',
  }));
}

/**
 * Parse `cursor-agent models` output. The authed CLI prints an
 * `Available models` header followed by `<id> - <Label>` lines, e.g.
 *
 *   Available models
 *
 *   auto - Auto (default)
 *   gpt-5.3-codex - Codex 5.3
 *
 * Header lines are skipped; a line without the ` - Label` suffix still
 * parses as a bare id. Returns null when nothing parseable remains so
 * detection falls back to the def's fallback models. (Ported from the Open
 * Design reference parser.)
 */
export function parseCursorAgentModels(stdout: string): ModelOption[] | null {
  const lines = String(stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  if (lines.length === 0) return null;

  const out: ModelOption[] = [DEFAULT_MODEL_OPTION];
  const seen = new Set<string>([DEFAULT_MODEL_OPTION.id]);
  for (const line of lines) {
    if (/^(available models|models)$/i.test(line)) continue;
    const match = line.match(
      /^([A-Za-z0-9][A-Za-z0-9._/:@-]*)(?:\s+-\s+(.+))?$/,
    );
    if (!match) continue;
    const id = match[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const label = match[2]?.trim() || id;
    out.push({ id, label });
  }

  return out.length > 1 ? out : null;
}

// Parse one-id-per-line stdout from `<cli> models` (used by opencode,
// cursor-agent). Prepends the synthetic default option, dedupes, drops
// blanks and `# comments`.
export function parseLineSeparatedModels(stdout: string): ModelOption[] {
  const ids = String(stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  const seen = new Set<string>();
  const out: ModelOption[] = [DEFAULT_MODEL_OPTION];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: id });
  }
  return out;
}

// Map a user-picked reasoning effort to one the chosen Codex model accepts.
// Codex CLI accepts none|minimal|low|medium|high|xhigh, but real models
// support narrower subsets. Unknown / future ids pass through unchanged.
export function clampCodexReasoning(
  modelId: string | undefined,
  effort: string | undefined,
): string | undefined {
  if (!effort) return effort;
  const raw = String(modelId ?? '').trim();
  const id = raw.includes('/') ? (raw.split('/').pop() ?? raw) : raw;
  const isGpt5LateFamily =
    !id ||
    id === 'default' ||
    id.startsWith('gpt-5.2') ||
    id.startsWith('gpt-5.3') ||
    id.startsWith('gpt-5.4') ||
    id.startsWith('gpt-5.5');
  if (isGpt5LateFamily && effort === 'minimal') return 'low';
  if (id === 'gpt-5.1' && effort === 'xhigh') return 'high';
  if (id === 'gpt-5.1-codex-mini') {
    return effort === 'high' || effort === 'xhigh' ? 'high' : 'medium';
  }
  return effort;
}

// Parse Pi's --list-models TSV output (printed to stderr, not stdout).
// Format observed: "<provider>\t<modelId>\t<displayName>" rows after a
// header. Tolerant of header lines + missing columns.
export function parsePiModels(stderr: string): ModelOption[] | null {
  const lines = String(stderr || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return null;
  const out: ModelOption[] = [DEFAULT_MODEL_OPTION];
  const seen = new Set<string>();
  for (const line of lines) {
    const cols = line.split(/\t+|\s{2,}/);
    if (cols.length < 2) continue;
    const provider = cols[0]?.trim();
    const modelId = cols[1]?.trim();
    const display = cols[2]?.trim() || modelId;
    if (!provider || !modelId) continue;
    if (/^provider$/i.test(provider) && /^model/i.test(modelId)) continue; // header
    const composite = provider.includes('/')
      ? modelId
      : `${provider}/${modelId}`;
    if (seen.has(composite)) continue;
    seen.add(composite);
    out.push({ id: composite, label: `${display} (${provider})` });
  }
  return out.length > 1 ? out : null;
}
