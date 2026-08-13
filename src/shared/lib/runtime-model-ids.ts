/**
 * Structured runtime model ids and per-mode capability gates for local CLI
 * agent runtimes.
 *
 * Runtime-backed models are stored in UI state as `<runtimeId>:<modelId>`
 * (e.g. `cursor-agent:auto`) so raw ids like `auto` or `claude-sonnet-5`
 * cannot collide across runtimes. The prefix is stripped when the run request
 * is built (`buildModelOverride`, design `sendModel()`); backend adapters
 * also tolerate prefixed ids, mirroring the `codex:<model>` contract.
 *
 * Note: `codex:` ids predate this module and keep their existing contract
 * (prefix flows to the backend; the Codex adapter strips it), so they are
 * intentionally NOT parsed here.
 */

export type RuntimeMode = 'task' | 'design' | 'video';

/** Local CLI runtimes whose models are picked as structured `<id>:<model>`. */
export const PREFIXED_RUNTIME_IDS = [
  'cursor-agent',
  'qwen',
  'copilot',
  'kimi',
  'atomcode',
] as const;

export type PrefixedRuntimeId = (typeof PREFIXED_RUNTIME_IDS)[number];

/** Build a structured runtime model id: `cursor-agent` + `auto` → `cursor-agent:auto`. */
export function formatRuntimeModelId(
  runtimeId: PrefixedRuntimeId,
  modelId: string,
): string {
  return `${runtimeId}:${modelId}`;
}

/**
 * Parse a structured runtime model id back into runtime + bare model.
 * Returns null for anything that is not a `<prefixed-runtime>:<model>` id —
 * including `codex:` ids, which keep their own established contract.
 */
export function parseRuntimeModelId(
  selectedId: string,
): { runtimeId: PrefixedRuntimeId; model: string } | null {
  for (const runtimeId of PREFIXED_RUNTIME_IDS) {
    const prefix = `${runtimeId}:`;
    if (selectedId.startsWith(prefix) && selectedId.length > prefix.length) {
      return { runtimeId, model: selectedId.slice(prefix.length) };
    }
  }
  return null;
}
