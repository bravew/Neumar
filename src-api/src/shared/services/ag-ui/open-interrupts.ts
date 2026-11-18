/**
 * Every decision a task is waiting on, from the records that own them: the
 * pending plan, unanswered agent questions, and tool permissions an adapter
 * is blocked on. A caller that lost the live stream (reload, task switch)
 * rebuilds its prompts from this list.
 */

import type { Interrupt } from '@ag-ui/core';

import {
  agentQuestionService,
  serializeAgentQuestion,
} from '@/core/agent/questions';
import { listOpenHostPermissions } from '@/core/agent/tool-permission-registry';

import { permissionInterrupt, questionInterrupt } from './interrupts';
import { listPlanInterrupts } from './plan-decisions';

export async function listOpenInterrupts(
  taskId: string,
  now: number = Date.now(),
): Promise<Interrupt[]> {
  // Loaded on demand: the adapter pulls in the Claude SDK, which a caller
  // that only needs plans and questions should not pay for.
  const { listOpenClaudePermissions } =
    await import('@/extensions/agent/claude/index');

  const questions = agentQuestionService
    .getPendingQuestions({ taskId })
    .map(serializeAgentQuestion)
    .filter(
      (question) => !question.expiresAt || Date.parse(question.expiresAt) > now,
    );

  return [
    ...listPlanInterrupts(taskId),
    ...questions.map(questionInterrupt),
    ...listOpenClaudePermissions(taskId).map(permissionInterrupt),
    ...listOpenHostPermissions(taskId).map(permissionInterrupt),
  ];
}
