/**
 * Database Operations
 *
 * All CRUD operations for sessions, tasks, messages, files, and media versions.
 */

import crypto from 'crypto';
import { homedir } from 'os';

import type Database from 'better-sqlite3';

import type { RunMode } from '@/core/agent/runtime-state';

import { getDatabase } from './index';
import { hasColumn } from './migrations/utils';
import type {
  ActivityEvent,
  ActorType,
  AgentProfile,
  AgentSoul,
  Correction,
  Learning,
  SoulOrigin,
  Approval,
  ApprovalStatus,
  BudgetPolicy,
  BudgetSpendCache,
  ChannelAuditLog,
  ChannelConfig,
  ChannelMessage,
  ChannelPairingCode,
  ChannelPermissionTier,
  ChannelPlatform,
  ChannelSession,
  ChannelUser,
  CreateActivityEventInput,
  CreateAgentQuestionInput,
  CreateAgentProfileInput,
  CreateApprovalInput,
  CreateBudgetPolicyInput,
  CreateChannelConfigInput,
  CreateChannelSessionInput,
  CreateFileInput,
  CreateFileSnapshotInput,
  CreateGoalInput,
  CreateMessageInput,
  CreateOrchestrationRunInput,
  CreateProjectInput,
  CreateSessionInput,
  CreateTaskCommentInput,
  CreateTaskDocumentInput,
  CreateTaskInput,
  CreateTaskLinkInput,
  CreateUserTemplateInput,
  EntityType,
  FileSnapshot,
  Goal,
  InsertAuditLogInput,
  InsertChannelMessageInput,
  InsertPublishDestinationLegRowInput,
  InsertPublishJobRowInput,
  LibraryFile,
  MediaVersionRecord,
  Message,
  OrchestrationRun,
  OrchestrationRunStatus,
  ProfileStatus,
  Project,
  PublishDestinationLegRow,
  PublishJobRow,
  Session,
  Task,
  TaskComment,
  TaskDocument,
  TaskDocumentHistoryEntry,
  TaskLink,
  UpdateAgentProfileInput,
  UpdateBudgetPolicyInput,
  UpdateGoalInput,
  UpdateProjectInput,
  UpdateTaskInput,
  UpdateUserTemplateInput,
  UserTemplate,
  AgentQuestionRow,
} from './types';

// ============ Session Operations ============

export function createSession(input: CreateSessionInput): Session {
  const db = getDatabase();

  const stmt = db.prepare(
    'INSERT INTO sessions (id, prompt, task_count) VALUES (?, ?, ?)',
  );
  stmt.run(input.id, input.prompt, 0);

  const session = getSession(input.id);
  if (!session)
    throw new Error('Failed to create session: row not found after insert');
  return session;
}

export function getSession(id: string): Session | null {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
  const result = stmt.get(id) as Session | undefined;
  return result || null;
}

export function getAllSessions(): Session[] {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM sessions ORDER BY created_at DESC');
  return stmt.all() as Session[];
}

export function updateSessionTaskCount(
  sessionId: string,
  taskCount: number,
): void {
  const db = getDatabase();
  const stmt = db.prepare(
    "UPDATE sessions SET task_count = ?, updated_at = datetime('now') WHERE id = ?",
  );
  stmt.run(taskCount, sessionId);
}

export function getTasksBySessionId(sessionId: string): Task[] {
  const db = getDatabase();
  const stmt = db.prepare(
    'SELECT * FROM tasks WHERE session_id = ? ORDER BY task_index ASC',
  );
  const tasks = stmt.all(sessionId) as Task[];

  // Convert favorite from 0/1 to boolean
  return tasks.map((task) => ({
    ...task,
    favorite: Boolean(task.favorite),
  }));
}

// ============ Task Operations ============

export function createTask(input: CreateTaskInput): Task {
  const db = getDatabase();

  // Use transaction to ensure task insert + session count update are atomic
  const insertTaskTx = db.transaction(() => {
    const stmt = db.prepare(
      "INSERT INTO tasks (id, session_id, task_index, prompt, work_dir, additional_work_dirs, agent_session_id, parent_task_id, project_id, assignee_profile_id, started_at, heartbeat_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
    );
    stmt.run(
      input.id,
      input.session_id,
      input.task_index,
      input.prompt,
      input.work_dir || null,
      input.additional_work_dirs || null,
      input.agent_session_id || null,
      input.parent_task_id || null,
      input.project_id || null,
      input.assignee_profile_id || null,
    );

    // Update session task count to the actual number of tasks
    const updateStmt = db.prepare(
      "UPDATE sessions SET task_count = (SELECT COUNT(*) FROM tasks WHERE session_id = ?), updated_at = datetime('now') WHERE id = ?",
    );
    updateStmt.run(input.session_id, input.session_id);
  });

  insertTaskTx();

  const task = getTask(input.id);
  if (!task)
    throw new Error('Failed to create task: row not found after insert');
  return task;
}

export function getTask(id: string): Task | null {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM tasks WHERE id = ?');
  const result = stmt.get(id) as Task | undefined;

  if (!result) return null;

  return { ...result, favorite: Boolean(result.favorite) };
}

/** Touch a task's updated_at timestamp without changing any other fields. */
export function touchTask(id: string): void {
  const db = getDatabase();
  db.prepare("UPDATE tasks SET updated_at = datetime('now') WHERE id = ?").run(
    id,
  );
}

export function getAllTasks(filter?: {
  projectId?: string;
  unassigned?: boolean;
}): Task[] {
  const db = getDatabase();
  let sql = 'SELECT * FROM tasks';
  const params: unknown[] = [];

  if (filter?.projectId) {
    sql += ' WHERE project_id = ?';
    params.push(filter.projectId);
  } else if (filter?.unassigned) {
    sql += ' WHERE project_id IS NULL';
  }

  sql += ' ORDER BY created_at DESC';
  const tasks = db.prepare(sql).all(...params) as Task[];

  // Convert favorite from 0/1 to boolean for all tasks
  return tasks.map((task) => ({
    ...task,
    favorite: Boolean(task.favorite),
  }));
}

export function searchTasks(
  query: string,
  limit = 50,
  options?: { projectId?: string },
): Task[] {
  const db = getDatabase();
  const escaped = query
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
  const pattern = `%${escaped}%`;
  const filters = ["(title LIKE ? ESCAPE '\\' OR prompt LIKE ? ESCAPE '\\')"];
  const params: Array<string | number> = [pattern, pattern];
  if (options?.projectId) {
    filters.push('project_id = ?');
    params.push(options.projectId);
  }
  params.push(limit);
  const stmt = db.prepare(
    `SELECT * FROM tasks WHERE ${filters.join(' AND ')} ORDER BY updated_at DESC LIMIT ?`,
  );
  const tasks = stmt.all(...params) as Task[];

  return tasks.map((task) => ({
    ...task,
    favorite: Boolean(task.favorite),
  }));
}

/**
 * Update task fields dynamically.
 *
 * SAFETY: Column names in `updates` are hardcoded string literals below —
 * never derived from user input. Values are parameterized via `?` placeholders.
 * Do NOT add user-controlled column names without proper allowlisting.
 */
export function updateTask(id: string, input: UpdateTaskInput): Task | null {
  const db = getDatabase();

  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (input.status !== undefined) {
    updates.push('status = ?');
    values.push(input.status);
  }
  if (input.cost !== undefined) {
    updates.push('cost = ?');
    values.push(input.cost);
  }
  if (input.duration !== undefined) {
    updates.push('duration = ?');
    values.push(input.duration);
  }
  if (input.prompt !== undefined) {
    updates.push('prompt = ?');
    values.push(input.prompt);
  }
  if (input.title !== undefined) {
    updates.push('title = ?');
    values.push(input.title);
  }
  if (input.work_dir !== undefined) {
    updates.push('work_dir = ?');
    values.push(input.work_dir);
  }
  if (input.agent_session_id !== undefined) {
    updates.push('agent_session_id = ?');
    values.push(input.agent_session_id);
  }
  if (input.favorite !== undefined) {
    updates.push('favorite = ?');
    values.push(input.favorite ? 1 : 0);
  }
  if (input.project_id !== undefined) {
    updates.push('project_id = ?');
    values.push(input.project_id);
  }
  if (input.goal_id !== undefined) {
    updates.push('goal_id = ?');
    values.push(input.goal_id);
  }
  if (input.parent_task_id !== undefined) {
    updates.push('parent_task_id = ?');
    values.push(input.parent_task_id);
  }
  if (input.priority !== undefined) {
    updates.push('priority = ?');
    values.push(input.priority);
  }
  if (input.labels !== undefined) {
    updates.push('labels = ?');
    values.push(input.labels);
  }
  if (input.blocked_reason !== undefined) {
    updates.push('blocked_reason = ?');
    values.push(input.blocked_reason);
  }
  if (input.applied_plugin_id !== undefined) {
    updates.push('applied_plugin_id = ?');
    values.push(input.applied_plugin_id);
  }
  if (input.applied_plugin_snapshot_json !== undefined) {
    updates.push('applied_plugin_snapshot_json = ?');
    values.push(input.applied_plugin_snapshot_json);
  }

  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')");
    values.push(id);

    const stmt = db.prepare(
      `UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`,
    );
    stmt.run(...values);
  }

  return getTask(id);
}

export function deleteTask(id: string): boolean {
  const db = getDatabase();

  // Use transaction to ensure task + related data are deleted atomically
  const deleteTaskTx = db.transaction(() => {
    db.prepare('DELETE FROM trace_events WHERE task_id = ?').run(id);
    db.prepare('DELETE FROM provider_conversation_state WHERE task_id = ?').run(
      id,
    );
    db.prepare('DELETE FROM messages WHERE task_id = ?').run(id);
    db.prepare('DELETE FROM agent_questions WHERE task_id = ?').run(id);
    db.prepare('DELETE FROM files WHERE task_id = ?').run(id);
    db.prepare('DELETE FROM media_versions WHERE task_id = ?').run(id);
    db.prepare('DELETE FROM task_comments WHERE task_id = ?').run(id);
    db.prepare(
      'DELETE FROM task_links WHERE from_task_id = ? OR to_task_id = ?',
    ).run(id, id);
    db.prepare('DELETE FROM orchestration_runs WHERE task_id = ?').run(id);
    // Clear parent references from child tasks
    db.prepare(
      'UPDATE tasks SET parent_task_id = NULL WHERE parent_task_id = ?',
    ).run(id);
    return db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  });

  const result = deleteTaskTx();
  return result.changes > 0;
}

// ============ Agent Question Operations ============

export function createAgentQuestion(
  input: CreateAgentQuestionInput,
): AgentQuestionRow {
  const db = getDatabase();
  const id = input.id ?? crypto.randomUUID();
  const questionsJson = JSON.stringify(input.questions);

  const existing =
    input.task_id && input.tool_use_id
      ? getPendingAgentQuestionByTaskTool(input.task_id, input.tool_use_id)
      : null;
  if (existing) return existing;

  const stmt = db.prepare(`
    INSERT INTO agent_questions (
      id, session_id, task_id, tool_use_id, questions_json, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id,
    input.session_id,
    input.task_id ?? null,
    input.tool_use_id ?? null,
    questionsJson,
    input.expires_at ?? null,
  );

  const question = getAgentQuestion(id);
  if (!question) {
    throw new Error('Failed to create agent question: row not found');
  }
  return question;
}

export function getAgentQuestion(id: string): AgentQuestionRow | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM agent_questions WHERE id = ?')
    .get(id) as AgentQuestionRow | undefined;
  return row ?? null;
}

export function getPendingAgentQuestionByTaskTool(
  taskId: string,
  toolUseId: string,
): AgentQuestionRow | null {
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT * FROM agent_questions
       WHERE task_id = ? AND tool_use_id = ? AND status = 'pending'
       ORDER BY asked_at DESC
       LIMIT 1`,
    )
    .get(taskId, toolUseId) as AgentQuestionRow | undefined;
  return row ?? null;
}

export function getPendingAgentQuestions(filter: {
  sessionId?: string;
  taskId?: string;
}): AgentQuestionRow[] {
  const db = getDatabase();
  if (filter.taskId) {
    return db
      .prepare(
        `SELECT * FROM agent_questions
         WHERE task_id = ? AND status = 'pending'
         ORDER BY asked_at ASC`,
      )
      .all(filter.taskId) as AgentQuestionRow[];
  }
  if (filter.sessionId) {
    return db
      .prepare(
        `SELECT * FROM agent_questions
         WHERE session_id = ? AND status = 'pending'
         ORDER BY asked_at ASC`,
      )
      .all(filter.sessionId) as AgentQuestionRow[];
  }
  return [];
}

export function answerAgentQuestion(
  id: string,
  answer: unknown,
): AgentQuestionRow | null {
  const db = getDatabase();
  const answerJson = JSON.stringify(answer);
  const result = db
    .prepare(
      `UPDATE agent_questions
       SET status = 'answered',
           answer_json = ?,
           answered_at = datetime('now'),
           updated_at = datetime('now')
       WHERE id = ? AND status = 'pending'`,
    )
    .run(answerJson, id);
  if (result.changes === 0) return getAgentQuestion(id);
  return getAgentQuestion(id);
}

export function cancelPendingAgentQuestionsForTask(taskId: string): number {
  const db = getDatabase();
  const result = db
    .prepare(
      `UPDATE agent_questions
       SET status = 'cancelled',
           updated_at = datetime('now')
       WHERE task_id = ? AND status = 'pending'`,
    )
    .run(taskId);
  return result.changes;
}

// ============ Message Operations ============

