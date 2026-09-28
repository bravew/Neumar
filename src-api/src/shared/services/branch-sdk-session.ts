/**
 * Conversation branches backed by forked Claude SDK sessions (issue #74).
 *
 * A branch's first Claude run forks the SDK session of the main-branch run
 * that ends at the fork point (`resume` + `forkSession`), so the branch keeps
 * that run's tool calls, tool results, and thinking. Later runs on the branch
 * resume the forked session. `main` keeps its existing per-run sessions with
 * text history. Runtimes without a fork API, fork points inside a run, and
 * branches without a recorded session use the plain-text history path.
 */

import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type {
  AgentMessage,
  AgentOptions,
  AgentProvider,
} from '@/core/agent/types';

import {
  getBranchForkPoint,
  getForkPointForMessage,
  getLatestBranchSdkSession,
  listRunsAfterForkPoint,
  recordBranchSdkSession,
  resolveForkParent,
  type BranchSdkSessionMode,
  type BranchSdkSessionRecord,
} from '@/shared/db/branch-sdk-sessions';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('BranchSdkSession');

export type BranchSession = NonNullable<AgentOptions['branchSession']>;

export type TextHistoryReason =
  | 'runtime-without-fork'
  | 'no-fork-point'
  | 'no-recorded-session'
  | 'fork-point-mid-run'
  | 'parent-session-missing'
  | 'branch-on-text-history'
  | 'branch-session-missing';

/** How a run's conversation context is supplied. */
export type BranchContextPlan =
  /** `main`: unchanged — a fresh SDK session per run plus text history. */
  | { path: 'main' }
  /** Branch run with nothing kept before it: a fresh SDK session. */
  | { path: 'sdk'; mode: 'fresh' }
  | {
      path: 'sdk';
      mode: 'fork';
      branchSession: Extract<BranchSession, { kind: 'fork' }>;
    }
  | {
      path: 'sdk';
      mode: 'resume';
      branchSession: Extract<BranchSession, { kind: 'resume' }>;
    }
  | { path: 'text'; reason: TextHistoryReason };

/**
 * Claude Code stores each session as `<config>/projects/<cwd-key>/<id>.jsonl`.
 * Checking for the transcript before forking or resuming keeps a missing
 * session (another machine, cleared history) on the text path instead of
 * failing every run on the branch.
 */
export function claudeSessionTranscriptExists(sessionId: string): boolean {
  const configDir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
  const projectsDir = join(configDir, 'projects');
  try {
    return readdirSync(projectsDir, { withFileTypes: true }).some(
      (entry) =>
        entry.isDirectory() &&
        existsSync(join(projectsDir, entry.name, `${sessionId}.jsonl`)),
    );
  } catch {
    return false;
  }
}

export interface ResolveBranchContextInput {
  taskId: string;
  branchId: string;
  provider: AgentProvider;
  sessionExists?: (sessionId: string) => boolean;
}

export function resolveBranchContextPlan({
  taskId,
  branchId,
  provider,
  sessionExists = claudeSessionTranscriptExists,
}: ResolveBranchContextInput): BranchContextPlan {
  if (branchId === 'main') return { path: 'main' };
  if (provider !== 'claude') {
    return { path: 'text', reason: 'runtime-without-fork' };
  }

  const latest = getLatestBranchSdkSession(taskId, branchId);
  if (latest) {
    if (latest.mode === 'text' || !latest.sdkSessionId) {
      return { path: 'text', reason: 'branch-on-text-history' };
    }
    if (!sessionExists(latest.sdkSessionId)) {
      return { path: 'text', reason: 'branch-session-missing' };
    }
    return {
      path: 'sdk',
      mode: 'resume',
      branchSession: { kind: 'resume', sessionId: latest.sdkSessionId },
    };
  }

  const forkPoint = getBranchForkPoint(taskId, branchId);
  if (!forkPoint) return { path: 'text', reason: 'no-fork-point' };
  const parent = resolveForkParent(taskId, forkPoint);
  if (parent.kind === 'empty') return { path: 'sdk', mode: 'fresh' };
  if (parent.kind === 'unavailable') {
    return { path: 'text', reason: parent.reason };
  }
  const parentSessionId = parent.record.sdkSessionId;
  if (!parentSessionId || !sessionExists(parentSessionId)) {
    return { path: 'text', reason: 'parent-session-missing' };
  }
  return {
    path: 'sdk',
    mode: 'fork',
    branchSession: { kind: 'fork', parentSessionId },
  };
}

export interface SdkSessionRecordingContext {
  taskId: string;
  branchId: string;
  runId: string;
  provider: AgentProvider;
  plan: BranchContextPlan;
  /** SDK session id the run was started with (`Options.sessionId`). */
  sdkSessionId: string;
  signal?: AbortSignal;
}

function recordModeFor(
  ctx: SdkSessionRecordingContext,
): { mode: BranchSdkSessionMode; sdkSessionId?: string } | null {
  const { plan } = ctx;
  if (plan.path === 'main') {
    // Main keeps its per-run sessions; only Claude ones can seed a fork.
    return ctx.provider === 'claude'
      ? { mode: 'fresh', sdkSessionId: ctx.sdkSessionId }
      : null;
  }
  // A branch run without a Claude SDK session pins the branch to text
  // history, so a later Claude run never forks past the branch's own turns.
  if (plan.path === 'text' || ctx.provider !== 'claude') {
    return { mode: 'text' };
  }
  if (plan.mode === 'resume') {
    return { mode: 'resume', sdkSessionId: plan.branchSession.sessionId };
  }
  // A fork or fresh run writes the session id it was started with.
  return { mode: plan.mode, sdkSessionId: ctx.sdkSessionId };
}

