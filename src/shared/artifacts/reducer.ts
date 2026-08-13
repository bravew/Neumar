/**
 * Pure reducer: drops stale/out-of-order events, never throws, never
 * mutates input. Returns the same reference on no-op so `Object.is`
 * skips re-renders.
 */

import type {
  ArtifactEvent,
  ArtifactSnapshot,
  DiffPatch,
} from '@/shared/types/artifact';

export type ArtifactMap = ReadonlyMap<string, ArtifactSnapshot>;

export const EMPTY_ARTIFACT_MAP: ArtifactMap = new Map();

export function applyArtifactEvent(
  state: ArtifactMap,
  event: ArtifactEvent,
): ArtifactMap {
  switch (event.type) {
    case 'artifact.create': {
      const incoming = event.artifact;
      const existing = state.get(incoming.id);
      if (existing && existing.version >= incoming.version) return state;
      return cloneWith(state, incoming.id, incoming);
    }

    case 'artifact.append': {
      const existing = state.get(event.id);
      if (!existing) return state;
      if (event.version !== existing.version + 1) return state;
      return cloneWith(state, event.id, {
        ...existing,
        version: event.version,
        content: existing.content + event.chunk,
        updatedAt: Date.now(),
      });
    }

    case 'artifact.replace': {
      const existing = state.get(event.id);
      if (!existing) return state;
      if (event.version <= existing.version) return state;
      return cloneWith(state, event.id, {
        ...existing,
        version: event.version,
        content: event.content,
        updatedAt: Date.now(),
      });
    }

    case 'artifact.patch': {
      const existing = state.get(event.id);
      if (!existing) return state;
      if (event.version !== existing.version + 1) return state;
      const next = applyDiffPatches(existing.content, event.patches);
      if (next === null) return state;
      return cloneWith(state, event.id, {
        ...existing,
        version: event.version,
        content: next,
        updatedAt: Date.now(),
      });
    }

    case 'artifact.delete': {
      if (!state.has(event.id)) return state;
      const next = new Map(state);
      next.delete(event.id);
      return next;
    }

    default: {
      const _exhaustive: never = event;
      void _exhaustive;
      return state;
    }
  }
}

export function reduceArtifactEvents(
  state: ArtifactMap,
  events: readonly ArtifactEvent[],
): ArtifactMap {
  let next = state;
  for (const ev of events) next = applyArtifactEvent(next, ev);
  return next;
}

/** Cap on a single artifact's content. Patches that would push past this are dropped. */
export const MAX_ARTIFACT_BYTES = 4 * 1024 * 1024;

/** Returns `null` when an `eq` segment fails to echo `previous` or output exceeds `MAX_ARTIFACT_BYTES`. */
export function applyDiffPatches(
  previous: string,
  patches: readonly DiffPatch[],
): string | null {
  let cursor = 0;
  let result = '';
  for (const p of patches) {
    if (p.op === 'eq') {
      if (previous.slice(cursor, cursor + p.text.length) !== p.text) {
        return null;
      }
      cursor += p.text.length;
      result += p.text;
    } else if (p.op === 'del') {
      if (previous.slice(cursor, cursor + p.text.length) !== p.text) {
        return null;
      }
      cursor += p.text.length;
    } else {
      result += p.text;
    }
    if (result.length > MAX_ARTIFACT_BYTES) return null;
  }
  if (cursor !== previous.length) return null;
  return result;
}

function cloneWith(
  state: ArtifactMap,
  id: string,
  snapshot: ArtifactSnapshot,
): ArtifactMap {
  const next = new Map(state);
  next.set(id, snapshot);
  return next;
}
