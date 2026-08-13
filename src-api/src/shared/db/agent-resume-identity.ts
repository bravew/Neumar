/**
 * Agent resume identity operations (07-06 sync plan, checkpoint 2).
 *
 * A native session id is only meaningful to the provider/runtime that minted
 * it, for the workspace it ran in. This module records that identity per task
 * when a run reports its durable session id, and lets /agent/resume refuse a
 * native resume whose identity no longer matches — falling back to a fresh
 * run instead of replaying a session id into the wrong SDK.
 */

import { getDatabase } from './index';

export interface AgentResumeIdentity {
  taskId: string;
  projectId?: string;
  providerId: string;
  runtimeId: string;
  modelId?: string;
  workspaceRoot?: string;
  nativeSessionId: string;
  handleKind:
    | 'opaque-id'
    | 'cli-thread-id'
    | 'acp-session-handle'
    | 'continue-latest';
  lastMessageId?: string;
  schemaVersion: 1;
  createdAt: string;
  lastSeenAt: string;
}

interface AgentResumeIdentityRow {
  task_id: string;
  provider_id: string;
  project_id: string | null;
  runtime_id: string | null;
  model_id: string | null;
  workspace_root: string | null;
  native_session_id: string;
  handle_kind: AgentResumeIdentity['handleKind'];
  last_message_id: string | null;
  schema_version: number;
  created_at: string;
  last_seen_at: string;
}

function rowToIdentity(row: AgentResumeIdentityRow): AgentResumeIdentity {
  return {
    taskId: row.task_id,
    projectId: row.project_id ?? undefined,
    providerId: row.provider_id,
    runtimeId: row.runtime_id ?? row.provider_id,
    modelId: row.model_id ?? undefined,
    workspaceRoot: row.workspace_root ?? undefined,
    nativeSessionId: row.native_session_id,
    handleKind: row.handle_kind,
    lastMessageId: row.last_message_id ?? undefined,
    schemaVersion: 1,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

export function getAgentResumeIdentity(
  taskId: string,
): AgentResumeIdentity | null {
  const row = getDatabase()
    .prepare('SELECT * FROM agent_resume_identities WHERE task_id = ?')
    .get(taskId) as AgentResumeIdentityRow | undefined;
  return row ? rowToIdentity(row) : null;
}

export interface UpsertAgentResumeIdentityInput {
  taskId: string;
  projectId?: string;
  providerId: string;
  runtimeId?: string;
  modelId?: string;
  workspaceRoot?: string;
  nativeSessionId: string;
  handleKind?: AgentResumeIdentity['handleKind'];
  lastMessageId?: string;
}

export function upsertAgentResumeIdentity(
  input: UpsertAgentResumeIdentityInput,
): void {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `INSERT INTO agent_resume_identities
         (task_id, project_id, provider_id, runtime_id, model_id, workspace_root,
          native_session_id, handle_kind, last_message_id, schema_version, created_at, last_seen_at)
       VALUES (@taskId, @projectId, @providerId, @runtimeId, @modelId, @workspaceRoot,
          @nativeSessionId, @handleKind, @lastMessageId, 1, @now, @now)
       ON CONFLICT(task_id) DO UPDATE SET
         project_id        = excluded.project_id,
         provider_id       = excluded.provider_id,
         runtime_id        = excluded.runtime_id,
         model_id          = excluded.model_id,
         workspace_root    = excluded.workspace_root,
         native_session_id = excluded.native_session_id,
         handle_kind       = excluded.handle_kind,
         last_message_id   = excluded.last_message_id,
         schema_version    = excluded.schema_version,
         last_seen_at      = excluded.last_seen_at`,
    )
    .run({
      taskId: input.taskId,
      projectId: input.projectId ?? null,
      providerId: input.providerId,
      runtimeId: input.runtimeId ?? input.providerId,
      modelId: input.modelId ?? null,
      workspaceRoot: input.workspaceRoot ?? null,
      nativeSessionId: input.nativeSessionId,
      handleKind: input.handleKind ?? 'opaque-id',
      lastMessageId: input.lastMessageId ?? null,
      now,
    });
}

export interface ResumeIdentityRequest {
  projectId?: string;
  providerId: string;
  runtimeId?: string;
  modelId?: string;
  workspaceRoot?: string;
  nativeSessionId: string;
  lastMessageId?: string;
}

/**
 * Compare a stored identity against a resume request. Returns the first
 * mismatching field name, or null when the native resume is safe.
 *
 * Model and workspace only block the resume when both sides are known — a
 * request that omits the model (inherit-from-env) must not invalidate an
 * otherwise-matching session.
 */
export function resumeIdentityMismatch(
  stored: AgentResumeIdentity,
  requested: ResumeIdentityRequest,
): string | null {
  if (stored.nativeSessionId !== requested.nativeSessionId) {
    return 'native_session_id';
  }
  if (stored.providerId !== requested.providerId) return 'provider';
  if (
    (stored.runtimeId ?? stored.providerId) !==
    (requested.runtimeId ?? requested.providerId)
  ) {
    return 'runtime';
  }
  if (
    stored.projectId &&
    requested.projectId &&
    stored.projectId !== requested.projectId
  ) {
    return 'project';
  }
  if (
    stored.modelId &&
    requested.modelId &&
    stored.modelId !== requested.modelId
  ) {
    return 'model';
  }
  if (
    stored.workspaceRoot &&
    requested.workspaceRoot &&
    stored.workspaceRoot !== requested.workspaceRoot
  ) {
    return 'workspace_root';
  }
  if (
    stored.lastMessageId &&
    requested.lastMessageId &&
    stored.lastMessageId !== requested.lastMessageId
  ) {
    return 'last_message_id';
  }
  return null;
}