/**
 * Pass the run's messages through and, when it finishes without an error,
 * record the SDK session it wrote. Also captures the first replayed user
 * message UUID (the prompt's file checkpoint) and the SDK working directory,
 * which a later "Fork and restore files" needs to rewind this run.
 */
export async function* withBranchSdkSessionRecording(
  stream: AsyncGenerator<AgentMessage>,
  ctx: SdkSessionRecordingContext,
): AsyncGenerator<AgentMessage> {
  let promptSdkUuid: string | undefined;
  let cwd: string | undefined;
  let failed = false;
  for await (const message of stream) {
    if (message.type === 'error') failed = true;
    if (
      message.type === 'system' &&
      message.subtype === 'user_checkpoint' &&
      !promptSdkUuid &&
      message.id
    ) {
      promptSdkUuid = message.id;
    }
    if (message.type === 'session' && !cwd) {
      cwd = (message as AgentMessage & { cwd?: string }).cwd;
    }
    yield message;
  }
  if (failed || ctx.signal?.aborted) return;

  const record = recordModeFor(ctx);
  if (!record) return;
  try {
    recordBranchSdkSession({
      taskId: ctx.taskId,
      branchId: ctx.branchId,
      runId: ctx.runId,
      provider: ctx.provider,
      mode: record.mode,
      sdkSessionId: record.sdkSessionId,
      forkedFromSessionId:
        ctx.plan.path === 'sdk' && ctx.plan.mode === 'fork'
          ? ctx.plan.branchSession.parentSessionId
          : undefined,
      promptSdkUuid,
      cwd,
    });
  } catch (err) {
    // Best-effort: without a record the branch keeps the text history path.
    logger.warn('Failed to record branch SDK session', {
      taskId: ctx.taskId,
      branchId: ctx.branchId,
      runId: ctx.runId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Pin a branch to the text history path. Regenerate truncates the branch's
 * messages, but its SDK session still holds the discarded reply.
 */
export function invalidateBranchSdkSession(
  taskId: string,
  branchId: string,
): void {
  if (branchId === 'main') return;
  const latest = getLatestBranchSdkSession(taskId, branchId);
  if (!latest || latest.mode === 'text') return;
  recordBranchSdkSession({
    taskId,
    branchId,
    provider: latest.provider,
    mode: 'text',
  });
}

export interface RestoreFilesResult {
  /** Runs whose tracked file edits were rewound. */
  rewoundRuns: number;
  /** Runs the SDK could not rewind (for example, no tracked edits). */
  skippedRuns: number;
  filesChanged: string[];
}

export type RewindRunFiles = (
  record: BranchSdkSessionRecord,
) => Promise<{ canRewind: boolean; error?: string; filesChanged?: string[] }>;

export class RestoreFilesError extends Error {}

/**
 * Restore files edited through Claude's file checkpoints to their state at a
 * fork point by rewinding every later run, newest first. Bash and other shell
 * side effects are not tracked by checkpoints and stay as they are.
 */
export async function restoreFilesToForkPoint(
  taskId: string,
  messageId: number,
  rewind: RewindRunFiles = rewindClaudeRunFiles,
): Promise<RestoreFilesResult> {
  const forkPoint = getForkPointForMessage(taskId, messageId);
  if (!forkPoint) {
    throw new RestoreFilesError('Fork point is not on the main branch');
  }
  const runs = listRunsAfterForkPoint(taskId, forkPoint);
  const filesChanged = new Set<string>();
  let rewoundRuns = 0;
  let skippedRuns = 0;
  for (const run of runs) {
    const result = await rewind(run);
    if (!result.canRewind) {
      skippedRuns++;
      logger.warn('Run files not rewound', {
        taskId,
        runId: run.runId,
        error: result.error,
      });
      continue;
    }
    rewoundRuns++;
    for (const file of result.filesChanged ?? []) filesChanged.add(file);
  }
  logger.info('Restored files to fork point', {
    taskId,
    messageId,
    candidateRuns: runs.length,
    rewoundRuns,
    skippedRuns,
    filesChanged: filesChanged.size,
  });
  return { rewoundRuns, skippedRuns, filesChanged: [...filesChanged] };
}

const REWIND_TIMEOUT_MS = 30_000;

/**
 * Rewind one run's tracked files through its SDK session. The prompt stream
 * stays open and empty, so the CLI answers the control request without
 * starting a turn (and without appending to the session).
 */
async function rewindClaudeRunFiles(
  record: BranchSdkSessionRecord,
): ReturnType<RewindRunFiles> {
  if (!record.sdkSessionId || !record.promptSdkUuid) {
    return { canRewind: false };
  }
  const [{ query }, { ensureClaudeCode }] = await Promise.all([
    import('@anthropic-ai/claude-agent-sdk/core'),
    import('@/extensions/agent/claude'),
  ]);
  const claudeCodePath = await ensureClaudeCode();
  if (!claudeCodePath) {
    throw new RestoreFilesError('Claude Code is not installed');
  }

  let releasePrompt!: () => void;
  const promptHeld = new Promise<void>((resolve) => {
    releasePrompt = resolve;
  });
  const prompt: AsyncIterable<never> = {
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        await promptHeld;
        return { done: true, value: undefined };
      },
    }),
  };
  const rewindQuery = query({
    prompt,
    options: {
      resume: record.sdkSessionId,
      ...(record.cwd ? { cwd: record.cwd } : {}),
      enableFileCheckpointing: true,
      extraArgs: { 'replay-user-messages': null },
      pathToClaudeCodeExecutable: claudeCodePath,
      abortController: new AbortController(),
    },
  });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new RestoreFilesError('File restore timed out')),
      REWIND_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([
      rewindQuery.rewindFiles(record.promptSdkUuid),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
    releasePrompt();
    rewindQuery.close();
  }
}
