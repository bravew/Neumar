/**
 * Branch → Claude SDK session mapping (issue #74).
 *
 * Every finished task run that can seed a conversation branch records which
 * SDK session it wrote. The latest row for a branch is the session its next
 * run resumes; a `main` row lets a new branch fork the session that produced
 * its fork point, so the branch keeps tool calls, tool results, and thinking
 * from before the fork instead of a text-only transcript.
 */

import { getDatabase } from './index';

export type BranchSdkSessionMode = 'fresh' | 'fork' | 'resume' | 'text';

export interface BranchSdkSessionRecord {
  id: number;
  taskId: string;
  branchId: string;
  runId: string | null;
  provider: string;
  mode: BranchSdkSessionMode;
  sdkSessionId: string | null;
  forkedFromSessionId: string | null;
  promptSdkUuid: string | null;
  cwd: string | null;
  createdAt: string;
}

interface BranchSdkSessionRow {
  id: number;
  task_id: string;
  branch_id: string;
  run_id: string | null;
  provider: string;
  mode: BranchSdkSessionMode;
  sdk_session_id: string | null;
  forked_from_session_id: string | null;
  prompt_sdk_uuid: string | null;
  cwd: string | null;
  created_at: string;
}

function rowToRecord(row: BranchSdkSessionRow): BranchSdkSessionRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    branchId: row.branch_id,
    runId: row.run_id,
    provider: row.provider,
    mode: row.mode,
    sdkSessionId: row.sdk_session_id,
    forkedFromSessionId: row.forked_from_session_id,
    promptSdkUuid: row.prompt_sdk_uuid,
    cwd: row.cwd,
    createdAt: row.created_at,
  };
}

export interface RecordBranchSdkSessionInput {
  taskId: string;
  branchId: string;
  runId?: string;
  provider: string;
  mode: BranchSdkSessionMode;
  sdkSessionId?: string;
  forkedFromSessionId?: string;
  promptSdkUuid?: string;
  cwd?: string;
}

