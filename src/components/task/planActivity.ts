import type { AGUIMessage } from '@/components/task/TaskV2MessageBubble.types';

/**
 * What the plan/checklist `plan` activity carries (see AGUIEmitter.planActivity).
 * The server sends the plan at approval time and again when its execution run
 * starts, then patches `phase` when the work ends.
 */
export interface PlanActivityStep {
  id?: string;
  description: string;
  status: string;
}

export interface PlanActivity {
  phase: string;
  goal: string;
  steps: PlanActivityStep[];
}

/**
 * Read a `plan` activity message's payload.
 *
 * An activity message stores an object in `content`, which `AGUIMessage` types
 * as text for every other role, so the payload is validated here. Returns null
 * for any other message, a sub-agent's activity (it renders with that
 * sub-agent), or a payload without a goal and step list.
 */
export function readPlanActivity(msg: AGUIMessage): PlanActivity | null {
  if (msg.role !== 'activity' || msg.activityType !== 'plan') return null;
  if (msg.subagentRunId) return null;
  const content: unknown = msg.content;
  if (typeof content !== 'object' || content === null) return null;
  const { phase, goal, steps } = content as Record<string, unknown>;
  if (typeof phase !== 'string' || typeof goal !== 'string') return null;
  if (!Array.isArray(steps)) return null;
  const parsed: PlanActivityStep[] = [];
  for (const step of steps) {
    if (!step || typeof step !== 'object') return null;
    const { id, description, status } = step as Record<string, unknown>;
    if (typeof description !== 'string' || typeof status !== 'string') {
      return null;
    }
    parsed.push({
      description,
      status,
      ...(typeof id === 'string' ? { id } : {}),
    });
  }
  return { phase, goal, steps: parsed };
}