export function createMessage(input: CreateMessageInput): Message {
  const db = getDatabase();

  const stmt = db.prepare(`
    INSERT INTO messages (
      task_id, type, content, tool_name, tool_input, tool_output,
      tool_use_id, subtype, error_message, attachments, message_id,
      cost, usage_input, usage_output, usage_cache_read, usage_cache_creation, model,
      agui_type, run_id, step_name, is_error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  try {
    const result = stmt.run(
      input.task_id,
      input.type,
      input.content || null,
      input.tool_name || null,
      input.tool_input || null,
      input.tool_output || null,
      input.tool_use_id || null,
      input.subtype || null,
      input.error_message || null,
      input.attachments || null,
      input.message_id || null,
      input.cost ?? null,
      input.usage_input ?? null,
      input.usage_output ?? null,
      input.usage_cache_read ?? null,
      input.usage_cache_creation ?? null,
      input.model || null,
      input.agui_type || null,
      input.run_id || null,
      input.step_name || null,
      input.is_error ? 1 : 0,
    );

    const message = getMessage(result.lastInsertRowid as number);
    if (!message) throw new Error('Failed to create message');
    return message;
  } catch (err) {
    // The partial UNIQUE index on `message_id` rejects duplicates. This is
    // expected when the frontend and ag-ui.ts both try to persist the same
    // user message — return the existing row so the caller sees a 200 with
    // the canonical message instead of a 500.
    if (
      input.message_id &&
      err instanceof Error &&
      /UNIQUE constraint failed.*message_id/i.test(err.message)
    ) {
      const existing = db
        .prepare('SELECT * FROM messages WHERE message_id = ? LIMIT 1')
        .get(input.message_id) as Message | undefined;
      if (existing) return existing;
    }
    throw err;
  }
}

/**
 * Check if a message with the given message_id already exists.
 * Used for idempotency checks to prevent duplicate message insertion.
 */
export function messageExists(messageId: string): boolean {
  const db = getDatabase();
  const stmt = db.prepare(
    'SELECT 1 FROM messages WHERE message_id = ? LIMIT 1',
  );
  const result = stmt.get(messageId);
  return !!result;
}

export function updateMessageContent(
  messageId: string,
  content: string,
): boolean {
  const db = getDatabase();
  const stmt = db.prepare(
    'UPDATE messages SET content = ? WHERE message_id = ?',
  );
  return stmt.run(content, messageId).changes > 0;
}

function getMessage(id: number): Message | null {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM messages WHERE id = ?');
  const result = stmt.get(id) as Message | undefined;
  return result || null;
}

export function getMessagesByTaskId(taskId: string): Message[] {
  const db = getDatabase();
  const stmt = db.prepare(
    // created_at is second-level precision; streamed chunks can share timestamps.
    // Use insertion id to preserve deterministic message order on task reload.
    'SELECT * FROM messages WHERE task_id = ? ORDER BY id ASC',
  );
  return stmt.all(taskId) as Message[];
}

export function deleteMessagesByTaskId(taskId: string): number {
  const db = getDatabase();
  const stmt = db.prepare('DELETE FROM messages WHERE task_id = ?');
  const result = stmt.run(taskId);
  return result.changes;
}

export function deleteMessagesAfter(
  taskId: string,
  afterMessageId: number,
): number {
  const db = getDatabase();
  const stmt = db.prepare(
    `DELETE FROM messages
     WHERE task_id = ?
       AND id > ?
       AND COALESCE(branch_id, 'main') = (
         SELECT COALESCE(branch_id, 'main')
         FROM messages
         WHERE task_id = ? AND id = ?
       )`,
  );
  const result = stmt.run(taskId, afterMessageId, taskId, afterMessageId);
  return result.changes;
}

/** Message type constants for task status transitions */
const MESSAGE_TYPE_RESULT = 'result';
const MESSAGE_TYPE_ERROR = 'error';
const MESSAGE_SUBTYPE_SUCCESS = 'success';
const MESSAGE_SUBTYPE_MAX_TURNS = 'error_max_turns';

// Helper function to update task status based on message type
export function updateTaskFromMessage(
  taskId: string,
  messageType: string,
  subtype?: string,
  cost?: number,
  duration?: number,
): void {
  if (messageType === MESSAGE_TYPE_RESULT) {
    if (subtype === MESSAGE_SUBTYPE_SUCCESS) {
      updateTask(taskId, { status: 'completed', cost, duration });
    } else if (subtype === MESSAGE_SUBTYPE_MAX_TURNS) {
      // Task hit max turns limit - keep as running, just update cost/duration
      updateTask(taskId, { cost, duration });
    } else {
      // Other errors
      updateTask(taskId, { status: 'error', cost, duration });
    }
  } else if (messageType === MESSAGE_TYPE_ERROR) {
    updateTask(taskId, { status: 'error' });
  }
}

// ============ File Operations ============

let filesHasProvenance: boolean | null = null;

export function createFile(input: CreateFileInput): LibraryFile {
  const db = getDatabase();

  // Deduplicate: if a record with same (task_id, path) already exists, return it
  // instead of creating a duplicate (multiple tool outputs can reference the same file).
  // When a later scan has provenance that the first insert lacked, backfill it.
  const existing = db
    .prepare('SELECT * FROM files WHERE task_id = ? AND path = ?')
    .get(input.task_id, input.path) as LibraryFile | undefined;
  // Pre-migration-004 DBs lack the provenance column; cache the check so we
  // don't run PRAGMA on every file insert.
  if (filesHasProvenance === null) {
    filesHasProvenance = hasColumn(db, 'files', 'provenance');
  }

  if (existing) {
    if (input.provenance && !existing.provenance && filesHasProvenance) {
      db.prepare('UPDATE files SET provenance = ? WHERE id = ?').run(
        input.provenance,
        existing.id,
      );
      return { ...existing, provenance: input.provenance };
    }
    return existing;
  }

  const result = filesHasProvenance
    ? db
        .prepare(
          `INSERT INTO files (task_id, name, type, path, preview, thumbnail, provenance)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.task_id,
          input.name,
          input.type,
          input.path,
          input.preview || null,
          input.thumbnail || null,
          input.provenance || null,
        )
    : db
        .prepare(
          `INSERT INTO files (task_id, name, type, path, preview, thumbnail)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.task_id,
          input.name,
          input.type,
          input.path,
          input.preview || null,
          input.thumbnail || null,
        );

  const file = getFile(result.lastInsertRowid as number);
  if (!file) throw new Error('Failed to create file');
  return file;
}

function getFile(id: number): LibraryFile | null {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM files WHERE id = ?');
  const result = stmt.get(id) as LibraryFile | undefined;
  return result || null;
}

export function getFilesByTaskId(taskId: string): LibraryFile[] {
  const db = getDatabase();
  const stmt = db.prepare(
    'SELECT * FROM files WHERE task_id = ? ORDER BY created_at ASC',
  );
  return stmt.all(taskId) as LibraryFile[];
}

export function getAllFiles(): LibraryFile[] {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM files ORDER BY created_at DESC');
  return stmt.all() as LibraryFile[];
}

export function toggleFileFavorite(fileId: number): LibraryFile | null {
  const db = getDatabase();
  const stmt = db.prepare(
    'UPDATE files SET is_favorite = NOT is_favorite WHERE id = ?',
  );
  stmt.run(fileId);
  return getFile(fileId);
}

export function deleteFile(fileId: number): boolean {
  const db = getDatabase();
  const stmt = db.prepare('DELETE FROM files WHERE id = ?');
  const result = stmt.run(fileId);
  return result.changes > 0;
}

export function getFilesGroupedByTask(): {
  task: Task;
  files: LibraryFile[];
}[] {
  const db = getDatabase();

  // Single JOIN query: fetch only tasks that have files, ordered by task date
  const rows = db
    .prepare(
      `SELECT
        t.id AS t_id, t.session_id, t.task_index, t.prompt, t.status,
        t.cost, t.duration, t.favorite, t.created_at AS t_created_at,
        t.updated_at AS t_updated_at,
        f.id AS f_id, f.task_id, f.name, f.type, f.path, f.preview,
        f.thumbnail, f.is_favorite, f.created_at AS f_created_at,
        f.provenance
      FROM tasks t
      INNER JOIN files f ON f.task_id = t.id
      ORDER BY t.created_at DESC, f.created_at DESC`,
    )
    .all() as Record<string, unknown>[];

  // Group rows by task
  const groupMap = new Map<string, { task: Task; files: LibraryFile[] }>();
  for (const row of rows) {
    const taskId = row.t_id as string;
    let group = groupMap.get(taskId);
    if (!group) {
      group = {
        task: {
          id: taskId,
          session_id: row.session_id as string,
          task_index: row.task_index as number,
          prompt: row.prompt as string,
          status: row.status as Task['status'],
          cost: row.cost as number | null,
          duration: row.duration as number | null,
          favorite: Boolean(row.favorite),
          created_at: row.t_created_at as string,
          updated_at: row.t_updated_at as string,
        },
        files: [],
      };
      groupMap.set(taskId, group);
    }
    group.files.push({
      id: row.f_id as number,
      task_id: row.task_id as string,
      name: row.name as string,
      type: row.type as LibraryFile['type'],
      path: row.path as string,
      preview: (row.preview as string) || null,
      thumbnail: (row.thumbnail as string) || null,
      is_favorite: Boolean(row.is_favorite),
      created_at: row.f_created_at as string,
      provenance: (row.provenance as string | null) ?? null,
    });
  }

  return Array.from(groupMap.values());
}

// ============ Media Version Operations ============

export function saveMediaVersion(version: MediaVersionRecord): void {
  const db = getDatabase();

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO media_versions (
      id, task_id, artifact_id, version_number, path, prompt,
      previous_version_id, type, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    version.id,
    version.task_id,
    version.artifact_id,
    version.version_number,
    version.path,
    version.prompt,
    version.previous_version_id,
    version.type,
    version.created_at,
  );
}

export function getMediaVersionsByTaskId(taskId: string): MediaVersionRecord[] {
  const db = getDatabase();
  const stmt = db.prepare(
    'SELECT * FROM media_versions WHERE task_id = ? ORDER BY version_number ASC',
  );
  return stmt.all(taskId) as MediaVersionRecord[];
}

export function deleteMediaVersionsByTaskId(taskId: string): number {
  const db = getDatabase();
  const stmt = db.prepare('DELETE FROM media_versions WHERE task_id = ?');
  const result = stmt.run(taskId);
  return result.changes;
}

// ============ Settings Operations ============

/**
 * Get a setting value by key.
 *
 * Common keys:
 * - `workDir`: Global workspace root directory — the user-configured top-level
 *   directory for all task outputs. Use instead of `process.cwd()` for workspace paths.
 */
export function getSetting(key: string): string | null {
  const db = getDatabase();
  const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
  const result = stmt.get(key) as { value: string } | undefined;
  if (!result) return null;
  // Strip JSON quotes — some settings are stored as JSON-encoded strings
  // (e.g. '"~/.neumar"' instead of '~/.neumar') which breaks path operations.
  let value = result.value;
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'string') value = parsed;
    } catch {
      // Not valid JSON — use as-is
    }
  }
  // Expand ~ for directory settings — path.resolve does NOT handle tilde
  // expansion, and in the Tauri sidecar cwd is '/' so resolve('~/foo')
  // becomes '/~/foo' which fails.
  if (key === 'workDir' && value.startsWith('~')) {
    return value.replace('~', homedir());
  }
  return value;
}

export function saveSetting(key: string, value: string): void {
  const db = getDatabase();
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))`,
  );
  stmt.run(key, value);
}

export function getAllSettings(): Record<string, string> {
  const db = getDatabase();
  const stmt = db.prepare('SELECT key, value FROM settings');
  const results = stmt.all() as { key: string; value: string }[];

  const settings: Record<string, string> = {};
  for (const row of results) {
    settings[row.key] = row.value;
  }
  return settings;
}

export function clearAllSettings(): void {
  const db = getDatabase();
  const stmt = db.prepare('DELETE FROM settings');
  stmt.run();
}

// ============ Orchestration Run Operations ============

