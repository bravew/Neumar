import { getDatabase } from '@/shared/db';

/**
 * Server-side persistence for the Video Mode agent dock conversation. The
 * frontend used to keep this only in `localStorage`, so history did not follow
 * the user across browsers/devices. We store the opaque message array as JSON
 * keyed by project id; the API layer validates the envelope and the frontend
 * owns the message shape.
 */

interface AgentHistoryRow {
  messages_json: string;
}

export function getVideoAgentHistory(projectId: string): unknown[] {
  const row = getDatabase()
    .prepare(
      'SELECT messages_json FROM video_agent_history WHERE project_id = ?',
    )
    .get(projectId) as AgentHistoryRow | undefined;
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.messages_json) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function setVideoAgentHistory(
  projectId: string,
  messages: unknown[],
  updatedAt: string,
): void {
  getDatabase()
    .prepare(
      `INSERT INTO video_agent_history (project_id, messages_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET
         messages_json = excluded.messages_json,
         updated_at = excluded.updated_at`,
    )
    .run(projectId, JSON.stringify(messages), updatedAt);
}
