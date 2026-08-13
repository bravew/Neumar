import type { ArtifactSnapshot } from '@/shared/types/artifact';

export const TODO_ARTIFACT_DISMISSAL_STORAGE_KEY =
  'neuma.todoArtifactDismissals.v1';

const MAX_TODO_ARTIFACT_DISMISSALS = 100;

export function getTodoArtifactDismissalKey(snapshot: ArtifactSnapshot) {
  if (snapshot.kind !== 'todo-list') return null;
  return [
    snapshot.taskId,
    snapshot.id,
    String(snapshot.version),
    hashTodoSnapshotContent(snapshot.content),
  ].join(':');
}

export function readTodoArtifactDismissalKeys() {
  const storage = getLocalStorage();
  if (!storage) return new Set<string>();

  try {
    const raw = storage.getItem(TODO_ARTIFACT_DISMISSAL_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set(
      parsed.filter((key): key is string => typeof key === 'string'),
    );
  } catch {
    return new Set<string>();
  }
}

export function writeTodoArtifactDismissalKeys(keys: ReadonlySet<string>) {
  const storage = getLocalStorage();
  if (!storage) return;

  try {
    const pruned = Array.from(keys).slice(-MAX_TODO_ARTIFACT_DISMISSALS);
    storage.setItem(
      TODO_ARTIFACT_DISMISSAL_STORAGE_KEY,
      JSON.stringify(pruned),
    );
  } catch {
    // Local UI preference only; storage failures should not break artifacts.
  }
}

export function addTodoArtifactDismissalKey(
  keys: ReadonlySet<string>,
  key: string,
) {
  const next = new Set(keys);
  next.delete(key);
  next.add(key);
  while (next.size > MAX_TODO_ARTIFACT_DISMISSALS) {
    const oldest = next.values().next().value;
    if (!oldest) break;
    next.delete(oldest);
  }
  return next;
}

function getLocalStorage() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function hashTodoSnapshotContent(content: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < content.length; i += 1) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