export function createOrchestrationRun(
  input: CreateOrchestrationRunInput,
): OrchestrationRun {
  const db = getDatabase();
  const stmt = db.prepare(`
    INSERT INTO orchestration_runs (id, task_id, run_type, payload, resume_token)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(
    input.id,
    input.task_id,
    input.run_type,
    input.payload,
    input.resume_token || null,
  );

  const run = getOrchestrationRun(input.id);
  if (!run)
    throw new Error(
      'Failed to create orchestration run: row not found after insert',
    );
  return run;
}

export function getOrchestrationRun(id: string): OrchestrationRun | null {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM orchestration_runs WHERE id = ?');
  const result = stmt.get(id) as OrchestrationRun | undefined;
  return result || null;
}

export function getOrchestrationRunsByTaskId(
  taskId: string,
): OrchestrationRun[] {
  const db = getDatabase();
  const stmt = db.prepare(
    'SELECT * FROM orchestration_runs WHERE task_id = ? ORDER BY created_at DESC',
  );
  return stmt.all(taskId) as OrchestrationRun[];
}

export function updateOrchestrationRunStatus(
  id: string,
  status: OrchestrationRunStatus,
  resumeToken?: string | null,
): boolean {
  const db = getDatabase();
  const updates = ['status = ?', "updated_at = datetime('now')"];
  const values: (string | null)[] = [status];

  if (resumeToken !== undefined) {
    updates.push('resume_token = ?');
    values.push(resumeToken);
  }

  values.push(id);
  const stmt = db.prepare(
    `UPDATE orchestration_runs SET ${updates.join(', ')} WHERE id = ?`,
  );
  return stmt.run(...values).changes > 0;
}

export function updateOrchestrationRunPayload(
  id: string,
  payload: string,
): boolean {
  const db = getDatabase();
  const stmt = db.prepare(
    "UPDATE orchestration_runs SET payload = ?, updated_at = datetime('now') WHERE id = ?",
  );
  return stmt.run(payload, id).changes > 0;
}

export function deleteOrchestrationRun(id: string): boolean {
  const db = getDatabase();
  const stmt = db.prepare('DELETE FROM orchestration_runs WHERE id = ?');
  return stmt.run(id).changes > 0;
}

export function getPendingOrchestrationRuns(): OrchestrationRun[] {
  const db = getDatabase();
  const stmt = db.prepare(
    "SELECT * FROM orchestration_runs WHERE status IN ('pending', 'approved') ORDER BY created_at ASC",
  );
  return stmt.all() as OrchestrationRun[];
}

// ============ Zombie Recovery Operations ============

export function updateTaskHeartbeat(taskId: string): void {
  const db = getDatabase();
  db.prepare(
    "UPDATE tasks SET heartbeat_at = datetime('now') WHERE id = ?",
  ).run(taskId);
}

export function markZombieTasks(timeoutMinutes: number = 10): { id: string }[] {
  const db = getDatabase();
  const stmt = db.prepare(
    "UPDATE tasks SET status = 'error' WHERE status = 'running' AND heartbeat_at < datetime('now', '-' || ? || ' minutes') RETURNING id",
  );
  return stmt.all(timeoutMinutes) as { id: string }[];
}

// ============ Project Operations ============

export function createProject(input: CreateProjectInput): Project {
  const db = getDatabase();
  const tx = db.transaction(() => {
    const stmt = db.prepare(
      'INSERT INTO projects (id, name, description, color, workspace) VALUES (?, ?, ?, ?, ?)',
    );
    stmt.run(
      input.id,
      input.name,
      input.description || null,
      input.color || null,
      input.workspace || null,
    );
    logActivity(
      'user',
      'project.created',
      'project',
      input.id,
      JSON.stringify({
        after: {
          name: input.name,
          color: input.color,
          workspace: input.workspace,
        },
      }),
    );
  });
  tx();

  const project = getProject(input.id);
  if (!project)
    throw new Error('Failed to create project: row not found after insert');
  return project;
}

export function getProject(id: string): Project | null {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM projects WHERE id = ?');
  const result = stmt.get(id) as Project | undefined;
  return result || null;
}

export function getAllProjects(status?: string): Project[] {
  const db = getDatabase();
  if (status) {
    const stmt = db.prepare(
      'SELECT * FROM projects WHERE status = ? ORDER BY created_at DESC',
    );
    return stmt.all(status) as Project[];
  }
  const stmt = db.prepare('SELECT * FROM projects ORDER BY created_at DESC');
  return stmt.all() as Project[];
}

export function updateProject(
  id: string,
  input: UpdateProjectInput,
): Project | null {
  const db = getDatabase();

  const updates: string[] = [];
  const values: (string | null)[] = [];

  if (input.name !== undefined) {
    updates.push('name = ?');
    values.push(input.name);
  }
  if (input.description !== undefined) {
    updates.push('description = ?');
    values.push(input.description);
  }
  if (input.color !== undefined) {
    updates.push('color = ?');
    values.push(input.color);
  }
  if (input.workspace !== undefined) {
    updates.push('workspace = ?');
    values.push(input.workspace);
  }
  if (input.status !== undefined) {
    updates.push('status = ?');
    values.push(input.status);
  }

  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')");
    values.push(id);
    const stmt = db.prepare(
      `UPDATE projects SET ${updates.join(', ')} WHERE id = ?`,
    );
    stmt.run(...values);
  }

  return getProject(id);
}

export function getProjectsWithRecentTasks(
  maxTasksPerProject: number = 5,
): (Project & { tasks: Task[]; task_count: number })[] {
  const db = getDatabase();

  const projects = db
    .prepare(
      "SELECT * FROM projects WHERE status = 'active' ORDER BY updated_at DESC",
    )
    .all() as Project[];

  return projects.map((project) => {
    const tasks = db
      .prepare(
        'SELECT * FROM tasks WHERE project_id = ? ORDER BY updated_at DESC LIMIT ?',
      )
      .all(project.id, maxTasksPerProject) as Task[];

    const countResult = db
      .prepare('SELECT COUNT(*) as count FROM tasks WHERE project_id = ?')
      .get(project.id) as { count: number };

    return {
      ...project,
      tasks: tasks.map((t) => ({ ...t, favorite: Boolean(t.favorite) })),
      task_count: countResult.count,
    };
  });
}

export function archiveProject(id: string): Project | null {
  const result = updateProject(id, { status: 'archived' });
  if (result) {
    logActivity(
      'user',
      'project.archived',
      'project',
      id,
      JSON.stringify({
        before: { status: 'active' },
        after: { status: 'archived' },
      }),
    );
  }
  return result;
}

export function getProjectWithTaskSummary(
  id: string,
): (Project & { task_counts: Record<string, number> }) | null {
  const db = getDatabase();
  const project = getProject(id);
  if (!project) return null;

  const counts = db
    .prepare(
      'SELECT status, COUNT(*) as count FROM tasks WHERE project_id = ? GROUP BY status',
    )
    .all(id) as { status: string; count: number }[];

  const task_counts: Record<string, number> = {};
  for (const row of counts) {
    task_counts[row.status] = row.count;
  }

  return { ...project, task_counts };
}

// ============ Goal Operations ============

export function createGoal(input: CreateGoalInput): Goal {
  const db = getDatabase();
  const tx = db.transaction(() => {
    const stmt = db.prepare(
      'INSERT INTO goals (id, title, description, project_id) VALUES (?, ?, ?, ?)',
    );
    stmt.run(
      input.id,
      input.title,
      input.description || null,
      input.project_id || null,
    );
    logActivity(
      'user',
      'goal.created',
      'goal',
      input.id,
      undefined,
      input.project_id,
    );
  });
  tx();

  const goal = getGoal(input.id);
  if (!goal)
    throw new Error('Failed to create goal: row not found after insert');
  return goal;
}

export function getGoal(id: string): Goal | null {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM goals WHERE id = ?');
  const result = stmt.get(id) as Goal | undefined;
  return result || null;
}

export function getAllGoals(projectId?: string): Goal[] {
  const db = getDatabase();
  if (projectId) {
    const stmt = db.prepare(
      'SELECT * FROM goals WHERE project_id = ? ORDER BY created_at DESC',
    );
    return stmt.all(projectId) as Goal[];
  }
  const stmt = db.prepare('SELECT * FROM goals ORDER BY created_at DESC');
  return stmt.all() as Goal[];
}

export function updateGoal(id: string, input: UpdateGoalInput): Goal | null {
  const db = getDatabase();

  const updates: string[] = [];
  const values: (string | null)[] = [];

  if (input.title !== undefined) {
    updates.push('title = ?');
    values.push(input.title);
  }
  if (input.description !== undefined) {
    updates.push('description = ?');
    values.push(input.description);
  }
  if (input.status !== undefined) {
    updates.push('status = ?');
    values.push(input.status);
  }
  if (input.project_id !== undefined) {
    updates.push('project_id = ?');
    values.push(input.project_id);
  }

  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')");
    values.push(id);
    const stmt = db.prepare(
      `UPDATE goals SET ${updates.join(', ')} WHERE id = ?`,
    );
    stmt.run(...values);
  }

  return getGoal(id);
}

// ============ Task Hierarchy Operations ============

export function getChildTasks(parentTaskId: string): Task[] {
  const db = getDatabase();
  const stmt = db.prepare(
    'SELECT * FROM tasks WHERE parent_task_id = ? ORDER BY created_at ASC',
  );
  const tasks = stmt.all(parentTaskId) as Task[];
  return tasks.map((task) => ({ ...task, favorite: Boolean(task.favorite) }));
}

export function getTaskLinks(taskId: string): TaskLink[] {
  const db = getDatabase();
  const stmt = db.prepare(
    'SELECT * FROM task_links WHERE from_task_id = ? OR to_task_id = ? ORDER BY created_at ASC',
  );
  return stmt.all(taskId, taskId) as TaskLink[];
}

export function createTaskLink(input: CreateTaskLinkInput): TaskLink {
  const db = getDatabase();
  const stmt = db.prepare(
    'INSERT INTO task_links (id, from_task_id, to_task_id, link_type) VALUES (?, ?, ?, ?)',
  );
  stmt.run(input.id, input.from_task_id, input.to_task_id, input.link_type);

  const link = db
    .prepare('SELECT * FROM task_links WHERE id = ?')
    .get(input.id) as TaskLink | undefined;
  if (!link)
    throw new Error('Failed to create task link: row not found after insert');
  return link;
}

export function deleteTaskLink(id: string): boolean {
  const db = getDatabase();
  const stmt = db.prepare('DELETE FROM task_links WHERE id = ?');
  return stmt.run(id).changes > 0;
}

// ============ Task Comment Operations ============

export function getTaskComments(taskId: string): TaskComment[] {
  const db = getDatabase();
  const stmt = db.prepare(
    'SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC',
  );
  return stmt.all(taskId) as TaskComment[];
}

export function createTaskComment(input: CreateTaskCommentInput): TaskComment {
  const db = getDatabase();
  const tx = db.transaction(() => {
    const stmt = db.prepare(
      'INSERT INTO task_comments (id, task_id, author_type, author_id, content) VALUES (?, ?, ?, ?, ?)',
    );
    stmt.run(
      input.id,
      input.task_id,
      input.author_type,
      input.author_id || null,
      input.content,
    );
    logActivity(
      input.author_type as ActorType,
      'task.comment_added',
      'task',
      input.task_id,
    );
  });
  tx();

  const comment = db
    .prepare('SELECT * FROM task_comments WHERE id = ?')
    .get(input.id) as TaskComment | undefined;
  if (!comment)
    throw new Error(
      'Failed to create task comment: row not found after insert',
    );
  return comment;
}

export function deleteTaskComment(id: string): boolean {
  const db = getDatabase();
  const stmt = db.prepare('DELETE FROM task_comments WHERE id = ?');
  return stmt.run(id).changes > 0;
}

// ============ Activity Event Operations ============

export function createActivityEvent(
  input: CreateActivityEventInput,
): ActivityEvent {
  const db = getDatabase();
  const stmt = db.prepare(
    'INSERT INTO activity_events (id, actor_type, actor_id, event_type, entity_type, entity_id, project_id, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  stmt.run(
    input.id,
    input.actor_type,
    input.actor_id || null,
    input.event_type,
    input.entity_type,
    input.entity_id || null,
    input.project_id || null,
    input.metadata || null,
  );

  const event = getActivityEvent(input.id);
  if (!event)
    throw new Error(
      'Failed to create activity event: row not found after insert',
    );
  return event;
}

export function getActivityEvent(id: string): ActivityEvent | null {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM activity_events WHERE id = ?');
  const result = stmt.get(id) as ActivityEvent | undefined;
  return result || null;
}

export function getActivityEvents(options: {
  limit?: number;
  offset?: number;
  entity_type?: string;
  entity_id?: string;
  project_id?: string;
  actor_type?: string;
  from?: string;
  to?: string;
}): ActivityEvent[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const values: (string | number)[] = [];

  if (options.entity_type) {
    conditions.push('entity_type = ?');
    values.push(options.entity_type);
  }
  if (options.entity_id) {
    conditions.push('entity_id = ?');
    values.push(options.entity_id);
  }
  if (options.project_id) {
    conditions.push('project_id = ?');
    values.push(options.project_id);
  }
  if (options.actor_type) {
    conditions.push('actor_type = ?');
    values.push(options.actor_type);
  }
  if (options.from) {
    conditions.push('created_at >= ?');
    values.push(options.from);
  }
  if (options.to) {
    conditions.push('created_at <= ?');
    values.push(options.to);
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options.limit || 50;
  const offset = options.offset || 0;

  const stmt = db.prepare(
    `SELECT * FROM activity_events ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  );
  values.push(limit, offset);
  return stmt.all(...values) as ActivityEvent[];
}

/** Convenience wrapper for logging activity events */
export function logActivity(
  actor_type: ActorType,
  event_type: string,
  entity_type: EntityType,
  entity_id?: string,
  metadata?: string,
  project_id?: string,
): void {
  createActivityEvent({
    id: crypto.randomUUID(),
    actor_type,
    event_type,
    entity_type,
    entity_id,
    metadata,
    project_id,
  });
}

// ============ Dashboard Aggregation Operations ============

export function getDashboardStats(): {
  tasks: Record<string, number>;
  activeProjects: number;
  totalCost: number;
} {
  const db = getDatabase();

  const taskCounts = db
    .prepare('SELECT status, COUNT(*) as count FROM tasks GROUP BY status')
    .all() as { status: string; count: number }[];

  const tasks: Record<string, number> = {};
  for (const row of taskCounts) {
    tasks[row.status] = row.count;
  }

  const projectCount = db
    .prepare("SELECT COUNT(*) as count FROM projects WHERE status = 'active'")
    .get() as { count: number };

  const costResult = db
    .prepare(
      "SELECT COALESCE(SUM(total_cost), 0) / 1000000.0 as total FROM usage_logs WHERE billing_type = 'api'",
    )
    .get() as { total: number };

  return {
    tasks,
    activeProjects: projectCount.count,
    totalCost: costResult.total,
  };
}

export function getTaskFlowData(
  days: number = 7,
): { date: string; created: number; completed: number; failed: number }[] {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT
      DATE(created_at) as date,
      SUM(CASE WHEN event_type = 'task.created' THEN 1 ELSE 0 END) as created,
      SUM(CASE WHEN event_type = 'task.status_changed' AND metadata LIKE '%"completed"%' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN event_type = 'task.status_changed' AND metadata LIKE '%"error"%' THEN 1 ELSE 0 END) as failed
    FROM activity_events
    WHERE entity_type = 'task'
      AND created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `);
  return stmt.all(days) as {
    date: string;
    created: number;
    completed: number;
    failed: number;
  }[];
}

export function getCostSummary(days: number = 30): {
  provider: string;
  model: string;
  billing_type: string;
  api_cost: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}[] {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT
      COALESCE(provider, 'unknown') as provider,
      COALESCE(model, 'unknown') as model,
      billing_type,
      SUM(CASE WHEN billing_type = 'api' THEN total_cost ELSE 0 END) / 1000000.0 as api_cost,
      SUM(input_tokens) as input_tokens,
      SUM(output_tokens) as output_tokens,
      SUM(input_tokens + output_tokens) as total_tokens
    FROM usage_logs
    WHERE created_at >= datetime('now', '-' || ? || ' days')
    GROUP BY provider, model, billing_type
    ORDER BY total_tokens DESC
  `);
  return stmt.all(days) as {
    provider: string;
    model: string;
    billing_type: string;
    api_cost: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  }[];
}

export function getTaskUsageSummary(taskId: string): {
  total_input: number;
  total_output: number;
  model: string | null;
  cost: number;
} {
  const db = getDatabase();
  const result = db
    .prepare(
      `SELECT
        COALESCE(SUM(usage_input), 0) as total_input,
        COALESCE(SUM(usage_output), 0) as total_output,
        MAX(model) as model,
        COALESCE(SUM(cost), 0) as cost
      FROM messages WHERE task_id = ?`,
    )
    .get(taskId) as {
    total_input: number;
    total_output: number;
    model: string | null;
    cost: number;
  };
  return result;
}

// ============ Agent Profile Operations ============

