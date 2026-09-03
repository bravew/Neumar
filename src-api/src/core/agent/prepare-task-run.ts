import type { z } from 'zod';

import {
  resolveRunContext,
  RunContextError,
  type RunContextEnvelopeInputSchema,
} from '@/core/agent/run-context';

import {
  type ReserveAgentRunResult,
  reserveAgentRun,
} from '@/shared/db/operations';

export interface PrepareTaskRunInput {
  taskId?: string;
  prompt: string;
  provider: string;
  model?: string;
  pinnedSkills?: string[];
  supplementalSkillIds?: string[];
  runContext?: z.infer<typeof RunContextEnvelopeInputSchema>;
}

export interface PreparedTaskRun {
  agentRunId: string | undefined;
  pinnedSkills: string[] | undefined;
  reservation: ReserveAgentRunResult | undefined;
}

/**
 * Persist a durable agent-run reservation before any SSE stream starts.
 * Shared by POST /agent and the inbound MCP start-run command.
 */
export async function prepareTaskRun(
  input: PrepareTaskRunInput,
): Promise<PreparedTaskRun> {
  if (!input.taskId) {
    if (input.supplementalSkillIds?.length || input.runContext) {
      throw new RunContextError(
        'taskId is required when a run context is supplied',
        400,
      );
    }
    return {
      agentRunId: undefined,
      pinnedSkills: input.pinnedSkills,
      reservation: undefined,
    };
  }
  const context = await resolveRunContext({
    mode: 'task',
    ownerKey: input.taskId,
    envelope: input.runContext,
    legacyPinnedSkills: [
      ...(input.supplementalSkillIds ?? []),
      ...(input.pinnedSkills ?? []),
    ],
  });
  const agentRunId = crypto.randomUUID();
  const reservation = reserveAgentRun({
    runId: agentRunId,
    mode: context.mode,
    ownerKey: context.ownerKey,
    projectId: context.projectId,
    conversationId: context.conversationId,
    clientRequestId: context.clientRequestId,
    requestMessageId: context.messageId,
    messageContent: input.prompt,
    provider: input.provider,
    model: input.model,
    recovery: context.recovery,
  });
  return {
    agentRunId:
      reservation.disposition === 'existing' ? reservation.run.id : agentRunId,
    pinnedSkills: context.supplementalSkillIds,
    reservation,
  };
}
