// Live model cache + custom-model sanitizer. Mirrors open-design's pattern:
// the chat handler validates user-picked model ids against either the
// most-recent live listing or the static fallback before passing them to a
// child process. Anything else goes through sanitizeCustomModel.

import type { AgentRuntimeDef, ModelOption } from './types.js';

const liveModelCache = new Map<string, Set<string>>();

export function rememberLiveModels(
  agentId: string,
  models: ModelOption[] | undefined,
): void {
  if (!Array.isArray(models)) return;
  liveModelCache.set(
    agentId,
    new Set(
      models
        .map((m) => m && m.id)
        .filter((id): id is string => typeof id === 'string'),
    ),
  );
}

export function getLiveModels(agentId: string): Set<string> | undefined {
  return liveModelCache.get(agentId);
}

export function isKnownModel(
  def: AgentRuntimeDef,
  modelId: string | undefined | null,
): boolean {
  if (!modelId) return false;
  const live = liveModelCache.get(def.id);
  if (live && live.has(modelId)) return true;
  if (Array.isArray(def.fallbackModels)) {
    return def.fallbackModels.some((m) => m.id === modelId);
  }
  return false;
}

// Permit user-typed model ids that didn't appear in either the live listing
// or the static fallback. The CLI gets the value as a child-process arg —
// not a shell string — so injection isn't a concern, but we still reject
// anything that could be misread as a flag, contains whitespace, or has
// control chars.
const CUSTOM_MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/;

export function sanitizeCustomModel(id: unknown): string | null {
  if (typeof id !== 'string') return null;
  const trimmed = id.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return null;
  if (!CUSTOM_MODEL_RE.test(trimmed)) return null;
  return trimmed;
}