export function createAgentProfile(
  input: CreateAgentProfileInput,
): AgentProfile {
  const db = getDatabase();
  const tx = db.transaction(() => {
    const stmt = db.prepare(
      `INSERT INTO agent_profiles (id, name, runtime_id, role, description, avatar_color, avatar_icon,
        default_model, default_provider, default_mcp_servers, default_skills, system_prompt,
        soul, soul_origin,
        max_concurrent_tasks, max_delegation_depth, allowed_delegates,
        session_compaction_policy, max_session_messages, default_thinking_config, routing_hints)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    stmt.run(
      input.id,
      input.name,
      input.runtime_id || 'claude',
      input.role || null,
      input.description || null,
      input.avatar_color || null,
      input.avatar_icon || null,
      input.default_model || null,
      input.default_provider || null,
      input.default_mcp_servers || null,
      input.default_skills || null,
      input.system_prompt || null,
      input.soul || null,
      input.soul_origin || 'user',
      input.max_concurrent_tasks ?? 1,
      input.max_delegation_depth ?? 3,
      input.allowed_delegates || null,
      input.session_compaction_policy ?? 'auto',
      input.max_session_messages ?? 100,
      input.default_thinking_config || null,
      input.routing_hints ?? '{}',
    );
    logActivity(
      'user',
      'profile.created',
      'profile',
      input.id,
      JSON.stringify({ name: input.name }),
    );
  });
  tx();

  const profile = getAgentProfile(input.id);
  if (!profile) throw new Error('Failed to create agent profile');
  return profile;
}

export function getAgentProfile(id: string): AgentProfile | null {
  const db = getDatabase();
  return (
    (db.prepare('SELECT * FROM agent_profiles WHERE id = ?').get(id) as
      | AgentProfile
      | undefined) ?? null
  );
}

/**
 * Parse the default_skills JSON for a profile into a string array.
 * Returns undefined when the profile doesn't exist or has no skills configured (null column).
 * Returns an empty array when the profile explicitly restricts all skills (`"[]"`).
 */
export function getProfileSkillSlugs(profileId: string): string[] | undefined {
  const profile = getAgentProfile(profileId);
  if (!profile?.default_skills) return undefined;
  try {
    const parsed = JSON.parse(profile.default_skills);
    if (Array.isArray(parsed))
      return parsed.filter((s): s is string => typeof s === 'string');
    return undefined;
  } catch {
    return undefined;
  }
}

export function getAllAgentProfiles(status?: ProfileStatus): AgentProfile[] {
  const db = getDatabase();
  if (status) {
    return db
      .prepare(
        'SELECT * FROM agent_profiles WHERE status = ? ORDER BY created_at DESC',
      )
      .all(status) as AgentProfile[];
  }
  return db
    .prepare('SELECT * FROM agent_profiles ORDER BY created_at DESC')
    .all() as AgentProfile[];
}

export function updateAgentProfile(
  id: string,
  updates: UpdateAgentProfileInput,
): AgentProfile {
  const db = getDatabase();
  const fields: string[] = [];
  const values: unknown[] = [];

  const fieldMap: Record<string, unknown> = {
    name: updates.name,
    role: updates.role,
    description: updates.description,
    avatar_color: updates.avatar_color,
    avatar_icon: updates.avatar_icon,
    runtime_id: updates.runtime_id,
    default_model: updates.default_model,
    default_provider: updates.default_provider,
    default_mcp_servers: updates.default_mcp_servers,
    default_skills: updates.default_skills,
    system_prompt: updates.system_prompt,
    soul: updates.soul,
    soul_version: updates.soul_version,
    soul_origin: updates.soul_origin,
    corrections_log: updates.corrections_log,
    learnings: updates.learnings,
    max_concurrent_tasks: updates.max_concurrent_tasks,
    max_delegation_depth: updates.max_delegation_depth,
    allowed_delegates: updates.allowed_delegates,
    session_compaction_policy: updates.session_compaction_policy,
    max_session_messages: updates.max_session_messages,
    default_thinking_config: updates.default_thinking_config,
    routing_hints: updates.routing_hints,
    status: updates.status,
  };

  for (const [key, value] of Object.entries(fieldMap)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (fields.length === 0) {
    const profile = getAgentProfile(id);
    if (!profile) throw new Error(`Agent profile not found: ${id}`);
    return profile;
  }

  fields.push("updated_at = datetime('now')");
  values.push(id);

  db.prepare(`UPDATE agent_profiles SET ${fields.join(', ')} WHERE id = ?`).run(
    ...values,
  );
  logActivity(
    'user',
    'profile.updated',
    'profile',
    id,
    JSON.stringify({
      fields: Object.keys(fieldMap).filter((k) => fieldMap[k] !== undefined),
    }),
  );

  const profile = getAgentProfile(id);
  if (!profile) throw new Error(`Agent profile not found: ${id}`);
  return profile;
}

export function deleteAgentProfile(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM agent_profiles WHERE id = ?').run(id);
  logActivity('user', 'profile.deleted', 'profile', id);
}

export function assignTaskToProfile(
  taskId: string,
  profileId: string,
): boolean {
  const db = getDatabase();
  const result = db
    .prepare(
      `UPDATE tasks SET queue_status = 'picked_up', assignee_profile_id = ?
       WHERE id = ? AND queue_status = 'queued'
         AND (assignee_profile_id IS NULL OR assignee_profile_id = ?)`,
    )
    .run(profileId, taskId, profileId);
  if (result.changes > 0) {
    logActivity(
      'system',
      'task.assigned',
      'task',
      taskId,
      JSON.stringify({ profileId }),
    );
  }
  return result.changes > 0;
}

export function getTasksByProfile(profileId: string): Task[] {
  const db = getDatabase();
  return db
    .prepare(
      'SELECT * FROM tasks WHERE assignee_profile_id = ? ORDER BY created_at DESC',
    )
    .all(profileId) as Task[];
}

export function getTaskCountsForProfiles(
  profileIds: string[],
): Record<string, number> {
  if (profileIds.length === 0) return {};
  const db = getDatabase();
  const placeholders = profileIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT assignee_profile_id, COUNT(*) as count FROM tasks
       WHERE assignee_profile_id IN (${placeholders})
       GROUP BY assignee_profile_id`,
    )
    .all(...profileIds) as { assignee_profile_id: string; count: number }[];
  return Object.fromEntries(rows.map((r) => [r.assignee_profile_id, r.count]));
}

// ============ Soul Operations ============

export function getAgentSoul(profileId: string): AgentSoul | null {
  const profile = getAgentProfile(profileId);
  if (!profile?.soul) return null;
  try {
    return JSON.parse(profile.soul) as AgentSoul;
  } catch {
    return null;
  }
}

export function updateAgentProfileSoul(
  id: string,
  soul: AgentSoul,
  origin?: SoulOrigin,
): AgentProfile {
  const db = getDatabase();
  const existing = getAgentProfile(id);
  if (!existing) throw new Error(`Agent profile not found: ${id}`);

  const newVersion = (existing.soul_version ?? 0) + 1;
  db.prepare(
    `UPDATE agent_profiles
     SET soul = ?, soul_version = ?, soul_origin = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(JSON.stringify(soul), newVersion, origin ?? 'user', id);

  logActivity(
    'user',
    'profile.soul_updated',
    'profile',
    id,
    JSON.stringify({ version: newVersion }),
  );

  const profile = getAgentProfile(id);
  if (!profile) throw new Error(`Agent profile not found: ${id}`);
  return profile;
}

export function getSoulCorrections(profileId: string): Correction[] {
  const profile = getAgentProfile(profileId);
  if (!profile?.corrections_log) return [];
  try {
    return JSON.parse(profile.corrections_log) as Correction[];
  } catch {
    return [];
  }
}

export function appendCorrection(
  profileId: string,
  correction: Correction,
): void {
  const db = getDatabase();
  const profile = getAgentProfile(profileId);
  if (!profile) return;

  const corrections: Correction[] = profile.corrections_log
    ? JSON.parse(profile.corrections_log)
    : [];

  // Dedup by what_went_wrong
  if (corrections.some((c) => c.what_went_wrong === correction.what_went_wrong))
    return;

  corrections.push(correction);

  // Get max from soul evolution config
  const soul: AgentSoul | null = profile.soul ? JSON.parse(profile.soul) : null;
  const maxCorrections = soul?.evolution?.max_corrections ?? 50;

  // FIFO eviction
  while (corrections.length > maxCorrections) {
    corrections.shift();
  }

  db.prepare(
    `UPDATE agent_profiles SET corrections_log = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(JSON.stringify(corrections), profileId);
}

export function getSoulLearnings(profileId: string): Learning[] {
  const profile = getAgentProfile(profileId);
  if (!profile?.learnings) return [];
  try {
    return JSON.parse(profile.learnings) as Learning[];
  } catch {
    return [];
  }
}

export function appendLearning(profileId: string, learning: Learning): void {
  const db = getDatabase();
  const profile = getAgentProfile(profileId);
  if (!profile) return;

  const learnings: Learning[] = profile.learnings
    ? JSON.parse(profile.learnings)
    : [];

  // Dedup by content
  if (learnings.some((l) => l.content === learning.content)) return;

  learnings.push(learning);

  const soul: AgentSoul | null = profile.soul ? JSON.parse(profile.soul) : null;
  const maxLearnings = soul?.evolution?.max_learnings ?? 50;

  // Evict least-applied when at capacity
  while (learnings.length > maxLearnings) {
    let minIdx = 0;
    for (let i = 1; i < learnings.length; i++) {
      if (
        (learnings[i]?.times_applied ?? 0) <
        (learnings[minIdx]?.times_applied ?? 0)
      ) {
        minIdx = i;
      }
    }
    learnings.splice(minIdx, 1);
  }

  db.prepare(
    `UPDATE agent_profiles SET learnings = ?, updated_at = datetime('now') WHERE id = ?`,
  ).run(JSON.stringify(learnings), profileId);
}

export function clearSoulCorrections(profileId: string): void {
  const db = getDatabase();
  db.prepare(
    `UPDATE agent_profiles SET corrections_log = NULL, updated_at = datetime('now') WHERE id = ?`,
  ).run(profileId);
}

// ============ Queue Operations ============

export function getQueuedTasks(profileId: string, limit = 10): Task[] {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT * FROM tasks
       WHERE assignee_profile_id = ? AND queue_status = 'queued'
       ORDER BY queue_priority DESC, created_at ASC
       LIMIT ?`,
    )
    .all(profileId, limit) as Task[];
}

export function pickupQueuedTask(taskId: string, profileId: string): boolean {
  const db = getDatabase();
  const result = db
    .prepare(
      `UPDATE tasks SET queue_status = 'picked_up'
       WHERE id = ? AND queue_status = 'queued'
         AND assignee_profile_id = ?`,
    )
    .run(taskId, profileId);
  if (result.changes > 0) {
    logActivity(
      'system',
      'task.picked_up',
      'task',
      taskId,
      JSON.stringify({ profileId }),
    );
  }
  return result.changes > 0;
}

export function completeQueuedTask(taskId: string, success: boolean): boolean {
  const db = getDatabase();
  const newStatus = success ? 'completed' : 'error';
  const result = db
    .prepare(
      `UPDATE tasks SET queue_status = 'done', status = ?
       WHERE id = ?`,
    )
    .run(newStatus, taskId);
  if (result.changes > 0) {
    logActivity(
      'system',
      'task.queue_completed',
      'task',
      taskId,
      JSON.stringify({ success }),
    );
  }
  return result.changes > 0;
}

export function enqueueTask(
  taskId: string,
  profileId: string,
  priority = 0,
): boolean {
  const db = getDatabase();
  const result = db
    .prepare(
      `UPDATE tasks SET queue_status = 'queued', assignee_profile_id = ?, queue_priority = ?
       WHERE id = ?`,
    )
    .run(profileId, priority, taskId);
  if (result.changes > 0) {
    logActivity(
      'system',
      'task.enqueued',
      'task',
      taskId,
      JSON.stringify({ profileId, priority }),
    );
  }
  return result.changes > 0;
}

export function getQueueStats(profileId?: string): {
  queued: number;
  pickedUp: number;
  done: number;
} {
  const db = getDatabase();
  const rows = profileId
    ? (db
        .prepare(
          `SELECT queue_status, COUNT(*) as count FROM tasks
           WHERE assignee_profile_id = ?
           GROUP BY queue_status`,
        )
        .all(profileId) as { queue_status: string; count: number }[])
    : (db
        .prepare(
          `SELECT queue_status, COUNT(*) as count FROM tasks
           GROUP BY queue_status`,
        )
        .all() as { queue_status: string; count: number }[]);

  const stats = { queued: 0, pickedUp: 0, done: 0 };
  for (const row of rows) {
    if (row.queue_status === 'queued') stats.queued = row.count;
    else if (row.queue_status === 'picked_up') stats.pickedUp = row.count;
    else if (row.queue_status === 'done') stats.done = row.count;
  }
  return stats;
}

// ============ User Template Operations ============

export function createUserTemplate(
  input: CreateUserTemplateInput,
): UserTemplate {
  const db = getDatabase();
  db.prepare(
    `INSERT INTO user_templates (id, name, description, category, system_prompt,
      suggested_model, skills, mcp_servers, starter_prompts, icon, is_built_in)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.name,
    input.description || null,
    input.category,
    input.system_prompt,
    input.suggested_model || null,
    input.skills || null,
    input.mcp_servers || null,
    input.starter_prompts,
    input.icon || null,
    input.is_built_in ?? 0,
  );

  const template = getUserTemplate(input.id);
  if (!template) throw new Error('Failed to create user template');
  return template;
}

export function getUserTemplate(id: string): UserTemplate | null {
  const db = getDatabase();
  return (
    (db.prepare('SELECT * FROM user_templates WHERE id = ?').get(id) as
      | UserTemplate
      | undefined) ?? null
  );
}

export function getAllUserTemplates(category?: string): UserTemplate[] {
  const db = getDatabase();
  if (category) {
    return db
      .prepare(
        'SELECT * FROM user_templates WHERE category = ? ORDER BY is_built_in DESC, name',
      )
      .all(category) as UserTemplate[];
  }
  return db
    .prepare('SELECT * FROM user_templates ORDER BY is_built_in DESC, name')
    .all() as UserTemplate[];
}

export function updateUserTemplate(
  id: string,
  updates: UpdateUserTemplateInput,
): UserTemplate {
  const db = getDatabase();
  const fields: string[] = [];
  const values: unknown[] = [];

  const fieldMap: Record<string, unknown> = {
    name: updates.name,
    description: updates.description,
    category: updates.category,
    system_prompt: updates.system_prompt,
    suggested_model: updates.suggested_model,
    skills: updates.skills,
    mcp_servers: updates.mcp_servers,
    starter_prompts: updates.starter_prompts,
    icon: updates.icon,
  };

  for (const [key, value] of Object.entries(fieldMap)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (fields.length === 0) {
    const template = getUserTemplate(id);
    if (!template) throw new Error(`Template not found: ${id}`);
    return template;
  }

  fields.push("updated_at = datetime('now')");
  values.push(id);

  db.prepare(`UPDATE user_templates SET ${fields.join(', ')} WHERE id = ?`).run(
    ...values,
  );

  const template = getUserTemplate(id);
  if (!template) throw new Error(`Template not found: ${id}`);
  return template;
}

export function deleteUserTemplate(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM user_templates WHERE id = ?').run(id);
}

// ============ Budget Policy Operations ============

export function createBudgetPolicy(
  input: CreateBudgetPolicyInput,
): BudgetPolicy {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO budget_policies
      (id, name, scope_type, scope_id, period_type, limit_usd,
       alert_threshold_pct, hard_stop, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    input.id,
    input.name ?? null,
    input.scope_type,
    input.scope_id ?? null,
    input.period_type ?? 'monthly',
    input.limit_usd,
    input.alert_threshold_pct ?? 75,
    input.hard_stop ? 1 : 0,
  );
  return getBudgetPolicy(input.id)!;
}

/** Raw SQLite row for budget_policies (booleans stored as 0/1) */
interface BudgetPolicyRow {
  id: string;
  name: string | null;
  scope_type: string;
  scope_id: string | null;
  period_type: string;
  limit_usd: number;
  alert_threshold_pct: number;
  hard_stop: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

function rowToPolicy(row: BudgetPolicyRow): BudgetPolicy {
  return {
    id: row.id,
    name: row.name,
    scope_type: row.scope_type as BudgetPolicy['scope_type'],
    scope_id: row.scope_id,
    period_type: row.period_type as BudgetPolicy['period_type'],
    limit_usd: row.limit_usd,
    alert_threshold_pct: row.alert_threshold_pct,
    hard_stop: row.hard_stop === 1,
    enabled: row.enabled === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function getBudgetPolicy(id: string): BudgetPolicy | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM budget_policies WHERE id = ?')
    .get(id) as BudgetPolicyRow | undefined;
  if (!row) return null;
  return rowToPolicy(row);
}

export function getAllBudgetPolicies(): BudgetPolicy[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM budget_policies ORDER BY created_at DESC')
    .all() as BudgetPolicyRow[];
  return rows.map(rowToPolicy);
}

export function getEnabledBudgetPolicies(): BudgetPolicy[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      'SELECT * FROM budget_policies WHERE enabled = 1 ORDER BY created_at DESC',
    )
    .all() as BudgetPolicyRow[];
  return rows.map(rowToPolicy);
}

export function updateBudgetPolicy(
  id: string,
  updates: UpdateBudgetPolicyInput,
): BudgetPolicy {
  const db = getDatabase();
  const fields: string[] = [];
  const values: unknown[] = [];

  const fieldMap: Record<string, unknown> = {
    name: updates.name,
    scope_type: updates.scope_type,
    scope_id: updates.scope_id,
    period_type: updates.period_type,
    limit_usd: updates.limit_usd,
    alert_threshold_pct: updates.alert_threshold_pct,
  };

  for (const [key, value] of Object.entries(fieldMap)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (updates.hard_stop !== undefined) {
    fields.push('hard_stop = ?');
    values.push(updates.hard_stop ? 1 : 0);
  }
  if (updates.enabled !== undefined) {
    fields.push('enabled = ?');
    values.push(updates.enabled ? 1 : 0);
  }

  if (fields.length === 0) {
    return getBudgetPolicy(id)!;
  }

  fields.push("updated_at = datetime('now')");
  values.push(id);

  db.prepare(
    `UPDATE budget_policies SET ${fields.join(', ')} WHERE id = ?`,
  ).run(...values);
  return getBudgetPolicy(id)!;
}

export function deleteBudgetPolicy(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM budget_policies WHERE id = ?').run(id);
}

export function upsertBudgetSpendCache(
  policyId: string,
  periodStart: string,
  spendUsd: number,
): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO budget_spend_cache (policy_id, period_start, spend_usd)
    VALUES (?, ?, ?)
    ON CONFLICT(policy_id, period_start) DO UPDATE SET
      spend_usd = excluded.spend_usd,
      last_updated_at = datetime('now')
  `).run(policyId, periodStart, spendUsd);
}

export function getBudgetSpendCache(
  policyId: string,
  periodStart: string,
): BudgetSpendCache | null {
  const db = getDatabase();
  return (
    (db
      .prepare(
        'SELECT * FROM budget_spend_cache WHERE policy_id = ? AND period_start = ?',
      )
      .get(policyId, periodStart) as BudgetSpendCache | undefined) ?? null
  );
}

export function invalidateBudgetSpendCache(policyId?: string): void {
  const db = getDatabase();
  if (policyId) {
    db.prepare('DELETE FROM budget_spend_cache WHERE policy_id = ?').run(
      policyId,
    );
  } else {
    db.prepare('DELETE FROM budget_spend_cache').run();
  }
}

// ============ File Snapshot Operations ============

export function createFileSnapshot(
  input: CreateFileSnapshotInput,
): FileSnapshot {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO file_snapshots (id, task_id, file_path, content_before, content_after)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.task_id,
    input.file_path,
    input.content_before ?? null,
    input.content_after ?? null,
  );
  return getFileSnapshot(input.id)!;
}

export function getFileSnapshot(id: string): FileSnapshot | null {
  const db = getDatabase();
  return (
    (db.prepare('SELECT * FROM file_snapshots WHERE id = ?').get(id) as
      | FileSnapshot
      | undefined) ?? null
  );
}

export function getFileSnapshotsByTask(taskId: string): FileSnapshot[] {
  const db = getDatabase();
  return db
    .prepare(
      'SELECT * FROM file_snapshots WHERE task_id = ? ORDER BY created_at ASC',
    )
    .all(taskId) as FileSnapshot[];
}

export function updateFileSnapshotAfter(
  id: string,
  contentAfter: string,
): void {
  const db = getDatabase();
  db.prepare('UPDATE file_snapshots SET content_after = ? WHERE id = ?').run(
    contentAfter,
    id,
  );
}

export function countFileSnapshotsByTask(taskId: string): number {
  const db = getDatabase();
  const row = db
    .prepare('SELECT COUNT(*) as cnt FROM file_snapshots WHERE task_id = ?')
    .get(taskId) as { cnt: number };
  return row.cnt;
}

// ============ Task Document Operations ============

export function getDocument(
  taskId: string,
  docKey: string,
): TaskDocument | null {
  const db = getDatabase();
  return (
    (db
      .prepare('SELECT * FROM task_documents WHERE task_id = ? AND doc_key = ?')
      .get(taskId, docKey) as TaskDocument | undefined) ?? null
  );
}

export function getDocumentById(id: string): TaskDocument | null {
  const db = getDatabase();
  return (
    (db.prepare('SELECT * FROM task_documents WHERE id = ?').get(id) as
      | TaskDocument
      | undefined) ?? null
  );
}

export function getDocumentKeys(taskId: string): string[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      'SELECT DISTINCT doc_key FROM task_documents WHERE task_id = ? ORDER BY created_at',
    )
    .all(taskId) as { doc_key: string }[];
  return rows.map((r) => r.doc_key);
}

export function createOrUpdateDocument(
  input: CreateTaskDocumentInput,
): TaskDocument {
  const db = getDatabase();
  const now = new Date().toISOString();
  const existing = getDocument(input.task_id, input.doc_key);

  if (existing) {
    // UPDATE — the BEFORE UPDATE trigger will archive the old version
    db.prepare(`
      UPDATE task_documents
      SET title = ?, content = ?, version = version + 1,
          created_by = ?, updated_at = ?
      WHERE task_id = ? AND doc_key = ?
    `).run(
      input.title ?? existing.title,
      input.content,
      input.created_by ?? 'user',
      now,
      input.task_id,
      input.doc_key,
    );
    return getDocument(input.task_id, input.doc_key)!;
  } else {
    // INSERT
    const id = input.id ?? crypto.randomUUID();
    db.prepare(`
      INSERT INTO task_documents
        (id, task_id, doc_key, title, content, version, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(
      id,
      input.task_id,
      input.doc_key,
      input.title ?? null,
      input.content,
      input.created_by ?? 'user',
      now,
      now,
    );
    return getDocumentById(id)!;
  }
}

export function getDocumentHistory(
  taskId: string,
  docKey: string,
): TaskDocumentHistoryEntry[] {
  const db = getDatabase();
  const doc = getDocument(taskId, docKey);
  if (!doc) return [];
  return db
    .prepare(`
      SELECT * FROM task_document_history
      WHERE document_id = ?
      ORDER BY version DESC
    `)
    .all(doc.id) as TaskDocumentHistoryEntry[];
}

export function getDocumentVersion(
  historyId: string,
): TaskDocumentHistoryEntry | null {
  const db = getDatabase();
  return (
    (db
      .prepare('SELECT * FROM task_document_history WHERE history_id = ?')
      .get(historyId) as TaskDocumentHistoryEntry | undefined) ?? null
  );
}

// ============ Approval Operations ============

export function createApproval(input: CreateApprovalInput): Approval {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO approvals
      (id, approval_type, status, requested_by_type, requested_by_id, entity_type, entity_id,
       title, description, payload, expires_at, orchestration_run_id,
       risk_level, resume_token_hash)
    VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.approval_type,
    input.requested_by_type,
    input.requested_by_id ?? null,
    input.entity_type,
    input.entity_id,
    input.title,
    input.description ?? null,
    input.payload ?? null,
    input.expires_at ?? null,
    input.orchestration_run_id ?? null,
    input.risk_level ?? 'medium',
    input.resume_token_hash ?? null,
  );
  return getApproval(input.id)!;
}

export function getApproval(id: string): Approval | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM approvals WHERE id = ?').get(id) as
    | Approval
    | undefined;
}

export function getApprovalsByStatus(
  status: ApprovalStatus,
  limit = 50,
): Approval[] {
  const db = getDatabase();
  return db
    .prepare(
      'SELECT * FROM approvals WHERE status = ? ORDER BY created_at DESC LIMIT ?',
    )
    .all(status, limit) as Approval[];
}

export function getApprovalsByEntity(
  entityType: string,
  entityId: string,
): Approval[] {
  const db = getDatabase();
  return db
    .prepare(
      'SELECT * FROM approvals WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC',
    )
    .all(entityType, entityId) as Approval[];
}

export function getPendingApprovalCount(): number {
  const db = getDatabase();
  const row = db
    .prepare("SELECT COUNT(*) as count FROM approvals WHERE status = 'pending'")
    .get() as { count: number };
  return row.count;
}

export function decideApproval(
  id: string,
  status: 'approved' | 'rejected',
  decidedBy: string,
  reason?: string,
): Approval | undefined {
  const db = getDatabase();
  db.prepare(`
    UPDATE approvals
    SET status = ?, decided_by = ?, decision_reason = ?, decided_at = datetime('now')
    WHERE id = ? AND status = 'pending'
  `).run(status, decidedBy, reason ?? null, id);
  return getApproval(id);
}

export function expireStaleApprovals(): number {
  const db = getDatabase();
  const result = db
    .prepare(`
    UPDATE approvals
    SET status = 'expired'
    WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < datetime('now')
  `)
    .run();
  return result.changes;
}

// ============ Agent Runs Operations (migration 006) ============

export interface AgentRunRow {
  id: string;
  task_id: string;
  parent_run_id: string | null;
  provider: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  started_at: string;
  finished_at: string | null;
  cost_usd: number;
  tokens_in: number;
  tokens_out: number;
  model: string | null;
  error: string | null;
  completeness: 'complete' | 'unfinished' | 'unknown';
  delivery: 'not_expected' | 'pending' | 'delivered' | 'blocked' | 'failed';
  retry: 'not_safe' | 'safe_once' | 'user_action';
  failure_cause: string | null;
  runtime_version: string | null;
  attempt: number;
  session_handle_kind: string | null;
  invalidation_reason: string | null;
  mode: RunMode;
  owner_key: string;
  project_id: string | null;
  conversation_id: string | null;
  client_request_id: string | null;
  request_message_id: string | null;
  execution_id: string;
  initial_run_id: string;
  source_run_id: string | null;
  run_index: number | null;
  recovery_action:
    | 'retry'
    | 'continue'
    | 'answer_question'
    | 'switch_runtime'
    | 'resume_after_restart'
    | null;
  delivery_reconciliation_deadline: string | null;
}

export interface ReserveAgentRunInput {
  runId: string;
  mode: AgentRunRow['mode'];
  ownerKey: string;
  projectId: string | null;
  conversationId: string | null;
  clientRequestId: string;
  requestMessageId: string;
  messageContent: string;
  provider: string;
  model?: string | null;
  runtimeVersion?: string | null;
  sessionHandleKind?: string | null;
  recovery?: {
    executionId: string;
    sourceRunId: string;
    action: NonNullable<AgentRunRow['recovery_action']>;
  };
}

export type ReserveAgentRunResult =
  | { disposition: 'created'; run: AgentRunRow }
  | { disposition: 'existing'; run: AgentRunRow };

export class AgentRunConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentRunConflictError';
  }
}

