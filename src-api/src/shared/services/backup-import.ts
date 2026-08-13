/**
 * Transactional JSON-backup-v1 import.
 *
 * Local-first restore: validates the entire payload before writing, then
 * upserts sessions / tasks / messages / files inside a single SQLite
 * transaction. On any failure the whole import rolls back.
 */

import type Database from 'better-sqlite3';
import { z } from 'zod';

import { getDatabase } from '@/shared/db';
import { saveSetting } from '@/shared/db/operations';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('BackupImport');

// Backend mirror of src/shared/db/backup-schema.ts. Kept inline so the API
// package has no upward import into the frontend tree.
const SessionSchema = z
  .object({
    id: z.string(),
    prompt: z.string().optional().default(''),
    task_count: z.number().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .strip();

const TaskSchema = z
  .object({
    id: z.string(),
    session_id: z.string().optional().nullable(),
    task_index: z.number().optional().nullable(),
    prompt: z.string().optional().default(''),
    title: z.string().optional().nullable(),
    status: z.string().optional().default('completed'),
  })
  .strip();

const MessageSchema = z
  .object({
    task_id: z.string(),
    type: z.string().optional().default('text'),
    content: z.string().optional().nullable(),
    message_id: z.string().optional().nullable(),
  })
  .strip();

const FileSchema = z
  .object({
    task_id: z.string(),
    name: z.string(),
    type: z.string(),
    path: z.string(),
    preview: z.string().optional().nullable(),
    thumbnail: z.string().optional().nullable(),
    is_favorite: z.number().optional().default(0),
  })
  .strip();

export const BackupV1ServerSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  sessions: z.array(SessionSchema),
  tasks: z.array(TaskSchema),
  messages: z.array(MessageSchema),
  files: z.array(FileSchema),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export type BackupV1 = z.infer<typeof BackupV1ServerSchema>;

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

const empty = (): ImportCounts => ({
  inserted: 0,
  updated: 0,
  skipped: 0,
  failed: 0,
});

function upsertSessions(
  db: Database.Database,
  sessions: BackupV1['sessions'],
): ImportCounts {
  const counts = empty();
  const exists = db.prepare('SELECT id FROM sessions WHERE id = ?');
  const insert = db.prepare(
    'INSERT INTO sessions (id, prompt, task_count) VALUES (?, ?, ?)',
  );
  const update = db.prepare(
    'UPDATE sessions SET prompt = ?, task_count = ? WHERE id = ?',
  );
  for (const s of sessions) {
    try {
      const existing = exists.get(s.id);
      if (existing) {
        update.run(s.prompt ?? '', s.task_count ?? 0, s.id);
        counts.updated++;
      } else {
        insert.run(s.id, s.prompt ?? '', s.task_count ?? 0);
        counts.inserted++;
      }
    } catch (err) {
      logger.warn(`Skipped session ${s.id}: ${err}`);
      counts.failed++;
    }
  }
  return counts;
}

function upsertTasks(
  db: Database.Database,
  tasks: BackupV1['tasks'],
): ImportCounts {
  const counts = empty();
  const exists = db.prepare('SELECT id FROM tasks WHERE id = ?');
  const insert = db.prepare(
    `INSERT INTO tasks (id, session_id, task_index, prompt, title, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const update = db.prepare(
    `UPDATE tasks
        SET session_id = ?, task_index = ?, prompt = ?, title = ?, status = ?
      WHERE id = ?`,
  );
  for (const t of tasks) {
    try {
      const existing = exists.get(t.id);
      const args = [
        t.session_id ?? null,
        t.task_index ?? null,
        t.prompt ?? '',
        t.title ?? null,
        t.status ?? 'completed',
      ] as const;
      if (existing) {
        update.run(...args, t.id);
        counts.updated++;
      } else {
        insert.run(t.id, ...args);
        counts.inserted++;
      }
    } catch (err) {
      logger.warn(`Skipped task ${t.id}: ${err}`);
      counts.failed++;
    }
  }
  return counts;
}

function importMessages(
  db: Database.Database,
  messages: BackupV1['messages'],
): ImportCounts {
  const counts = empty();
  // Messages have an autoincrement primary key. Use message_id as the
  // dedupe key when present; otherwise insert a fresh row.
  const findByMessageId = db.prepare(
    'SELECT id FROM messages WHERE message_id = ?',
  );
  const insert = db.prepare(
    `INSERT INTO messages (task_id, type, content, message_id)
     VALUES (?, ?, ?, ?)`,
  );
  for (const m of messages) {
    try {
      if (m.message_id) {
        const existing = findByMessageId.get(m.message_id);
        if (existing) {
          counts.skipped++;
          continue;
        }
      }
      insert.run(
        m.task_id,
        m.type ?? 'text',
        m.content ?? null,
        m.message_id ?? null,
      );
      counts.inserted++;
    } catch (err) {
      logger.warn(`Skipped message for task ${m.task_id}: ${err}`);
      counts.failed++;
    }
  }
  return counts;
}

function importFiles(
  db: Database.Database,
  files: BackupV1['files'],
): ImportCounts {
  const counts = empty();
  // (task_id, path) is UNIQUE.
  const exists = db.prepare(
    'SELECT id FROM files WHERE task_id = ? AND path = ?',
  );
  const insert = db.prepare(
    `INSERT INTO files (task_id, name, type, path, preview, thumbnail, is_favorite)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const update = db.prepare(
    `UPDATE files
        SET name = ?, type = ?, preview = ?, thumbnail = ?, is_favorite = ?
      WHERE task_id = ? AND path = ?`,
  );
  for (const f of files) {
    try {
      const existing = exists.get(f.task_id, f.path);
      if (existing) {
        update.run(
          f.name,
          f.type,
          f.preview ?? null,
          f.thumbnail ?? null,
          f.is_favorite ?? 0,
          f.task_id,
          f.path,
        );
        counts.updated++;
      } else {
        insert.run(
          f.task_id,
          f.name,
          f.type,
          f.path,
          f.preview ?? null,
          f.thumbnail ?? null,
          f.is_favorite ?? 0,
        );
        counts.inserted++;
      }
    } catch (err) {
      logger.warn(`Skipped file ${f.path}: ${err}`);
      counts.failed++;
    }
  }
  return counts;
}

/**
 * Settings keys that are safe to restore from a backup. Anything outside
 * this allowlist (API keys, OAuth tokens, workDir, secrets) is skipped to
 * avoid letting a crafted backup overwrite sensitive configuration.
 *
 * Keep this list narrow and grow it deliberately. Prefer adding the key
 * here over moving sensitive data into a different setting bucket.
 */
const IMPORTABLE_SETTING_KEYS = new Set<string>([
  'theme',
  'language',
  'onboardingCompleted',
  'onboardingVersion',
  'firstRunCompletedAt',
  'demoSeededAt',
  'quickstart_step',
  'activeProfileId',
  'preferredModel',
  'sidebarCollapsed',
  'editorFontSize',
  'compactMode',
]);

function importSettings(
  settings: NonNullable<BackupV1['settings']>,
): ImportCounts {
  const counts = empty();
  for (const [key, value] of Object.entries(settings)) {
    if (!IMPORTABLE_SETTING_KEYS.has(key)) {
      counts.skipped++;
      continue;
    }
    try {
      const serialized =
        typeof value === 'string' ? value : JSON.stringify(value);
      saveSetting(key, serialized);
      counts.updated++;
    } catch (err) {
      logger.warn(`Skipped setting ${key}: ${err}`);
      counts.failed++;
    }
  }
  return counts;
}

export function importBackup(payload: unknown): ImportResult {
  const parsed = BackupV1ServerSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      success: false,
      sessions: empty(),
      tasks: empty(),
      messages: empty(),
      files: empty(),
      settings: empty(),
      error: parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; '),
    };
  }

  const data = parsed.data;
  const db = getDatabase();

  let result: ImportResult = {
    success: true,
    sessions: empty(),
    tasks: empty(),
    messages: empty(),
    files: empty(),
    settings: empty(),
  };

  try {
    db.transaction(() => {
      result.sessions = upsertSessions(db, data.sessions);
      result.tasks = upsertTasks(db, data.tasks);
      result.messages = importMessages(db, data.messages);
      result.files = importFiles(db, data.files);
      if (data.settings) {
        result.settings = importSettings(data.settings);
      }
    })();
  } catch (err) {
    logger.error('Backup import transaction failed:', err);
    return {
      success: false,
      sessions: empty(),
      tasks: empty(),
      messages: empty(),
      files: empty(),
      settings: empty(),
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return result;
}