export function recordBranchSdkSession(
  input: RecordBranchSdkSessionInput,
): void {
  if (input.mode !== 'text' && !input.sdkSessionId) {
    throw new Error(`SDK session id is required for mode ${input.mode}`);
  }
  getDatabase()
    .prepare(
      `INSERT OR REPLACE INTO branch_sdk_sessions (
         task_id, branch_id, run_id, provider, mode, sdk_session_id,
         forked_from_session_id, prompt_sdk_uuid, cwd
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.taskId,
      input.branchId,
      input.runId ?? null,
      input.provider,
      input.mode,
      input.mode === 'text' ? null : (input.sdkSessionId ?? null),
      input.forkedFromSessionId ?? null,
      input.promptSdkUuid ?? null,
      input.cwd ?? null,
    );
}

/** The branch's most recent record, i.e. what its next run continues from. */
export function getLatestBranchSdkSession(
  taskId: string,
  branchId: string,
): BranchSdkSessionRecord | null {
  const row = getDatabase()
    .prepare(
      `SELECT * FROM branch_sdk_sessions
       WHERE task_id = ? AND branch_id = ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(taskId, branchId) as BranchSdkSessionRow | undefined;
  return row ? rowToRecord(row) : null;
}

/**
 * Message types that are part of the model-visible conversation. `result`,
 * `error`, `plan`, and thinking rows are bookkeeping around a turn and do not
 * move a fork point off a run boundary.
 */
const CONVERSATION_ROW_FILTER = `type IN ('user', 'text', 'tool_use', 'tool_result')
  AND COALESCE(subtype, '') != 'thinking'`;

/**
 * Runs that belong to a non-main branch. Their rows are excluded when looking
 * for the main-branch run at a fork point so one branch never seeds another.
 */
const NON_MAIN_RUN_FILTER = `(run_id IS NULL OR run_id NOT IN (
  SELECT run_id FROM branch_sdk_sessions
  WHERE task_id = ? AND branch_id != 'main' AND run_id IS NOT NULL
))`;

export interface BranchForkPoint {
  /** `messages.id` of the fork point on main (the branch's parent_message_id). */
  parentMessageId: number;
  /**
   * Last main-branch row kept by the branch. An edit branch keeps rows before
   * the edited user message; a fork keeps the fork-point message itself.
   */
  keptUpToId: number;
  /** `edit` replaces a user message on main; `fork` keeps the message. */
  kind: 'edit' | 'fork';
}

/**
 * Resolve where a branch left `main`. Returns null for `main`, or when the
 * branch has no recorded fork point.
 */
export function getBranchForkPoint(
  taskId: string,
  branchId: string,
): BranchForkPoint | null {
  if (branchId === 'main') return null;
  const db = getDatabase();
  const branchRow = db
    .prepare(
      `SELECT parent_message_id FROM messages
       WHERE task_id = ? AND branch_id = ? AND parent_message_id IS NOT NULL
       ORDER BY id ASC LIMIT 1`,
    )
    .get(taskId, branchId) as { parent_message_id: number } | undefined;
  if (!branchRow) return null;
  const parent = db
    .prepare(
      `SELECT id, type FROM messages
       WHERE task_id = ? AND id = ? AND COALESCE(branch_id, 'main') = 'main'`,
    )
    .get(taskId, branchRow.parent_message_id) as
    | { id: number; type: string }
    | undefined;
  if (!parent) return null;
  return forkPointFor(parent);
}

/**
 * A fork point on a user message is an edit: the branch replaces that
 * message, so it keeps only the rows before it. Any other fork point keeps
 * the message itself.
 */
function forkPointFor(parent: { id: number; type: string }): BranchForkPoint {
  const kind = parent.type === 'user' ? 'edit' : 'fork';
  return {
    parentMessageId: parent.id,
    keptUpToId: kind === 'edit' ? parent.id - 1 : parent.id,
    kind,
  };
}

export function getForkPointForMessage(
  taskId: string,
  messageId: number,
): BranchForkPoint | null {
  const parent = getDatabase()
    .prepare(
      `SELECT id, type FROM messages
       WHERE task_id = ? AND id = ? AND COALESCE(branch_id, 'main') = 'main'`,
    )
    .get(taskId, messageId) as { id: number; type: string } | undefined;
  return parent ? forkPointFor(parent) : null;
}

export type ForkParentResolution =
  | { kind: 'empty' }
  | { kind: 'session'; record: BranchSdkSessionRecord }
  | {
      kind: 'unavailable';
      reason:
        | 'no-recorded-session'
        | 'fork-point-mid-run'
        | 'fork-point-after-branch-output';
    };

/**
 * Find the main-branch SDK session whose end is exactly the fork point.
 *
 * Main runs each write their own SDK session, so a branch can fork one only
 * when the kept history ends on that run's last conversational row. A fork
 * point in the middle of a run has no matching SDK message id here and falls
 * back to the text path.
 */
export function resolveForkParent(
  taskId: string,
  forkPoint: BranchForkPoint,
): ForkParentResolution {
  const db = getDatabase();
  const last = db
    .prepare(
      `SELECT id, run_id FROM messages
       WHERE task_id = ? AND COALESCE(branch_id, 'main') = 'main' AND id <= ?
         AND ${CONVERSATION_ROW_FILTER}
         AND ${NON_MAIN_RUN_FILTER}
       ORDER BY id DESC LIMIT 1`,
    )
    .get(taskId, forkPoint.keptUpToId, taskId) as
    | { id: number; run_id: string | null }
    | undefined;
  // Branch runs currently persist their output with branch_id 'main' (#94),
  // so a "fork from here" point can be another branch's reply. Skipping those
  // rows above would then seed the fork from main's older turn, so a fork
  // must end on the chosen main row itself. An edit replaces a genuine main
  // user message (branch prompts carry their own branch_id), so branch rows
  // stored before it are not part of its history and are rightly skipped.
  if (forkPoint.kind === 'fork') {
    const lastAny = db
      .prepare(
        `SELECT id FROM messages
         WHERE task_id = ? AND COALESCE(branch_id, 'main') = 'main' AND id <= ?
           AND ${CONVERSATION_ROW_FILTER}
         ORDER BY id DESC LIMIT 1`,
      )
      .get(taskId, forkPoint.keptUpToId) as { id: number } | undefined;
    if (lastAny && lastAny.id !== last?.id) {
      return { kind: 'unavailable', reason: 'fork-point-after-branch-output' };
    }
  }
  if (!last) return { kind: 'empty' };
  if (!last.run_id) {
    return { kind: 'unavailable', reason: 'no-recorded-session' };
  }

  const row = db
    .prepare(
      `SELECT * FROM branch_sdk_sessions
       WHERE task_id = ? AND run_id = ? AND branch_id = 'main'
         AND mode != 'text' AND sdk_session_id IS NOT NULL`,
    )
    .get(taskId, last.run_id) as BranchSdkSessionRow | undefined;
  if (!row) return { kind: 'unavailable', reason: 'no-recorded-session' };

  const later = db
    .prepare(
      `SELECT 1 FROM messages
       WHERE task_id = ? AND run_id = ? AND id > ?
         AND ${CONVERSATION_ROW_FILTER}
       LIMIT 1`,
    )
    .get(taskId, last.run_id, last.id);
  if (later) return { kind: 'unavailable', reason: 'fork-point-mid-run' };

  return { kind: 'session', record: rowToRecord(row) };
}

/** Claude file tools whose edits are covered by SDK file checkpoints. */
export const CHECKPOINTED_FILE_TOOLS = [
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
] as const;

/**
 * Runs that made a checkpointed file edit after the fork point — the edits a
 * restore must undo. Branch copies carry no run_id and are not counted.
 */
export function listEditRunIdsAfterForkPoint(
  taskId: string,
  forkPoint: BranchForkPoint,
): string[] {
  const placeholders = CHECKPOINTED_FILE_TOOLS.map(() => '?').join(', ');
  const rows = getDatabase()
    .prepare(
      `SELECT DISTINCT run_id FROM messages
       WHERE task_id = ? AND id > ? AND run_id IS NOT NULL
         AND type = 'tool_use' AND tool_name IN (${placeholders})`,
    )
    .all(taskId, forkPoint.keptUpToId, ...CHECKPOINTED_FILE_TOOLS) as Array<{
    run_id: string;
  }>;
  return rows.map((row) => row.run_id);
}

/**
 * Recorded runs that started after the fork point, newest first — the order
 * their file checkpoints must be rewound to restore the fork-point state.
 * Only runs with a prompt checkpoint (Claude runs with file checkpointing)
 * are returned.
 */
export function listRunsAfterForkPoint(
  taskId: string,
  forkPoint: BranchForkPoint,
): BranchSdkSessionRecord[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT s.*, (
         SELECT MIN(m.id) FROM messages m
         WHERE m.task_id = s.task_id AND m.run_id = s.run_id
       ) AS first_row_id
       FROM branch_sdk_sessions s
       WHERE s.task_id = ? AND s.run_id IS NOT NULL
         AND s.mode != 'text' AND s.sdk_session_id IS NOT NULL
       ORDER BY s.id ASC`,
    )
    .all(taskId) as Array<
    BranchSdkSessionRow & { first_row_id: number | null }
  >;

  // Runs whose rows were all deleted (regenerate) still changed files; order
  // them by record id against the last run that started at or before the fork.
  let cutoffRecordId = 0;
  for (const row of rows) {
    if (row.first_row_id != null && row.first_row_id <= forkPoint.keptUpToId) {
      cutoffRecordId = row.id;
    }
  }
  return rows
    .filter((row) =>
      row.first_row_id != null
        ? row.first_row_id > forkPoint.keptUpToId
        : row.id > cutoffRecordId,
    )
    .filter((row) => row.prompt_sdk_uuid)
    .reverse()
    .map(rowToRecord);
}