export interface AgentRunEventRow {
  run_id: string;
  seq: number;
  event_type: string;
  event_json: string;
  created_at: string;
}

export function getAgentRun(id: string): AgentRunRow | undefined {
  return getDatabase()
    .prepare('SELECT * FROM agent_runs WHERE id = ?')
    .get(id) as AgentRunRow | undefined;
}

export function appendAgentRunEvent(input: {
  runId: string;
  seq: number;
  eventType: string;
  event: unknown;
}): void {
  const db = getDatabase();
  const eventJson = JSON.stringify(input.event);
  const result = db
    .prepare(
      `INSERT INTO agent_run_events
         (run_id, seq, event_type, event_json, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(run_id, seq) DO NOTHING`,
    )
    .run(
      input.runId,
      input.seq,
      input.eventType,
      eventJson,
      new Date().toISOString(),
    );
  if (result.changes > 0) return;

  const existing = db
    .prepare(
      `SELECT event_type, event_json FROM agent_run_events
       WHERE run_id = ? AND seq = ?`,
    )
    .get(input.runId, input.seq) as
    | { event_type: string; event_json: string }
    | undefined;
  if (
    !existing ||
    existing.event_type !== input.eventType ||
    existing.event_json !== eventJson
  ) {
    throw new AgentRunConflictError(
      `Event sequence ${input.seq} conflicts with the durable journal`,
    );
  }
}

export function getAgentRunEventsAfter(
  runId: string,
  afterSeq: number,
): AgentRunEventRow[] {
  return getDatabase()
    .prepare(
      `SELECT * FROM agent_run_events
       WHERE run_id = ? AND seq >= 0 AND seq > ?
       ORDER BY seq ASC`,
    )
    .all(runId, afterSeq) as AgentRunEventRow[];
}

export function normalizeRunMessageContent(content: string): string {
  return content.replace(/\r\n?/g, '\n').trim();
}

function getRunByRequestIdentity(
  mode: AgentRunRow['mode'],
  ownerKey: string,
  clientRequestId: string,
): AgentRunRow | undefined {
  return getDatabase()
    .prepare(
      `SELECT * FROM agent_runs
       WHERE mode = ? AND owner_key = ? AND client_request_id = ?`,
    )
    .get(mode, ownerKey, clientRequestId) as AgentRunRow | undefined;
}

function getRunByMessageIdentity(
  mode: AgentRunRow['mode'],
  ownerKey: string,
  requestMessageId: string,
): AgentRunRow | undefined {
  return getDatabase()
    .prepare(
      `SELECT * FROM agent_runs
       WHERE mode = ? AND owner_key = ? AND request_message_id = ?`,
    )
    .get(mode, ownerKey, requestMessageId) as AgentRunRow | undefined;
}

function assertMatchingReservation(
  byRequest: AgentRunRow | undefined,
  byMessage: AgentRunRow | undefined,
  normalizedContent: string,
): AgentRunRow | undefined {
  if (!byRequest && !byMessage) return undefined;
  if (byRequest && byMessage && byRequest.id !== byMessage.id) {
    throw new AgentRunConflictError(
      'Request id and message id resolve to different runs',
    );
  }
  const run = byRequest ?? byMessage;
  if (!run) return undefined;
  const seed = getDatabase()
    .prepare(
      `SELECT event_json FROM agent_run_events
       WHERE run_id = ? AND seq = -1`,
    )
    .get(run.id) as { event_json: string } | undefined;
  if (!seed) {
    throw new AgentRunConflictError('Existing run has no request message seed');
  }
  const parsed = JSON.parse(seed.event_json) as { content?: unknown };
  if (parsed.content !== normalizedContent) {
    throw new AgentRunConflictError(
      'Message id was already used with different content',
    );
  }
  return run;
}

