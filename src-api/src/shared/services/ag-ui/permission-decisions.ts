/**
 * Tool-permission decisions as standard AG-UI interrupts.
 *
 * Unlike a plan, a permission has no durable row: the decision is a promise the
 * adapter holds in memory. Answering it settles that promise, so an answer is
 * only possible while the process that asked is alive and still waiting.
 */

import { answerPermissionRequest } from '@/core/agent/answer-permission';
import { findOpenPermissionWait } from '@/core/agent/permission-waits';

import {
  parseDecisionInterruptId,
  parseDecisionResponse,
  type ResumeEntryInput,
} from './interrupts';

export interface PermissionAnswer {
  interruptId: string;
  requestId: string;
  sessionId: string;
  approved: boolean;
  alwaysAllow?: boolean;
}

export type PermissionValidation =
  | { kind: 'valid'; answers: PermissionAnswer[] }
  /** No adapter is waiting on it: answered elsewhere, expired, or the process restarted. */
  | { kind: 'unavailable'; interruptId: string }
  | { kind: 'wrong_thread'; interruptId: string }
  | { kind: 'invalid_response'; interruptId: string; error: string };

/**
 * Checks every entry against the prompts adapters are still blocked on before
 * any is applied, so one bad entry cannot leave a batch half answered.
 */
export function validatePermissionEntries(
  taskId: string,
  entries: ResumeEntryInput[],
): PermissionValidation {
  const answers: PermissionAnswer[] = [];
  for (const entry of entries) {
    const parsed = parseDecisionInterruptId(entry.interruptId);
    const open =
      parsed?.kind === 'permission'
        ? findOpenPermissionWait(parsed.sourceId)
        : undefined;
    if (!parsed || !open) {
      return { kind: 'unavailable', interruptId: entry.interruptId };
    }
    if (open.taskId !== taskId) {
      return { kind: 'wrong_thread', interruptId: entry.interruptId };
    }
    const target = {
      interruptId: entry.interruptId,
      requestId: parsed.sourceId,
      sessionId: open.sessionId,
    };

    if (entry.status === 'cancelled') {
      answers.push({ ...target, approved: false });
      continue;
    }
    const response = parseDecisionResponse('permission', entry.payload);
    if (!response.ok) {
      return {
        kind: 'invalid_response',
        interruptId: entry.interruptId,
        error: response.error,
      };
    }
    answers.push({
      ...target,
      approved: response.response.approved,
      alwaysAllow: response.response.alwaysAllow,
    });
  }
  return { kind: 'valid', answers };
}

/**
 * Settles the prompts. Returns the interrupt ids whose prompt was already gone
 * when its answer arrived, because another client answered it first.
 */
export async function applyPermissionAnswers(
  answers: PermissionAnswer[],
): Promise<string[]> {
  const lost: string[] = [];
  for (const answer of answers) {
    const applied = await answerPermissionRequest({
      requestId: answer.requestId,
      approved: answer.approved,
      alwaysAllow: answer.alwaysAllow,
      sessionId: answer.sessionId,
    });
    if (!applied) lost.push(answer.interruptId);
  }
  return lost;
}
