/**
 * Versioning contract:
 *   - `version` is monotonic per artifact `id` (starts at 1 from `create`).
 *   - `append` and `patch` advance the version by exactly 1.
 *   - `replace` accepts any version strictly greater than the current.
 *   - Out-of-order events are dropped by the reducer (no queue, no replay).
 */

export type ArtifactKind =
  | 'html'
  | 'svg'
  | 'react'
  | 'mermaid'
  | 'chart'
  | 'code'
  | 'markdown'
  | 'question-form'
  | 'direction-picker'
  | 'todo-list'
  | 'media-progress';

export interface ArtifactBase {
  id: string;
  taskId: string;
  messageId: string;
  kind: ArtifactKind;
  title: string;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface ArtifactSnapshot extends ArtifactBase {
  content: string;
  language?: string;
}

/**
 * Wire format for `artifact.patch` — google/diff-match-patch tagged tuples.
 * `eq` must echo the prior content byte-for-byte (integrity check); patches
 * cover the entire document, not just hunks.
 */
export interface DiffPatch {
  op: 'eq' | 'ins' | 'del';
  text: string;
}

export type ArtifactEvent =
  | { type: 'artifact.create'; artifact: ArtifactSnapshot }
  | { type: 'artifact.append'; id: string; version: number; chunk: string }
  | { type: 'artifact.replace'; id: string; version: number; content: string }
  | {
      type: 'artifact.patch';
      id: string;
      version: number;
      patches: DiffPatch[];
    }
  | { type: 'artifact.delete'; id: string };

export const ARTIFACT_KINDS: readonly ArtifactKind[] = [
  'html',
  'svg',
  'react',
  'mermaid',
  'chart',
  'code',
  'markdown',
  'question-form',
  'direction-picker',
  'todo-list',
  'media-progress',
] as const;

const ARTIFACT_EVENT_TYPES = new Set([
  'artifact.create',
  'artifact.append',
  'artifact.replace',
  'artifact.patch',
  'artifact.delete',
]);

/**
 * Shallow validation for SSE-delivered events. The canonical Zod schema
 * lives server-side in `src-api/src/shared/services/artifact-events.ts`.
 */
export function isArtifactEvent(value: unknown): value is ArtifactEvent {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { type?: unknown };
  if (typeof v.type !== 'string') return false;
  if (!ARTIFACT_EVENT_TYPES.has(v.type)) return false;

  switch (v.type) {
    case 'artifact.create': {
      const a = (v as { artifact?: unknown }).artifact;
      if (typeof a !== 'object' || a === null) return false;
      const s = a as Partial<ArtifactSnapshot>;
      return (
        typeof s.id === 'string' &&
        typeof s.taskId === 'string' &&
        typeof s.messageId === 'string' &&
        typeof s.kind === 'string' &&
        ARTIFACT_KINDS.includes(s.kind as ArtifactKind) &&
        typeof s.title === 'string' &&
        typeof s.version === 'number' &&
        Number.isFinite(s.version) &&
        typeof s.content === 'string'
      );
    }
    case 'artifact.append': {
      const e = v as { id?: unknown; version?: unknown; chunk?: unknown };
      return (
        typeof e.id === 'string' &&
        typeof e.version === 'number' &&
        Number.isFinite(e.version) &&
        typeof e.chunk === 'string'
      );
    }
    case 'artifact.replace': {
      const e = v as { id?: unknown; version?: unknown; content?: unknown };
      return (
        typeof e.id === 'string' &&
        typeof e.version === 'number' &&
        Number.isFinite(e.version) &&
        typeof e.content === 'string'
      );
    }
    case 'artifact.patch': {
      const e = v as { id?: unknown; version?: unknown; patches?: unknown };
      if (
        typeof e.id !== 'string' ||
        typeof e.version !== 'number' ||
        !Number.isFinite(e.version) ||
        !Array.isArray(e.patches)
      )
        return false;
      return e.patches.every(isDiffPatch);
    }
    case 'artifact.delete':
      return typeof (v as { id?: unknown }).id === 'string';
    default:
      return false;
  }
}

function isDiffPatch(value: unknown): value is DiffPatch {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as { op?: unknown; text?: unknown };
  return (
    (p.op === 'eq' || p.op === 'ins' || p.op === 'del') &&
    typeof p.text === 'string'
  );
}