export function reserveAgentRun(
  input: ReserveAgentRunInput,
): ReserveAgentRunResult {
  const db = getDatabase();
  const normalizedContent = normalizeRunMessageContent(input.messageContent);
  return db.transaction(() => {
    const existing = assertMatchingReservation(
      getRunByRequestIdentity(
        input.mode,
        input.ownerKey,
        input.clientRequestId,
      ),
      getRunByMessageIdentity(
        input.mode,
        input.ownerKey,
        input.requestMessageId,
      ),
      normalizedContent,
    );
    if (existing) return { disposition: 'existing', run: existing } as const;

    let executionId = input.runId;
    let initialRunId = input.runId;
    let sourceRunId: string | null = null;
    let runIndex = 0;
    let recoveryAction: AgentRunRow['recovery_action'] = null;
    if (input.recovery) {
      const source = db
        .prepare('SELECT * FROM agent_runs WHERE id = ?')
        .get(input.recovery.sourceRunId) as AgentRunRow | undefined;
      if (
        !source ||
        source.parent_run_id !== null ||
        source.status === 'running' ||
        source.mode !== input.mode ||
        source.owner_key !== input.ownerKey ||
        source.execution_id !== input.recovery.executionId
      ) {
        throw new AgentRunConflictError(
          'Recovery source is not a terminal root run for this owner',
        );
      }
      executionId = source.execution_id;
      initialRunId = source.initial_run_id;
      sourceRunId = source.id;
      recoveryAction = input.recovery.action;
      const next = db
        .prepare(
          `SELECT COALESCE(MAX(run_index), -1) + 1 AS next_index
           FROM agent_runs
           WHERE execution_id = ? AND parent_run_id IS NULL`,
        )
        .get(executionId) as { next_index: number };
      runIndex = next.next_index;
    }

    const insert = db
      .prepare(
        `INSERT INTO agent_runs (
           id, task_id, parent_run_id, provider, status, model,
           runtime_version, session_handle_kind, mode, owner_key, project_id,
           conversation_id, client_request_id, request_message_id,
           execution_id, initial_run_id, source_run_id, run_index,
           recovery_action
         ) VALUES (
           ?, ?, NULL, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         ) ON CONFLICT DO NOTHING`,
      )
      .run(
        input.runId,
        input.ownerKey,
        input.provider,
        input.model ?? null,
        input.runtimeVersion ?? null,
        input.sessionHandleKind ?? null,
        input.mode,
        input.ownerKey,
        input.projectId,
        input.conversationId,
        input.clientRequestId,
        input.requestMessageId,
        executionId,
        initialRunId,
        sourceRunId,
        runIndex,
        recoveryAction,
      );
    if (insert.changes === 0) {
      const raced = assertMatchingReservation(
        getRunByRequestIdentity(
          input.mode,
          input.ownerKey,
          input.clientRequestId,
        ),
        getRunByMessageIdentity(
          input.mode,
          input.ownerKey,
          input.requestMessageId,
        ),
        normalizedContent,
      );
      if (raced) return { disposition: 'existing', run: raced } as const;
      throw new AgentRunConflictError(
        'Run reservation conflicts with an active execution',
      );
    }

    db.prepare(
      `INSERT INTO agent_run_events
         (run_id, seq, event_type, event_json, created_at)
       VALUES (?, -1, 'neuma.user_message', ?, ?)`,
    ).run(
      input.runId,
      JSON.stringify({
        messageId: input.requestMessageId,
        content: normalizedContent,
      }),
      new Date().toISOString(),
    );
    const run = db
      .prepare('SELECT * FROM agent_runs WHERE id = ?')
      .get(input.runId) as AgentRunRow;
    return { disposition: 'created', run } as const;
  })();
}

export function createAgentRun(input: {
  id: string;
  taskId: string;
  parentRunId?: string | null;
  provider: string;
  model?: string | null;
  runtimeVersion?: string | null;
  attempt?: number;
  sessionHandleKind?: string | null;
  invalidationReason?: string | null;
}): void {
  const db = getDatabase();
  const parent = input.parentRunId
    ? (db
        .prepare('SELECT * FROM agent_runs WHERE id = ?')
        .get(input.parentRunId) as AgentRunRow | undefined)
    : undefined;
  db.prepare(
    `INSERT OR IGNORE INTO agent_runs
         (id, task_id, parent_run_id, provider, status, model, runtime_version,
          attempt, session_handle_kind, invalidation_reason, mode, owner_key,
          project_id, conversation_id, execution_id, initial_run_id, run_index)
       VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.taskId,
    input.parentRunId ?? null,
    input.provider,
    input.model ?? null,
    input.runtimeVersion ?? null,
    input.attempt ?? 0,
    input.sessionHandleKind ?? null,
    input.invalidationReason ?? null,
    parent?.mode ?? 'task',
    parent?.owner_key ?? input.taskId,
    parent?.project_id ?? null,
    parent?.conversation_id ?? input.taskId,
    parent?.execution_id ?? input.id,
    parent?.initial_run_id ?? input.id,
    parent ? null : 0,
  );
}

export function finishAgentRun(input: {
  id: string;
  status: 'completed' | 'failed' | 'cancelled';
  costUsd?: number;
  tokensIn?: number;
  tokensOut?: number;
  error?: string | null;
  completeness?: AgentRunRow['completeness'];
  delivery?: AgentRunRow['delivery'];
  retry?: AgentRunRow['retry'];
  failureCause?: string | null;
}): void {
  getDatabase()
    .prepare(
      `UPDATE agent_runs
       SET status = ?, finished_at = datetime('now'),
           cost_usd = COALESCE(?, cost_usd),
           tokens_in = COALESCE(?, tokens_in),
           tokens_out = COALESCE(?, tokens_out),
           error = ?, completeness = COALESCE(?, completeness),
           delivery = COALESCE(?, delivery), retry = COALESCE(?, retry),
           failure_cause = COALESCE(?, failure_cause)
       WHERE id = ? AND status = 'running'`,
    )
    .run(
      input.status,
      input.costUsd ?? null,
      input.tokensIn ?? null,
      input.tokensOut ?? null,
      input.error ?? null,
      input.completeness ?? null,
      input.delivery ?? null,
      input.retry ?? null,
      input.failureCause ?? null,
      input.id,
    );
}

export function updateAgentRunAttempt(id: string, attempt: number): void {
  getDatabase()
    .prepare(
      `UPDATE agent_runs
       SET attempt = MAX(attempt, ?)
       WHERE id = ? AND status = 'running'`,
    )
    .run(Math.max(0, Math.floor(attempt)), id);
}

export function updateAgentRunDelivery(
  id: string,
  delivery: AgentRunRow['delivery'],
): void {
  getDatabase()
    .prepare(
      `UPDATE agent_runs
       SET delivery = CASE WHEN delivery = 'delivered' THEN delivery ELSE ? END,
           delivery_reconciliation_deadline = CASE
             WHEN delivery = 'delivered' OR ? <> 'pending' THEN NULL
             ELSE datetime('now', '+1 minute')
           END
       WHERE id = ?`,
    )
    .run(delivery, delivery, id);
}

export function reconcileOrphanedAgentRuns(): number {
  return getDatabase()
    .prepare(
      `UPDATE agent_runs
       SET status = 'failed', finished_at = datetime('now'),
           completeness = 'unfinished', retry = 'user_action',
           failure_cause = 'process_restarted',
           error = COALESCE(error, 'Run interrupted by application restart')
       WHERE status = 'running'`,
    )
    .run().changes;
}

/** Returns all runs for a task, ordered by start time. Used by run-tree views. */
export function getAgentRunsByTaskId(taskId: string): AgentRunRow[] {
  return getDatabase()
    .prepare('SELECT * FROM agent_runs WHERE task_id = ? ORDER BY started_at')
    .all(taskId) as AgentRunRow[];
}

/** Returns every top-level and child run owned by one mode conversation. */
export function getAgentRunsByOwner(
  mode: RunMode,
  ownerKey: string,
): AgentRunRow[] {
  return getDatabase()
    .prepare(
      `SELECT * FROM agent_runs
       WHERE mode = ? AND owner_key = ?
       ORDER BY started_at, COALESCE(run_index, 0), id`,
    )
    .all(mode, ownerKey) as AgentRunRow[];
}

// ============ Channel Config Operations ============

interface ChannelConfigRow {
  id: string;
  platform: string;
  name: string | null;
  token: string | null;
  mode: string;
  rate_limit: number;
  enabled: number;
  guardrails_provider: string;
  guardrails_fail_mode: string;
  model: string | null;
  mention_only: number | null;
  agent_profile_id: string | null;
  block_kit_progress: number | null;
  access_mode: string | null;
  cred_connectors_allowlist: string | null;
  user_mcp_policy: string | null;
  created_at: string;
}

function rowToChannelConfig(row: ChannelConfigRow): ChannelConfig {
  return {
    id: row.id,
    platform: row.platform as ChannelPlatform,
    name: row.name ?? null,
    token: row.token,
    mode: row.mode as ChannelConfig['mode'],
    rate_limit: row.rate_limit,
    enabled: row.enabled === 1,
    guardrails_provider: (row.guardrails_provider ??
      'none') as ChannelConfig['guardrails_provider'],
    guardrails_fail_mode: (row.guardrails_fail_mode ??
      'open') as ChannelConfig['guardrails_fail_mode'],
    model: row.model ?? null,
    mention_only: row.mention_only === 1,
    agent_profile_id: row.agent_profile_id ?? null,
    block_kit_progress: row.block_kit_progress !== 0,
    access_mode: (row.access_mode ?? 'open') as ChannelConfig['access_mode'],
    cred_connectors_allowlist: row.cred_connectors_allowlist ?? null,
    user_mcp_policy: (row.user_mcp_policy ??
      'open') as ChannelConfig['user_mcp_policy'],
    created_at: row.created_at,
  };
}

/** @deprecated Use getChannelConfigById or getChannelConfigsByPlatform instead. */
export function getChannelConfig(
  platform: ChannelPlatform,
): ChannelConfig | undefined {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM channel_config WHERE platform = ? LIMIT 1')
    .get(platform) as ChannelConfigRow | undefined;
  return row ? rowToChannelConfig(row) : undefined;
}

export function getChannelConfigById(
  configId: string,
): ChannelConfig | undefined {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM channel_config WHERE id = ?')
    .get(configId) as ChannelConfigRow | undefined;
  return row ? rowToChannelConfig(row) : undefined;
}

export function getAllChannelConfigs(): ChannelConfig[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM channel_config ORDER BY platform, created_at')
    .all() as ChannelConfigRow[];
  return rows.map(rowToChannelConfig);
}

export function getChannelConfigsByPlatform(
  platform: ChannelPlatform,
): ChannelConfig[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      'SELECT * FROM channel_config WHERE platform = ? ORDER BY created_at',
    )
    .all(platform) as ChannelConfigRow[];
  return rows.map(rowToChannelConfig);
}

export function deleteChannelConfig(configId: string): boolean {
  const db = getDatabase();
  // Cascade cleanup in a single transaction for atomicity and performance
  const deleteAll = db.transaction((id: string) => {
    db.prepare('DELETE FROM channel_pairing_codes WHERE config_id = ?').run(id);
    db.prepare('DELETE FROM channel_audit_log WHERE config_id = ?').run(id);
    db.prepare('DELETE FROM channel_messages WHERE config_id = ?').run(id);
    db.prepare('DELETE FROM channel_sessions WHERE config_id = ?').run(id);
    db.prepare('DELETE FROM channel_users WHERE config_id = ?').run(id);
    return (
      db.prepare('DELETE FROM channel_config WHERE id = ?').run(id).changes > 0
    );
  });
  return deleteAll(configId);
}

export function upsertChannelConfig(
  input: CreateChannelConfigInput,
): ChannelConfig {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO channel_config (id, platform, name, token, mode, rate_limit, enabled, guardrails_provider, guardrails_fail_mode, model, mention_only, agent_profile_id, block_kit_progress, access_mode, cred_connectors_allowlist, user_mcp_policy)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      token = excluded.token,
      mode = excluded.mode,
      rate_limit = excluded.rate_limit,
      enabled = excluded.enabled,
      guardrails_provider = excluded.guardrails_provider,
      guardrails_fail_mode = excluded.guardrails_fail_mode,
      model = excluded.model,
      mention_only = excluded.mention_only,
      agent_profile_id = excluded.agent_profile_id,
      block_kit_progress = excluded.block_kit_progress,
      access_mode = excluded.access_mode,
      cred_connectors_allowlist = excluded.cred_connectors_allowlist,
      user_mcp_policy = excluded.user_mcp_policy
  `).run(
    input.id,
    input.platform,
    input.name ?? null,
    input.token ?? null,
    input.mode ?? 'polling',
    input.rate_limit ?? 10,
    input.enabled !== false ? 1 : 0,
    input.guardrails_provider ?? 'none',
    input.guardrails_fail_mode ?? 'open',
    input.model ?? null,
    input.mention_only ? 1 : 0,
    input.agent_profile_id ?? null,
    input.block_kit_progress !== false ? 1 : 0,
    input.access_mode ?? 'open',
    input.cred_connectors_allowlist ?? null,
    input.user_mcp_policy ?? 'open',
  );
  return getChannelConfigById(input.id)!;
}

interface ChannelUserRow {
  id: string;
  platform: string;
  config_id: string | null;
  platform_user_id: string;
  display_name: string | null;
  approved_at: string | null;
  permission_tier: string;
  token_budget: number;
  tokens_used_today: number;
  tokens_period_start: string | null;
}

function rowToChannelUser(row: ChannelUserRow): ChannelUser {
  return {
    id: row.id,
    platform: row.platform as ChannelPlatform,
    config_id: row.config_id ?? null,
    platform_user_id: row.platform_user_id,
    display_name: row.display_name,
    approved_at: row.approved_at,
    permission_tier: (row.permission_tier ??
      'operator') as ChannelPermissionTier,
    token_budget: row.token_budget ?? 0,
    tokens_used_today: row.tokens_used_today ?? 0,
    tokens_period_start: row.tokens_period_start ?? null,
  };
}

export function getChannelUsers(configId: string): ChannelUser[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM channel_users WHERE config_id = ?')
    .all(configId) as ChannelUserRow[];
  return rows.map(rowToChannelUser);
}

/** @deprecated Use getChannelUsers(configId) instead. */
export function getChannelUsersByPlatform(
  platform: ChannelPlatform,
): ChannelUser[] {
  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM channel_users WHERE platform = ?')
    .all(platform) as ChannelUserRow[];
  return rows.map(rowToChannelUser);
}

