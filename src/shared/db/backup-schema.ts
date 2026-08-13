/**
 * Plain-TS validator for the JSON backup v1 produced by Settings → Data →
 * Export and consumed by Settings → Data → Import.
 *
 * Note: the backend (`src-api/src/shared/services/backup-import.ts`) is the
 * authoritative validator — it uses Zod and runs inside the import
 * transaction. This frontend check exists only to render a preview before
 * the user confirms. We avoid taking a Zod dependency in the frontend
 * bundle for a single dialog.
 */

export interface BackupV1 {
  version: 1;
  exportedAt: string;
  sessions: Array<Record<string, unknown> & { id: string }>;
  tasks: Array<Record<string, unknown> & { id: string }>;
  messages: Array<Record<string, unknown>>;
  files: Array<Record<string, unknown>>;
  settings?: Record<string, unknown>;
}

export interface ImportCounts {
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
}

export interface ImportResult {
  success: boolean;
  sessions: ImportCounts;
  tasks: ImportCounts;
  messages: ImportCounts;
  files: ImportCounts;
  settings: ImportCounts;
  error?: string;
}

export interface BackupValidation {
  ok: boolean;
  errors: string[];
  data: BackupV1 | null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function validateBackupV1(payload: unknown): BackupValidation {
  const errors: string[] = [];
  if (!isObject(payload)) {
    return { ok: false, errors: ['(root): expected an object'], data: null };
  }
  const p = payload as Record<string, unknown>;

  if (p.version !== 1) {
    errors.push('version: expected literal 1');
  }
  if (typeof p.exportedAt !== 'string') {
    errors.push('exportedAt: expected string');
  }
  for (const key of ['sessions', 'tasks', 'messages', 'files'] as const) {
    if (!Array.isArray(p[key])) {
      errors.push(`${key}: expected array`);
    }
  }
  if (p.settings !== undefined && !isObject(p.settings)) {
    errors.push('settings: expected object or undefined');
  }

  if (errors.length > 0) {
    return { ok: false, errors: errors.slice(0, 5), data: null };
  }
  return { ok: true, errors: [], data: payload as unknown as BackupV1 };
}
