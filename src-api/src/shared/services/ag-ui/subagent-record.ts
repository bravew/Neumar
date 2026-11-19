/**
 * The durable form of one sub-agent invocation.
 *
 * The persister writes it as the `content` of a `subagent` message row, and
 * the history route reads it back, so a reloaded thread shows the same cards
 * the live AG-UI stream built. Both sides go through this module so the
 * stored shape has one definition.
 */

import { z } from 'zod';

export const SUBAGENT_MESSAGE_TYPE = 'subagent';

export const SubagentRecordSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  parentSubagentRunId: z.string().optional(),
  parentToolCallId: z.string().optional(),
  status: z.enum(['running', 'completed', 'suspended', 'error']),
  /** Decisions the child is waiting on when it ended suspended. */
  interruptIds: z.array(z.string()).optional(),
  /** Epoch ms of the SUBAGENT_STARTED event. */
  startedAt: z.number().optional(),
  /** Epoch ms of the event that ended it. */
  endedAt: z.number().optional(),
  result: z.string().optional(),
  error: z
    .object({ message: z.string(), code: z.string().optional() })
    .optional(),
});

export type SubagentRecord = z.infer<typeof SubagentRecordSchema>;

/** A record together with the invocation id its row is stored under. */
export interface SubagentRun extends SubagentRecord {
  id: string;
}

/**
 * Row id for an invocation. The run id keeps two runs of one task apart if the
 * SDK ever reuses a task id.
 */
export function subagentMessageId(
  taskId: string,
  runId: string | undefined,
  subagentRunId: string,
): string {
  return `${taskId}_${runId ?? 'run'}_subagent_${subagentRunId}`;
}

/** A row whose content does not parse is dropped, not shown as an empty card. */
export function parseSubagentRecord(
  content: string | null,
): SubagentRecord | null {
  if (!content) return null;
  try {
    const parsed = SubagentRecordSchema.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