export function approveChannelUser(
  configId: string,
  platform: ChannelPlatform,
  platformUserId: string,
  displayName?: string,
): ChannelUser {
  const db = getDatabase();
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO channel_users (id, platform, config_id, platform_user_id, display_name, approved_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(config_id, platform_user_id) DO UPDATE SET
      display_name = excluded.display_name,
      approved_at = excluded.approved_at
  `).run(id, platform, configId, platformUserId, displayName ?? null);
  const row = db
    .prepare(
      'SELECT * FROM channel_users WHERE config_id = ? AND platform_user_id = ?',
    )
    .get(configId, platformUserId) as ChannelUserRow;
  return rowToChannelUser(row);
}

export function removeChannelUser(id: string): boolean {
  const db = getDatabase();
  return (
    db.prepare('DELETE FROM channel_users WHERE id = ?').run(id).changes > 0
  );
}

export function isChannelUserApproved(
  configId: string,
  platformUserId: string,
): boolean {
  const db = getDatabase();
  const row = db
    .prepare(
      'SELECT id FROM channel_users WHERE config_id = ? AND platform_user_id = ? AND approved_at IS NOT NULL',
    )
    .get(configId, platformUserId);
  return row !== undefined;
}

export function getApprovedChannelUser(
  configId: string,
  platformUserId: string,
): ChannelUser | undefined {
  const db = getDatabase();
  const row = db
    .prepare(
      'SELECT * FROM channel_users WHERE config_id = ? AND platform_user_id = ? AND approved_at IS NOT NULL',
    )
    .get(configId, platformUserId) as ChannelUserRow | undefined;
  return row ? rowToChannelUser(row) : undefined;
}

export function updateChannelUserTier(
  id: string,
  tier: ChannelPermissionTier,
): ChannelUser | undefined {
  const db = getDatabase();
  db.prepare('UPDATE channel_users SET permission_tier = ? WHERE id = ?').run(
    tier,
    id,
  );
  const row = db.prepare('SELECT * FROM channel_users WHERE id = ?').get(id) as
    | ChannelUserRow
    | undefined;
  return row ? rowToChannelUser(row) : undefined;
}

export function updateChannelUserDisplayName(
  id: string,
  displayName: string,
): void {
  const db = getDatabase();
  db.prepare('UPDATE channel_users SET display_name = ? WHERE id = ?').run(
    displayName,
    id,
  );
}

export function updateChannelUserBudget(
  id: string,
  tokenBudget: number,
): ChannelUser | undefined {
  const db = getDatabase();
  db.prepare('UPDATE channel_users SET token_budget = ? WHERE id = ?').run(
    tokenBudget,
    id,
  );
  const row = db.prepare('SELECT * FROM channel_users WHERE id = ?').get(id) as
    | ChannelUserRow
    | undefined;
  return row ? rowToChannelUser(row) : undefined;
}

export function recordTokenUsage(
  id: string,
  tokensUsed: number,
): ChannelUser | undefined {
  const db = getDatabase();
  db.prepare(
    'UPDATE channel_users SET tokens_used_today = tokens_used_today + ? WHERE id = ?',
  ).run(tokensUsed, id);
  const row = db.prepare('SELECT * FROM channel_users WHERE id = ?').get(id) as
    | ChannelUserRow
    | undefined;
  return row ? rowToChannelUser(row) : undefined;
}

export function resetTokenUsageIfNewPeriod(id: string): void {
  const db = getDatabase();
  // Reset if tokens_period_start is null or before today's UTC midnight
  db.prepare(`
    UPDATE channel_users
    SET tokens_used_today = 0,
        tokens_period_start = datetime('now', 'start of day')
    WHERE id = ?
      AND (tokens_period_start IS NULL
           OR tokens_period_start < datetime('now', 'start of day'))
  `).run(id);
}

// ============ Channel Pairing Code Operations ============

interface ChannelPairingCodeRow {
  code: string;
  platform: string;
  config_id: string | null;
  platform_user_id: string;
  expires_at: string;
  used: number;
}

function rowToPairingCode(row: ChannelPairingCodeRow): ChannelPairingCode {
  return {
    code: row.code,
    platform: row.platform as ChannelPlatform,
    config_id: row.config_id ?? null,
    platform_user_id: row.platform_user_id,
    expires_at: row.expires_at,
    used: row.used === 1,
  };
}

export function createPairingCode(
  configId: string,
  platform: ChannelPlatform,
  platformUserId: string,
): ChannelPairingCode {
  const db = getDatabase();
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);
  db.prepare(
    'INSERT OR REPLACE INTO channel_pairing_codes (code, platform, config_id, platform_user_id, expires_at, used) VALUES (?, ?, ?, ?, ?, 0)',
  ).run(code, platform, configId, platformUserId, expiresAt);
  return rowToPairingCode(
    db
      .prepare('SELECT * FROM channel_pairing_codes WHERE code = ?')
      .get(code) as ChannelPairingCodeRow,
  );
}

export function verifyPairingCode(
  code: string,
): ChannelPairingCode | undefined {
  const db = getDatabase();
  const row = db
    .prepare(
      "SELECT * FROM channel_pairing_codes WHERE code = ? AND used = 0 AND expires_at > datetime('now')",
    )
    .get(code) as ChannelPairingCodeRow | undefined;
  return row ? rowToPairingCode(row) : undefined;
}

export function markPairingCodeUsed(code: string): void {
  const db = getDatabase();
  db.prepare('UPDATE channel_pairing_codes SET used = 1 WHERE code = ?').run(
    code,
  );
}

/** Alias for saveSetting — used by auth services */
export function setSetting(key: string, value: string): void {
  saveSetting(key, value);
}

// ============ Channel Session Operations ============

interface ChannelSessionRow {
  id: string;
  platform: string;
  config_id: string | null;
  session_key: string;
  channel_user_id: string | null;
  agent_session_id: string | null;
  agent_task_id: string | null;
  status: string;
  context_summary: string | null;
  last_activity_at: string | null;
  error_count: number;
  created_at: string;
  updated_at: string;
}

function rowToChannelSession(row: ChannelSessionRow): ChannelSession {
  return {
    id: row.id,
    platform: row.platform,
    config_id: row.config_id ?? null,
    session_key: row.session_key,
    channel_user_id: row.channel_user_id,
    agent_session_id: row.agent_session_id,
    agent_task_id: row.agent_task_id,
    status: row.status as ChannelSession['status'],
    context_summary: row.context_summary,
    last_activity_at: row.last_activity_at,
    error_count: row.error_count ?? 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function getChannelSession(
  configId: string,
  sessionKey: string,
): ChannelSession | undefined {
  const db = getDatabase();
  const row = db
    .prepare(
      'SELECT * FROM channel_sessions WHERE config_id = ? AND session_key = ? AND status != ?',
    )
    .get(configId, sessionKey, 'archived') as ChannelSessionRow | undefined;
  return row ? rowToChannelSession(row) : undefined;
}

export function getChannelSessionById(id: string): ChannelSession | undefined {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM channel_sessions WHERE id = ?')
    .get(id) as ChannelSessionRow | undefined;
  return row ? rowToChannelSession(row) : undefined;
}

export function createChannelSession(
  input: CreateChannelSessionInput,
): ChannelSession {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO channel_sessions (id, platform, config_id, session_key, channel_user_id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(
    input.id,
    input.platform,
    input.config_id ?? null,
    input.session_key,
    input.channel_user_id,
    input.status ?? 'active',
  );
  return getChannelSessionById(input.id)!;
}

export function updateChannelSession(
  id: string,
  updates: Partial<
    Pick<
      ChannelSession,
      | 'agent_session_id'
      | 'agent_task_id'
      | 'status'
      | 'last_activity_at'
      | 'error_count'
      | 'context_summary'
    >
  >,
): ChannelSession | undefined {
  const db = getDatabase();
  const setClauses: string[] = ["updated_at = datetime('now')"];
  const params: unknown[] = [];

  if (updates.agent_session_id !== undefined) {
    setClauses.push('agent_session_id = ?');
    params.push(updates.agent_session_id);
  }
  if (updates.agent_task_id !== undefined) {
    setClauses.push('agent_task_id = ?');
    params.push(updates.agent_task_id);
  }
  if (updates.status !== undefined) {
    setClauses.push('status = ?');
    params.push(updates.status);
  }
  if (updates.last_activity_at !== undefined) {
    setClauses.push('last_activity_at = ?');
    params.push(updates.last_activity_at);
  }
  if (updates.error_count !== undefined) {
    setClauses.push('error_count = ?');
    params.push(updates.error_count);
  }
  if (updates.context_summary !== undefined) {
    setClauses.push('context_summary = ?');
    params.push(updates.context_summary);
  }

  params.push(id);
  db.prepare(
    `UPDATE channel_sessions SET ${setClauses.join(', ')} WHERE id = ?`,
  ).run(...params);
  return getChannelSessionById(id);
}

export function getChannelSessions(filters: {
  platform?: string;
  configId?: string;
  status?: string;
}): ChannelSession[] {
  const db = getDatabase();
  const wheres: string[] = [];
  const params: unknown[] = [];
  if (filters.configId) {
    wheres.push('config_id = ?');
    params.push(filters.configId);
  } else if (filters.platform) {
    wheres.push('platform = ?');
    params.push(filters.platform);
  }
  if (filters.status) {
    wheres.push('status = ?');
    params.push(filters.status);
  }
  const where = wheres.length > 0 ? `WHERE ${wheres.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT * FROM channel_sessions ${where} ORDER BY last_activity_at DESC LIMIT 100`,
    )
    .all(...params) as ChannelSessionRow[];
  return rows.map(rowToChannelSession);
}

// ============ Channel Message Operations ============

interface ChannelMessageRow {
  id: string;
  session_id: string;
  platform: string;
  config_id: string | null;
  platform_message_id: string | null;
  direction: string;
  content: string;
  content_type: string;
  token_count: number;
  metadata: string;
  created_at: string;
}

function rowToChannelMessage(row: ChannelMessageRow): ChannelMessage {
  return {
    id: row.id,
    session_id: row.session_id,
    platform: row.platform,
    config_id: row.config_id ?? null,
    platform_message_id: row.platform_message_id,
    direction: row.direction as ChannelMessage['direction'],
    content: row.content,
    content_type: row.content_type,
    token_count: row.token_count ?? 0,
    metadata: row.metadata ?? '{}',
    created_at: row.created_at,
  };
}

export function insertChannelMessage(
  input: InsertChannelMessageInput,
): ChannelMessage {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO channel_messages (id, session_id, platform, config_id, platform_message_id, direction, content, content_type, token_count, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.session_id,
    input.platform,
    input.config_id ?? null,
    input.platform_message_id,
    input.direction,
    input.content,
    input.content_type ?? 'text',
    input.token_count ?? 0,
    input.metadata ?? '{}',
  );
  const row = db
    .prepare('SELECT * FROM channel_messages WHERE id = ?')
    .get(input.id) as ChannelMessageRow;
  return rowToChannelMessage(row);
}

export function isDuplicateChannelMessage(
  configId: string,
  platformMessageId: string,
): boolean {
  const db = getDatabase();
  const row = db
    .prepare(
      'SELECT id FROM channel_messages WHERE config_id = ? AND platform_message_id = ?',
    )
    .get(configId, platformMessageId);
  return row !== undefined;
}

export function getChannelHistory(
  sessionId: string,
  limit = 20,
): ChannelMessage[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      'SELECT * FROM channel_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?',
    )
    .all(sessionId, limit) as ChannelMessageRow[];
  return rows.reverse().map(rowToChannelMessage);
}

export function getChannelSessionMessages(
  sessionId: string,
  limit = 50,
): ChannelMessage[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      'SELECT * FROM channel_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?',
    )
    .all(sessionId, limit) as ChannelMessageRow[];
  return rows.reverse().map(rowToChannelMessage);
}

// ============ Channel Audit Log Operations ============

interface ChannelAuditLogRow {
  id: string;
  channel_user_id: string | null;
  platform: string | null;
  config_id: string | null;
  action: string;
  details: string;
  created_at: string;
}

function rowToChannelAuditLog(row: ChannelAuditLogRow): ChannelAuditLog {
  return {
    id: row.id,
    channel_user_id: row.channel_user_id,
    platform: row.platform,
    config_id: row.config_id ?? null,
    action: row.action,
    details: row.details,
    created_at: row.created_at,
  };
}

export function insertChannelAuditLog(input: InsertAuditLogInput): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO channel_audit_log (id, channel_user_id, platform, config_id, action, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.channel_user_id,
    input.platform,
    input.config_id ?? null,
    input.action,
    input.details,
  );
}

export function getChannelAuditLogs(filters: {
  platform?: string;
  configId?: string;
  channelUserId?: string;
  limit?: number;
  offset?: number;
}): { logs: ChannelAuditLog[]; total: number } {
  const db = getDatabase();
  const wheres: string[] = [];
  const params: unknown[] = [];
  if (filters.configId) {
    wheres.push('config_id = ?');
    params.push(filters.configId);
  } else if (filters.platform) {
    wheres.push('platform = ?');
    params.push(filters.platform);
  }
  if (filters.channelUserId) {
    wheres.push('channel_user_id = ?');
    params.push(filters.channelUserId);
  }
  const where = wheres.length > 0 ? `WHERE ${wheres.join(' AND ')}` : '';

  const totalRow = db
    .prepare(`SELECT COUNT(*) as count FROM channel_audit_log ${where}`)
    .get(...params) as { count: number };
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;
  const rows = db
    .prepare(
      `SELECT * FROM channel_audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as ChannelAuditLogRow[];

  return { logs: rows.map(rowToChannelAuditLog), total: totalRow.count };
}

// ============ WebUI Sessions (JWT refresh token rotation) ============

export function insertWebuiSession(
  token: string,
  family: string,
  expiresAt: string,
): void {
  const db = getDatabase();
  db.prepare(
    `INSERT INTO webui_sessions (token, family, expires_at, used, created_at)
     VALUES (?, ?, ?, 0, datetime('now'))`,
  ).run(token, family, expiresAt);
}

export function getWebuiSession(
  token: string,
): { token: string; family: string; expires_at: string; used: number } | null {
  const db = getDatabase();
  return (
    (db
      .prepare(
        `SELECT token, family, expires_at, used FROM webui_sessions WHERE token = ?`,
      )
      .get(token) as
      | { token: string; family: string; expires_at: string; used: number }
      | undefined) ?? null
  );
}

export function markWebuiSessionUsed(token: string): void {
  const db = getDatabase();
  db.prepare(
    `UPDATE webui_sessions SET used = 1, used_at = datetime('now') WHERE token = ?`,
  ).run(token);
}

export function revokeWebuiFamily(family: string): void {
  const db = getDatabase();
  db.prepare(`DELETE FROM webui_sessions WHERE family = ?`).run(family);
}

export function cleanExpiredWebuiSessions(): void {
  const db = getDatabase();
  db.prepare(
    `DELETE FROM webui_sessions WHERE expires_at < datetime('now')`,
  ).run();
}

// ============================================================================
// Operating Profiles (stubs — full implementation in a follow-up migration)
// ============================================================================

export interface OperatingProfile {
  id: string;
  name: string;
  description?: string | null;
  is_active: number;
  agent_profile_ids?: string | null;
  budget_policy_ids?: string | null;
  mcp_defaults?: string | null;
  skills_defaults?: string | null;
  workspace_root?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export function getAllOperatingProfiles(): OperatingProfile[] {
  const db = getDatabase();
  return db
    .prepare('SELECT * FROM operating_profiles ORDER BY name')
    .all() as OperatingProfile[];
}

export function getOperatingProfile(id: string): OperatingProfile | null {
  const db = getDatabase();
  return (
    (db.prepare('SELECT * FROM operating_profiles WHERE id = ?').get(id) as
      | OperatingProfile
      | undefined) ?? null
  );
}

export function createOperatingProfile(
  input: Omit<OperatingProfile, 'created_at' | 'updated_at'>,
): OperatingProfile {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO operating_profiles
      (id, name, description, is_active, agent_profile_ids, budget_policy_ids,
       mcp_defaults, skills_defaults, workspace_root)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.name,
    input.description ?? null,
    input.is_active ?? 0,
    input.agent_profile_ids ?? null,
    input.budget_policy_ids ?? null,
    input.mcp_defaults ?? null,
    input.skills_defaults ?? null,
    input.workspace_root ?? null,
  );
  return getOperatingProfile(input.id)!;
}

const ALLOWED_PROFILE_UPDATE_COLUMNS = new Set([
  'name',
  'description',
  'is_active',
  'agent_profile_ids',
  'budget_policy_ids',
  'mcp_defaults',
  'skills_defaults',
  'workspace_root',
]);

export function updateOperatingProfile(
  id: string,
  updates: Partial<Omit<OperatingProfile, 'id' | 'created_at' | 'updated_at'>>,
): OperatingProfile | null {
  const db = getDatabase();
  const allowedEntries = Object.entries(updates).filter(([k]) =>
    ALLOWED_PROFILE_UPDATE_COLUMNS.has(k),
  );
  if (!allowedEntries.length) return getOperatingProfile(id);
  const fields = allowedEntries.map(([k]) => `${k} = ?`).join(', ');
  db.prepare(
    `UPDATE operating_profiles SET ${fields}, updated_at = datetime('now') WHERE id = ?`,
  ).run(...allowedEntries.map(([, v]) => v), id);
  return getOperatingProfile(id);
}

export function deleteOperatingProfile(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM operating_profiles WHERE id = ?').run(id);
}

export function activateProfile(id: string): OperatingProfile | null {
  const db = getDatabase();
  db.transaction(() => {
    db.prepare(
      `UPDATE operating_profiles SET is_active = 0, updated_at = datetime('now')`,
    ).run();
    db.prepare(
      `UPDATE operating_profiles SET is_active = 1, updated_at = datetime('now') WHERE id = ?`,
    ).run(id);
  })();
  return getOperatingProfile(id);
}

export function getActiveProfile(): OperatingProfile | null {
  const db = getDatabase();
  return (
    (db
      .prepare('SELECT * FROM operating_profiles WHERE is_active = 1 LIMIT 1')
      .get() as OperatingProfile | undefined) ?? null
  );
}

// ============================================================================
// Conversation Branches (stubs — full implementation in a follow-up migration)
// ============================================================================

/**
 * Resolve a message identifier to the numeric DB row id.
 * Accepts either:
 *  - A numeric id (returned as-is)
 *  - A UUID string (message_id column) — looked up in the messages table
 */
export function resolveMessageId(
  taskId: string,
  messageRef: number | string,
): number {
  if (typeof messageRef === 'number' && !Number.isNaN(messageRef)) {
    return messageRef;
  }
  const str = String(messageRef);
  // If it's a plain numeric string, use directly
  const asNum = Number(str);
  if (!Number.isNaN(asNum) && String(asNum) === str) {
    return asNum;
  }
  // Otherwise treat as message_id (UUID) and look up the numeric id
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT id FROM messages WHERE task_id = ? AND message_id = ? LIMIT 1`,
    )
    .get(taskId, str) as { id: number } | undefined;
  if (!row) {
    throw new Error(`Message not found: task=${taskId}, messageRef=${str}`);
  }
  return row.id;
}

export function createBranch(taskId: string, fromMessageId: number): string {
  const db = getDatabase();
  const branchId = crypto.randomUUID();
  // Copy messages up to and including fromMessageId into the new branch,
  // leaving the originals on 'main' intact.
  db.prepare(`
    INSERT INTO messages (
      task_id, type, content, tool_name, tool_input, tool_output, tool_use_id,
      subtype, error_message, attachments, message_id, cost,
      usage_input, usage_output, usage_cache_read, usage_cache_creation,
      model, created_at, branch_id, parent_message_id
    )
    SELECT
      task_id, type, content, tool_name, tool_input, tool_output, tool_use_id,
      subtype, error_message, attachments, NULL, cost,
      usage_input, usage_output, usage_cache_read, usage_cache_creation,
      model, created_at, ?, ?
    FROM messages
    WHERE task_id = ? AND id <= ? AND branch_id = 'main'
  `).run(branchId, fromMessageId, taskId, fromMessageId);
  return branchId;
}

export function getBranches(taskId: string): string[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT DISTINCT branch_id FROM messages WHERE task_id = ? ORDER BY branch_id`,
    )
    .all(taskId) as { branch_id: string }[];
  return rows.map((r) => r.branch_id);
}

export function mergeBranch(
  taskId: string,
  sourceBranchId: string,
  targetBranchId: string,
  afterMessageId: number,
): { merged: number } {
  const db = getDatabase();
  const result = db
    .prepare(`
      UPDATE messages
      SET branch_id = ?
      WHERE task_id = ? AND branch_id = ? AND id > ?
    `)
    .run(targetBranchId, taskId, sourceBranchId, afterMessageId);
  return { merged: result.changes };
}

export function getMessagesByBranch(
  taskId: string,
  branchId: string,
): Message[] {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT * FROM messages WHERE task_id = ? AND branch_id = ? ORDER BY id ASC`,
    )
    .all(taskId, branchId) as Message[];
}

export function getBranchesAtForkPoint(
  taskId: string,
  parentMessageId: number,
): string[] {
  const db = getDatabase();
  // Include 'main' branch (messages at/after the fork point on main)
  // plus any branches whose parent_message_id equals this fork point
  const rows = db
    .prepare(
      `SELECT DISTINCT branch_id FROM messages
       WHERE task_id = ? AND parent_message_id = ?
       ORDER BY branch_id`,
    )
    .all(taskId, parentMessageId) as { branch_id: string }[];
  return rows.map((r) => r.branch_id);
}

export function createBranchWithEditedMessage(
  taskId: string,
  fromMessageId: number,
  newContent: string,
): { branchId: string; newMessageId: number; messageUuid: string } {
  const db = getDatabase();
  const branchId = crypto.randomUUID();
  const messageUuid = crypto.randomUUID();

  const txn = db.transaction(() => {
    // Copy messages up to (but NOT including) the edited message
    db.prepare(`
      INSERT INTO messages (
        task_id, type, content, tool_name, tool_input, tool_output, tool_use_id,
        subtype, error_message, attachments, message_id, cost,
        usage_input, usage_output, usage_cache_read, usage_cache_creation,
        model, created_at, branch_id, parent_message_id
      )
      SELECT
        task_id, type, content, tool_name, tool_input, tool_output, tool_use_id,
        subtype, error_message, attachments, NULL, cost,
        usage_input, usage_output, usage_cache_read, usage_cache_creation,
        model, created_at, ?, ?
      FROM messages
      WHERE task_id = ? AND id < ? AND branch_id = 'main'
    `).run(branchId, fromMessageId, taskId, fromMessageId);

    // Insert the edited user message on the new branch with a UUID
    // so the AG-UI run handler won't create a duplicate via INSERT OR IGNORE
    const result = db
      .prepare(`
        INSERT INTO messages (task_id, type, content, message_id, branch_id, parent_message_id, created_at)
        VALUES (?, 'user', ?, ?, ?, ?, datetime('now'))
      `)
      .run(taskId, newContent, messageUuid, branchId, fromMessageId);

    return {
      branchId,
      newMessageId: Number(result.lastInsertRowid),
      messageUuid,
    };
  });

  return txn();
}

export function deleteBranchMessagesAfter(
  taskId: string,
  branchId: string,
  afterMessageId: number,
): number {
  const db = getDatabase();
  const result = db
    .prepare(
      `DELETE FROM messages WHERE task_id = ? AND branch_id = ? AND id > ?`,
    )
    .run(taskId, branchId, afterMessageId);
  return result.changes;
}

export function searchMessages(taskId: string, query: string): Message[] {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT * FROM messages
       WHERE task_id = ? AND content LIKE '%' || ? || '%'
       ORDER BY id ASC
       LIMIT 100`,
    )
    .all(taskId, query) as Message[];
}

