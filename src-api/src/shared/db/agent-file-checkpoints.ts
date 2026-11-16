import { getDatabase } from './index';

export interface AgentFileCheckpoint {
  taskId: string;
  messageRowId: number;
  userMessageId: string;
  sdkSessionId: string;
  cwd: string | null;
}

interface CheckpointRow {
  task_id: string;
  message_row_id: number;
  user_message_id: string;
  sdk_session_id: string;
  cwd: string | null;
}

function fromRow(row: CheckpointRow): AgentFileCheckpoint {
  return {
    taskId: row.task_id,
    messageRowId: row.message_row_id,
    userMessageId: row.user_message_id,
    sdkSessionId: row.sdk_session_id,
    cwd: row.cwd,
  };
}

export function latestUserMessageRowId(
  taskId: string,
  runId?: string,
): number | null {
  const row = getDatabase()
    .prepare(
      `SELECT id FROM messages
       WHERE task_id = ? AND type = 'user' AND COALESCE(subtype, '') != 'question_answer'
         AND (? IS NULL OR run_id = ?)
       ORDER BY id DESC LIMIT 1`,
    )
    .get(taskId, runId ?? null, runId ?? null) as { id: number } | undefined;
  return row?.id ?? null;
}

export function recordAgentFileCheckpoint(input: AgentFileCheckpoint): void {
  // Keep the first checkpoint recorded for a user turn. Retries reuse the same
  // message row, and the retry's baseline already contains the previous
  // attempt's edits, so replacing the original would make "rewind to before
  // this turn" restore a later state. A stale session fails the rewind's dry
  // run instead, which refuses before writing anything.
  getDatabase()
    .prepare(
      `INSERT INTO agent_file_checkpoints
         (task_id, message_row_id, user_message_id, sdk_session_id, cwd)
       SELECT ?, id, ?, ?, ? FROM messages
       WHERE id = ? AND task_id = ? AND type = 'user'
       ON CONFLICT(task_id, message_row_id) DO NOTHING`,
    )
    .run(
      input.taskId,
      input.userMessageId,
      input.sdkSessionId,
      input.cwd,
      input.messageRowId,
      input.taskId,
    );
}

export function listAgentFileCheckpoints(
  taskId: string,
): AgentFileCheckpoint[] {
  const rows = getDatabase()
    .prepare(
      `SELECT c.* FROM agent_file_checkpoints c
       JOIN messages m ON m.id = c.message_row_id
       WHERE c.task_id = ? AND COALESCE(m.branch_id, 'main') = 'main'
       ORDER BY c.message_row_id`,
    )
    .all(taskId) as CheckpointRow[];
  return rows.map(fromRow);
}

export function hasUnrecordedUserTurnsSince(
  taskId: string,
  messageRowId: number,
): boolean {
  const row = getDatabase()
    .prepare(
      `SELECT 1 FROM messages m
       LEFT JOIN agent_file_checkpoints c ON c.message_row_id = m.id
       WHERE m.task_id = ? AND m.id >= ? AND m.type = 'user'
         AND COALESCE(m.subtype, '') != 'question_answer'
         AND COALESCE(m.branch_id, 'main') = 'main'
         AND c.message_row_id IS NULL LIMIT 1`,
    )
    .get(taskId, messageRowId);
  return Boolean(row);
}

export function getAgentFileCheckpoint(
  taskId: string,
  userMessageId: string,
): AgentFileCheckpoint | null {
  const row = getDatabase()
    .prepare(
      `SELECT c.* FROM agent_file_checkpoints c
       JOIN messages m ON m.id = c.message_row_id
       WHERE c.task_id = ? AND c.user_message_id = ?
         AND COALESCE(m.branch_id, 'main') = 'main'`,
    )
    .get(taskId, userMessageId) as CheckpointRow | undefined;
  return row ? fromRow(row) : null;
}
