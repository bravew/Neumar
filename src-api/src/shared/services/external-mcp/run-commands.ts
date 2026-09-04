import { deriveExecutionOutcomes, questionRunIds } from '@/app/api/runs';

import { getAvailableProviders } from '@/core/agent';
import { prepareTaskRun } from '@/core/agent/prepare-task-run';
import { RunContextError } from '@/core/agent/run-context';
import { normalizeAgentType } from '@/core/agent/runtime-ids';
import type { AgentProvider } from '@/core/agent/types';

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
  provider: AgentProvider;
  model?: string;
}

type RunLauncher = (input: ExternalMcpRunLaunch) => void;

let runLauncher: RunLauncher | null = null;
const activeRunSessions = new Map<string, string>();

export function registerExternalMcpRunLauncher(launch: RunLauncher): void {
  runLauncher = launch;
}

/** Bind an in-process agent session to its durable external MCP run. */
export function registerExternalMcpRunSession(
  runId: string,
  sessionId: string,
): () => void {
  activeRunSessions.set(runId, sessionId);
  return () => {
    if (activeRunSessions.get(runId) === sessionId) {
      activeRunSessions.delete(runId);
    }
  };
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
): { provider: AgentProvider; model: string | undefined } {
  const id = profileId ?? taskAssignee ?? undefined;
  if (!id) {
    return {
      provider: DEFAULT_AGENT_PROVIDER,
      model: undefined,
    };
  }
  requireUuid(id, 'profileId');
  const profile = getAgentProfile(id);
  if (!profile) {
    throw new ExternalMcpError('NOT_FOUND', 'Agent profile not found');
  }
  const runtimeId = normalizeAgentType(
    profile.runtime_id || DEFAULT_AGENT_PROVIDER,
  );
  const provider = getAvailableProviders().find(
    (available) => available === runtimeId,
  );
  if (!provider) {
    throw new ExternalMcpError(
      'VALIDATION_FAILED',
      'Agent profile runtime is not supported',
    );
  }
  return {
    provider,
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
      let run = prepared.reservation.run;
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
          run = getAgentRun(runId) ?? { ...run, status: 'failed' };
        }
      }
      return startAgentRunOutputSchema.parse({
        runId,
        taskId: input.taskId,
        status: publicStatus(run, false),
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
    const sessionId = activeRunSessions.get(runId);
    if (sessionId) {
      activeRunSessions.delete(runId);
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
