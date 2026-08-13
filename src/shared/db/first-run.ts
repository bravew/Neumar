/**
 * First-run / demo-bootstrap helpers.
 *
 * The flow is `SetupGuard → Onboarding → QuickStartWizard → first task`. The
 * source of truth for "have we finished onboarding for this profile?" lives
 * in two settings keys, not in any new bootstrap-state table:
 *
 *   - `firstRunCompletedAt`  — ISO timestamp of the first time the user
 *     reached the post-quickstart state.
 *   - `demoSeededAt`         — ISO timestamp of when the demo task was
 *     seeded. We refuse to seed twice unless the dev/QA reset hatch is set.
 */

import {
  DEMO_SEEDED_AT_KEY,
  FIRST_RUN_COMPLETED_AT_KEY,
  getSettingItem,
  saveSettingItem,
} from '@/shared/db/settings';
import { randomUUID } from '@/shared/utils/uuid';

import { createSession, createTask } from './database';

const DEMO_SESSION_ID_KEY = 'demoSessionId';
const DEMO_TASK_ID_KEY = 'demoTaskId';

const DEMO_PROMPT =
  'Show me what neuma can do — pick one of the bundled skills and run a small ' +
  'demo. Summarize the result and link to any artifacts you produce.';

export async function getFirstRunCompletedAt(): Promise<string | null> {
  return getSettingItem(FIRST_RUN_COMPLETED_AT_KEY);
}

export async function markFirstRunCompleted(): Promise<void> {
  const existing = await getSettingItem(FIRST_RUN_COMPLETED_AT_KEY);
  if (existing) return;
  await saveSettingItem(FIRST_RUN_COMPLETED_AT_KEY, new Date().toISOString());
}

export async function getDemoSeededAt(): Promise<string | null> {
  return getSettingItem(DEMO_SEEDED_AT_KEY);
}

/**
 * Seed a single demo task once. Idempotent: subsequent calls are no-ops
 * unless `process.env.NEUMA_RESET_DEMO === '1'` (Vite-injected) is set, in
 * which case existing markers are ignored.
 */
export async function seedDemoIfNeeded(): Promise<{
  seeded: boolean;
  sessionId?: string;
  taskId?: string;
}> {
  const resetRequested =
    typeof import.meta !== 'undefined' &&
    import.meta.env?.VITE_NEUMA_RESET_DEMO === '1';

  const existing = await getSettingItem(DEMO_SEEDED_AT_KEY);
  if (existing && !resetRequested) return { seeded: false };

  const sessionId = `demo-${randomUUID()}`;
  const taskId = `demo-task-${randomUUID()}`;
  try {
    await createSession({ id: sessionId, prompt: DEMO_PROMPT });
    await createTask({
      id: taskId,
      session_id: sessionId,
      task_index: 0,
      prompt: DEMO_PROMPT,
    });
    await saveSettingItem(DEMO_SEEDED_AT_KEY, new Date().toISOString());
    await saveSettingItem(DEMO_SESSION_ID_KEY, sessionId);
    await saveSettingItem(DEMO_TASK_ID_KEY, taskId);
    return { seeded: true, sessionId, taskId };
  } catch (err) {
    if (import.meta.env.DEV)
      console.warn('[FirstRun] demo seed failed (non-fatal):', err);
    return { seeded: false };
  }
}