// ============================================================================
// Publish Ledger Operations
// ============================================================================

export function insertPublishJobRow(
  input: InsertPublishJobRowInput,
  db: Database.Database = getDatabase(),
): PublishJobRow {
  const hasWorkflowColumns =
    hasColumn(db, 'publish_jobs', 'workflow_version') &&
    hasColumn(db, 'publish_jobs', 'workflow_state_json');
  const columns = [
    'id',
    'workspace_id',
    'created_by',
    'artifact_id',
    'source_artifact_path',
    'source_sha256',
    'source_size_bytes',
    'source_mime',
    'source_provenance_json',
    'source_json',
    'signed_artifact_path',
    'manifest_path',
    'provenance_state',
    'state',
    'approval_required',
    'approval_channel',
    'approved_by',
    'approved_at',
    'scheduled_for',
    'idempotency_key',
    'metadata_json',
  ];
  const values: unknown[] = [
    input.id,
    input.workspace_id,
    input.created_by,
    input.artifact_id ?? null,
    input.source_artifact_path,
    input.source_sha256,
    input.source_size_bytes,
    input.source_mime,
    input.source_provenance_json ?? null,
    input.source_json,
    input.signed_artifact_path ?? null,
    input.manifest_path ?? null,
    input.provenance_state,
    input.state,
    input.approval_required,
    input.approval_channel ?? null,
    input.approved_by ?? null,
    input.approved_at ?? null,
    input.scheduled_for ?? null,
    input.idempotency_key,
    input.metadata_json,
  ];

  if (hasWorkflowColumns) {
    columns.push('workflow_version', 'workflow_state_json');
    values.push(
      input.workflow_version ?? '1.0.0',
      input.workflow_state_json ?? '{}',
    );
  }

  const placeholders = columns.map(() => '?').join(', ');
  db.prepare(
    `INSERT INTO publish_jobs (
      ${columns.join(', ')}
    ) VALUES (${placeholders})`,
  ).run(...values);

  const row = getPublishJobRow(input.id, db);
  if (!row) {
    throw new Error(`Failed to insert publish job ${input.id}`);
  }
  return row;
}

export function getPublishJobRow(
  id: string,
  db: Database.Database = getDatabase(),
): PublishJobRow | null {
  return (
    (db.prepare('SELECT * FROM publish_jobs WHERE id = ?').get(id) as
      | PublishJobRow
      | undefined) ?? null
  );
}

export function getPublishJobRowByIdempotencyKey(
  idempotencyKey: string,
  db: Database.Database = getDatabase(),
): PublishJobRow | null {
  return (
    (db
      .prepare('SELECT * FROM publish_jobs WHERE idempotency_key = ?')
      .get(idempotencyKey) as PublishJobRow | undefined) ?? null
  );
}

export function listPublishJobRows(
  filter: {
    workspaceId?: string;
    state?: string;
    limit?: number;
    offset?: number;
  },
  db: Database.Database = getDatabase(),
): PublishJobRow[] {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filter.workspaceId) {
    clauses.push('workspace_id = ?');
    params.push(filter.workspaceId);
  }
  if (filter.state) {
    clauses.push('state = ?');
    params.push(filter.state);
  }

  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(filter.limit ?? 100, 500));
  const offset = Math.max(0, filter.offset ?? 0);
  return db
    .prepare(
      `SELECT * FROM publish_jobs${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as PublishJobRow[];
}

export function insertPublishDestinationLegRow(
  input: InsertPublishDestinationLegRowInput,
  db: Database.Database = getDatabase(),
): PublishDestinationLegRow {
  db.prepare(
    `INSERT INTO publish_destination_legs (
      id, job_id, destination_kind, destination_label, connection_id,
      idempotency_key, state, config_json, total_bytes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.job_id,
    input.destination_kind,
    input.destination_label ?? null,
    input.connection_id,
    input.idempotency_key,
    input.state,
    input.config_json,
    input.total_bytes ?? null,
  );

  const row = getPublishDestinationLegRow(input.id, db);
  if (!row) {
    throw new Error(`Failed to insert publish leg ${input.id}`);
  }
  return row;
}

export function getPublishDestinationLegRow(
  id: string,
  db: Database.Database = getDatabase(),
): PublishDestinationLegRow | null {
  return (
    (db
      .prepare('SELECT * FROM publish_destination_legs WHERE id = ?')
      .get(id) as PublishDestinationLegRow | undefined) ?? null
  );
}

export function getPublishDestinationLegRowByIdentity(
  jobId: string,
  destinationKind: string,
  connectionId: string,
  db: Database.Database = getDatabase(),
): PublishDestinationLegRow | null {
  return (
    (db
      .prepare(
        `SELECT * FROM publish_destination_legs
         WHERE job_id = ? AND destination_kind = ? AND connection_id = ?
         LIMIT 1`,
      )
      .get(jobId, destinationKind, connectionId) as
      | PublishDestinationLegRow
      | undefined) ?? null
  );
}

export function listPublishDestinationLegRows(
  jobId: string,
  db: Database.Database = getDatabase(),
): PublishDestinationLegRow[] {
  return db
    .prepare(
      'SELECT * FROM publish_destination_legs WHERE job_id = ? ORDER BY created_at ASC',
    )
    .all(jobId) as PublishDestinationLegRow[];
}

const ALLOWED_PUBLISH_JOB_UPDATE_COLUMNS = new Set([
  'state',
  'provenance_state',
  'signed_artifact_path',
  'manifest_path',
  'metadata_json',
  'approved_by',
  'approved_at',
  'scheduled_for',
  'completed_at',
  'workflow_version',
  'workflow_state_json',
  'updated_at',
]);

export function updatePublishJobRow(
  id: string,
  updates: Partial<PublishJobRow>,
  db: Database.Database = getDatabase(),
): PublishJobRow | null {
  const entries = Object.entries(updates).filter(([column]) =>
    ALLOWED_PUBLISH_JOB_UPDATE_COLUMNS.has(column),
  );
  if (!entries.length) return getPublishJobRow(id, db);

  const fields = entries.map(([column]) => `${column} = ?`).join(', ');
  db.prepare(`UPDATE publish_jobs SET ${fields} WHERE id = ?`).run(
    ...entries.map(([, value]) => value),
    id,
  );
  return getPublishJobRow(id, db);
}

const ALLOWED_PUBLISH_LEG_UPDATE_COLUMNS = new Set([
  'state',
  'plan_json',
  'session_id',
  'chunk_offset_bytes',
  'total_bytes',
  'etags_json',
  'attempts',
  'provider_response_json',
  'published_ref_json',
  'error_class',
  'error_message',
  'next_retry_at',
  'locked_by',
  'lease_until',
  'notification_channel_ref',
  'notification_delivered_at',
  'approval_required',
  'approved_by',
  'approved_at',
  'rejection_reason',
  'last_progress_at',
  'updated_at',
  'published_at',
]);

export function updatePublishDestinationLegRow(
  id: string,
  updates: Partial<PublishDestinationLegRow>,
  db: Database.Database = getDatabase(),
): PublishDestinationLegRow | null {
  const entries = Object.entries(updates).filter(([column]) =>
    ALLOWED_PUBLISH_LEG_UPDATE_COLUMNS.has(column),
  );
  if (!entries.length) return getPublishDestinationLegRow(id, db);

  const fields = entries.map(([column]) => `${column} = ?`).join(', ');
  db.prepare(`UPDATE publish_destination_legs SET ${fields} WHERE id = ?`).run(
    ...entries.map(([, value]) => value),
    id,
  );
  return getPublishDestinationLegRow(id, db);
}
