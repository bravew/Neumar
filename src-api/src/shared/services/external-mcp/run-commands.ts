import { deriveExecutionOutcomes, questionRunIds } from '@/app/api/runs';

import { prepareTaskRun } from '@/core/agent/prepare-task-run';
import { RunContextError } from '@/core/agent/run-context';

import { DEFAULT_AGENT_PROVIDER } from '@/config/constants';

import {
  AgentRunConflictError,
  type AgentRunRow,
  finishAgentRun,
  getAgentProfile,
  getAgentRun,
  getAgentRunsByTaskId,
  getPendingAgentQuestions,
  getTask,
} from '@/shared/db/operations';
import { ExternalMcpError } from '@/shared/mcp/public-server/errors';
import {
  cancelAgentRunOutputSchema,
  getAgentRunOutputSchema,
  startAgentRunOutputSchema,
} from '@/shared/mcp/public-server/schemas';
import { activeQueryStore } from '@/shared/services/active-query-store';
import { deleteSession } from '@/shared/services/agent';
import { errorMessage } from '@/shared/utils/errors';
import { createLogger } from '@/shared/utils/logger';

import { withIdempotencyAsync } from './idempotency';
import { requireUuid } from './policy';

const logger = createLogger('ExternalMcpRuns');

export interface ExternalMcpRunLaunch {
  taskId: string;
  prompt: string;
  runId: string;
  profileId?: string;
  provider: string;
  model?: string;
}

type RunLauncher = (input: ExternalMcpRunLaunch) => void;

let runLauncher: RunLauncher | null = null;

export function registerExternalMcpRunLauncher(launch: RunLauncher): void {
  runLauncher = launch;
}

function mapRunContextError(error: RunContextError): never {
  const code =
    error.status === 404
      ? 'NOT_FOUND'
      : error.status === 409
        ? 'CONFLICT'
        : 'VALIDATION_FAILED';
  throw new ExternalMcpError(code, error.message);
}

function resolveOwnedRuntime(
  profileId: string | undefined,
  taskAssignee?: string | null,
) {
  const id = profileId ?? taskAssignee ?? undefined;
  if (!id) {
    return {
      provider: DEFAULT_AGENT_PROVIDER,
      model: undefined as string | undefined,
    };
  }
  requireUuid(id, 'profileId');
  const profile = getAgentProfile(id);
  if (!profile) {
    throw new ExternalMcpError('NOT_FOUND', 'Agent profile not found');
  }
  return {
    provider: profile.runtime_id || DEFAULT_AGENT_PROVIDER,
    model: profile.default_model ?? undefined,
  };
}

function publicStatus(run: AgentRunRow, awaitingInput: boolean): string {
  if (run.status === 'running')
    return awaitingInput ? 'awaiting_input' : 'active';
  if (run.status === 'completed') return 'succeeded';
  return run.status;
}

function inspectRun(run: AgentRunRow) {
  const rows = getAgentRunsByTaskId(run.task_id);
  const outcome = deriveExecutionOutcomes(rows, questionRunIds(rows)).find(
    (item) => item.executionId === run.execution_id,
  );
  const pending = getPendingAgentQuestions({ taskId: run.task_id }).length > 0;
  const awaitingInput = pending || outcome?.status === 'awaiting_input';
  return {
    runId: run.id,
    taskId: run.task_id,
    status: outcome?.status ?? publicStatus(run, awaitingInput),
    awaitingInput,
    costUsd: Number.isFinite(run.cost_usd) ? run.cost_usd : null,
    error: run.error ?? null,
  };
}

export async function startAgentRunCommand(input: {
  requestId: string;
  taskId: string;
  profileId?: string;
}) {
  requireUuid(input.requestId, 'requestId');
  requireUuid(input.taskId, 'taskId');

  return withIdempotencyAsync(
    'start_agent_run',
    input.requestId,
    { taskId: input.taskId, profileId: input.profileId ?? null },
    async () => {
      const task = getTask(input.taskId);
      if (!task) throw new ExternalMcpError('NOT_FOUND', 'Task not found');
      const prompt = task.prompt.trim();
      if (!prompt) {
        throw new ExternalMcpError('VALIDATION_FAILED', 'Task has no prompt');
      }
      const runtime = resolveOwnedRuntime(
        input.profileId,
        task.assignee_profile_id,
      );
      let prepared;
      try {
        prepared = await prepareTaskRun({
          taskId: input.taskId,
          prompt,
          provider: runtime.provider,
          model: runtime.model,
          runContext: { clientRequestId: input.requestId },
        });
      } catch (error) {
        if (error instanceof RunContextError) mapRunContextError(error);
        if (error instanceof AgentRunConflictError) {
          throw new ExternalMcpError(
            'CONFLICT',
            error.message,
            input.requestId,
          );
        }
        throw error;
      }
      const runId = prepared.agentRunId;
      if (!runId || !prepared.reservation) {
        throw new ExternalMcpError('VALIDATION_FAILED', 'Run was not reserved');
      }
      if (prepared.reservation.disposition === 'created') {
        try {
          runLauncher?.({
            taskId: input.taskId,
            prompt,
            runId,
            profileId: input.profileId,
            provider: runtime.provider,
            model: runtime.model,
          });
        } catch (error) {
          logger.error('Failed to launch MCP agent run', errorMessage(error));
          finishAgentRun({
            id: runId,
            status: 'failed',
            error: 'Failed to launch agent run',
          });
        }
      }
      return startAgentRunOutputSchema.parse({
        runId,
        taskId: input.taskId,
        status: publicStatus(prepared.reservation.run, false),
      });
    },
  );
}

export function getAgentRunCommand(runId: string) {
  requireUuid(runId, 'runId');
  const run = getAgentRun(runId);
  if (!run) throw new ExternalMcpError('NOT_FOUND', 'Agent run not found');
  return getAgentRunOutputSchema.parse(inspectRun(run));
}

export function cancelAgentRunCommand(runId: string) {
  requireUuid(runId, 'runId');
  const run = getAgentRun(runId);
  if (!run) throw new ExternalMcpError('NOT_FOUND', 'Agent run not found');
  if (run.status === 'running') {
    const sessionId = activeQueryStore.getSessionId(run.task_id);
    if (sessionId) {
      try {
        deleteSession(sessionId);
      } catch (error) {
        logger.warn(
          'Failed to stop agent session for MCP cancel',
          errorMessage(error),
        );
      }
    }
    finishAgentRun({ id: runId, status: 'cancelled' });
  }
  const latest = getAgentRun(runId) ?? run;
  return cancelAgentRunOutputSchema.parse({
    runId,
    status: publicStatus(latest, false),
  });
}
