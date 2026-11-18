import type { AGUIMessage } from '@/components/task/TaskV2MessageBubble.types';

/** What the planning `status` activity carries (see AGUIEmitter.planningActivity). */
export interface StatusActivity {
  phase: string;
  message?: string;
  elapsedMs?: number;
}

/**
 * Read a `status` activity message's payload.
 *
 * An activity message stores an object in `content`, which `AGUIMessage`
 * types as text for every other role, so the payload is validated here rather
 * than trusted. Returns null for any other message, a sub-agent's activity
 * (it renders with that sub-agent, not in the main thread), or a payload
 * without a string `phase`.
 */
export function readStatusActivity(msg: AGUIMessage): StatusActivity | null {
  if (msg.role !== 'activity' || msg.activityType !== 'status') return null;
  if (msg.subagentRunId) return null;
  const content: unknown = msg.content;
  if (typeof content !== 'object' || content === null) return null;
  const { phase, message, elapsedMs } = content as Record<string, unknown>;
  if (typeof phase !== 'string') return null;
  return {
    phase,
    message: typeof message === 'string' ? message : undefined,
    elapsedMs:
      typeof elapsedMs === 'number' && Number.isFinite(elapsedMs)
        ? elapsedMs
        : undefined,
  };
}
