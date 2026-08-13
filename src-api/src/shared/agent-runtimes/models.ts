// Model parsing helpers shared across runtime defs.

import type { ModelOption } from './types.js';

export const DEFAULT_MODEL_OPTION: ModelOption = {
  id: 'default',
  label: 'Default (CLI config)',
};

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
