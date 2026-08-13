/**
 * Pipeline Orchestrator
 *
 * Autonomous ticket-to-PR pipeline. Functional pattern with module-level state.
 * Pipeline state is persisted to ~/.<slug>/pipeline-state.json to survive restarts.
 */

import { exec, execFile } from 'child_process';
import fs from 'fs/promises';
import { dirname, join } from 'path';
import { promisify } from 'util';

import type { SandboxConfig } from '@/core/agent';

import {
  getAppDir,
  PIPELINE_PHASE_TIMEOUT_MS,
  PIPELINE_STATE_TTL_MS,
  PIPELINE_TOTAL_TIMEOUT_MS,
  PR_REVIEW_MAX_FIX_ITERATIONS,
  PR_REVIEW_POLL_INTERVAL_MS,
  PR_REVIEW_WINDOW_MS,
} from '@/config/constants';

import { getProviderManager } from '@/shared/provider/manager';
import {
  createSession,
  runAgent,
  runExecutionPhase,
  runPlanningPhase,
} from '@/shared/services/agent';
import { createLogger } from '@/shared/utils/logger';
import { sleep } from '@/shared/utils/sleep';

import {
  fetchFigmaDesignData,
  formatDesignData,
  resolveFigmaFromTicket,
} from '../figma-resolver';
import {
  cleanupWorktree,
  createTaskWorktree,
  ensureBaseRepo,
  initializeWorktreeForClaude,
  installDependencies,
} from '../git-workspace';
import type { LinearIssue } from '../linear';
import {
  addIssueComment,
  createAttachment,
  ensureAssignedToAgent,
  getTeamStates,
  triageIssue,
  updateIssueState,
} from '../linear';
import type { AgentCapabilities, LinearConfig } from '../linear-config';
import { getLinearConfig } from '../linear-config';
import { sendSlackNotification } from '../slack';
import { updateShellAliases } from '../worktree-aliases';
import type { AgentRole, RunRoleAgentOptions } from './agents';
import { runRoleAgent } from './agents';
import { checkBudget, recordTicketCost } from './budget';
import { onPhaseTransition, type PipelinePhaseContext } from './hooks';
import {
  initializeOrchestrator,
  runCIMonitorPhase,
  runConfidenceGate,
  runResearchPhase,
} from './orchestrator';
import {
  formatProgressForAgent,
  readProgress,
  recordPhaseCompletion,
  writeProgress,
} from './progress';
import type { DesignContext } from './prompts';
import {
  buildPRBody,
  buildPromptForIssue,
  buildPRReviewFixPrompt,
  buildSelfReviewPrompt,
  buildVerificationPrompt,
  gatherTicketContext,
  getRepoContext,
} from './prompts';
import { resolveRepoFromTicket } from './repo-resolver';
import { createSwarmTask, updateSwarmTask } from './swarm-task';

// GitHub API response shapes (used in review polling)
interface GitHubReview {
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED';
  submitted_at: string;
}

interface GitHubComment {
  user?: { login?: string };
  body: string;
  path?: string;
  line?: number;
  created_at: string;
}

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const logger = createLogger('Pipeline');

/** Resolve model config from provider settings for agent calls. */
function getModelConfig():
  | { apiKey?: string; baseUrl?: string; model?: string }
  | undefined {
  try {
    const config = getProviderManager().getConfig();
    const agentConfig = config.agent?.config;
    if (agentConfig && (agentConfig.apiKey || agentConfig.model)) {
      return agentConfig as {
        apiKey?: string;
        baseUrl?: string;
        model?: string;
      };
    }
  } catch {
    // Provider manager not yet initialized — use defaults
  }
  return undefined;
}

// ============================================================================
// Types
// ============================================================================

export type PipelineStatus =
  | 'queued'
  | 'preflight'
  | 'triaging'
  | 'branching'
  | 'researching'
  | 'implementing'
  | 'awaiting_approval'
  | 'verifying'
  | 'self_reviewing'
  | 'creating_pr'
  | 'awaiting_review'
  | 'awaiting_ci'
  | 'fixing_review'
  | 'notifying'
  | 'completed'
  | 'failed';

export interface PipelineState {
  issueId: string;
  issueIdentifier: string;
  issueTitle: string;
  teamId?: string;
  status: PipelineStatus;
  branch?: string;
  prUrl?: string;
  prNumber?: number;
  error?: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  durationMs?: number;
  logs: string[];
  reviewIterations: number;
}

// Internal state with abort controller (not serialized)
interface InternalPipelineState extends PipelineState {
  abortController?: AbortController;
}

// ============================================================================
// Module-level state
// ============================================================================

const queue: LinearIssue[] = [];
const active = new Map<string, InternalPipelineState>();
let processing = false;

const PIPELINE_STATE_FILE = join(getAppDir(), 'pipeline-state.json');

// ============================================================================
// State persistence
// ============================================================================

async function persistState(): Promise<void> {
  try {
    const serializable = Array.from(active.values()).map((s) => {
      const { abortController: _, ...rest } = s;
      return rest;
    });
    await fs.mkdir(getAppDir(), { recursive: true });
    await fs.writeFile(
      PIPELINE_STATE_FILE,
      JSON.stringify(serializable, null, 2),
    );
  } catch (err) {
    logger.error('Failed to persist state', err);
  }
}

export async function loadPersistedState(): Promise<void> {
  try {
    const data = await fs.readFile(PIPELINE_STATE_FILE, 'utf-8');
    const states: PipelineState[] = JSON.parse(data);
    for (const s of states) {
      active.set(s.issueId, s);
    }
    logger.info(`Restored ${states.length} pipeline state(s) from disk`);

    // Resume review polling loops for pipelines that were awaiting_review at shutdown
    const config = getLinearConfig();
    for (const s of states) {
      if (s.status === 'awaiting_review' && s.prNumber && s.branch) {
        logger.info(
          `Resuming review loop for ${s.issueIdentifier} (PR #${s.prNumber})`,
        );
        void resumeReviewLoop(s.issueId, config);
      }
    }
  } catch {
    // No persisted state or parse error — start fresh
  }
}

// ============================================================================
// Public API
// ============================================================================

/** Enqueue issue for processing. Rejects duplicates, concurrency cap, and budget limits. */
export async function enqueue(issue: LinearIssue): Promise<{
  accepted: boolean;
  reason?: string;
}> {
  if (active.has(issue.id)) {
    logger.warn(
      `Issue ${issue.identifier} already has an active pipeline, skipping`,
    );
    return {
      accepted: false,
      reason: 'pipeline already active for this issue',
    };
  }
  if (queue.some((q) => q.id === issue.id)) {
    logger.warn(`Issue ${issue.identifier} already queued, skipping`);
    return { accepted: false, reason: 'already queued' };
  }

  // Enforce max concurrent pipelines
  const config = getLinearConfig();
  const activePipelines = Array.from(active.values()).filter(
    (s) => !['completed', 'failed'].includes(s.status),
  );
  if (activePipelines.length >= config.capabilities.maxConcurrentPipelines) {
    logger.warn(
      `Concurrency limit reached (${activePipelines.length}/${config.capabilities.maxConcurrentPipelines}), rejecting ${issue.identifier}`,
    );
    return {
      accepted: false,
      reason: `concurrency limit reached (${config.capabilities.maxConcurrentPipelines} max)`,
    };
  }

  // Pre-check budget (async but non-blocking — reject immediately if over budget)
  const budgetCheck = await checkBudget(
    issue.id,
    config.maxUsdPerTicket,
    config.maxUsdPerDay,
  ).catch(() => ({ allowed: true }) as { allowed: boolean; reason?: string });
  if (!budgetCheck.allowed) {
    logger.warn(
      `Budget exceeded for ${issue.identifier}: ${budgetCheck.reason}`,
    );
    return { accepted: false, reason: budgetCheck.reason };
  }

  queue.push(issue);
  logger.info(`Enqueued issue ${issue.identifier}`);
  if (!processing) void processQueue();
  return { accepted: true };
}

/** Get pipeline state for an issue */
export function getStatus(issueId: string): PipelineState | undefined {
  const state = active.get(issueId);
  if (!state) return undefined;
  const { abortController: _, ...rest } = state;
  return rest;
}

/** Get all pipeline states */
export function getAll(): PipelineState[] {
  return Array.from(active.values()).map((s) => {
    const { abortController: _, ...rest } = s;
    return rest;
  });
}

/** Evict completed/failed pipeline states older than TTL */
export function cleanup(): number {
  const cutoff = Date.now() - PIPELINE_STATE_TTL_MS;
  let evicted = 0;
  for (const [id, state] of active) {
    if (
      (state.status === 'completed' || state.status === 'failed') &&
      state.completedAt &&
      new Date(state.completedAt).getTime() < cutoff
    ) {
      active.delete(id);
      evicted++;
    }
  }
  if (evicted > 0) void persistState();
  return evicted;
}

/** Abort a running pipeline */
export function abort(issueId: string): boolean {
  const state = active.get(issueId);
  if (state?.abortController) {
    state.abortController.abort();
    return true;
  }
  return false;
}

/** Graceful shutdown */
export async function shutdownPipelines(): Promise<void> {
  logger.info('Shutting down pipelines...');
  for (const [, state] of active) {
    if (state.abortController) {
      state.abortController.abort();
    }
  }
  await persistState();
  logger.info('Pipeline state persisted, shutdown complete');
}

// ============================================================================
// Queue processing
// ============================================================================

async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;

  const config = getLinearConfig();
  const maxConcurrent = config.capabilities.maxConcurrentPipelines;

  const runNext = (): void => {
    while (queue.length > 0) {
      const activePipelines = Array.from(active.values()).filter(
        (s) => !['completed', 'failed'].includes(s.status),
      );
      if (activePipelines.length >= maxConcurrent) break;

      const issue = queue.shift()!;
      void runTicketPipeline(issue, config)
        .catch((err) => {
          logger.error(`Pipeline failed for ${issue.identifier}:`, err);
        })
        .finally(() => {
          // When a pipeline finishes, try to start the next queued item
          runNext();
        });
    }

    // All done when queue is empty and no active pipelines
    const remaining = Array.from(active.values()).filter(
      (s) => !['completed', 'failed'].includes(s.status),
    );
    if (queue.length === 0 && remaining.length === 0) {
      processing = false;
    }
  };

  runNext();
}

// ============================================================================
// Helpers
// ============================================================================

function updateStatus(
  state: InternalPipelineState,
  status: PipelineStatus,
  hookCtx?: Partial<PipelinePhaseContext>,
): void {
  const previousStatus = state.status;
  state.status = status;
  state.updatedAt = new Date().toISOString();
  state.logs.push(`[${new Date().toISOString()}] Status: ${status}`);

  // Fire phase-transition hooks (fire-and-forget)
  void onPhaseTransition({
    issueId: state.issueId,
    issueIdentifier: state.issueIdentifier,
    issueTitle: state.issueTitle,
    teamId: state.teamId ?? '',
    previousStatus,
    newStatus: status,
    branch: state.branch,
    prUrl: state.prUrl,
    prNumber: state.prNumber,
    error: state.error,
    ...hookCtx,
  }).catch((err) => {
    logger.warn('Phase transition hook failed', { status, err });
  });
}

/**
 * Assert a capability is enabled. Throws if the agent lacks the required capability.
 * Used as a guard before performing restricted actions.
 */
function requireCapability(
  capabilities: AgentCapabilities,
  cap: keyof AgentCapabilities,
  action: string,
): void {
  if (!capabilities[cap]) {
    throw new Error(`Agent capability "${cap}" is disabled — cannot ${action}`);
  }
}

/** Drain an async generator from runRoleAgent and collect results. */
async function drainRoleAgent(
  role: AgentRole,
  prompt: string,
  workDir: string,
  opts?: RunRoleAgentOptions,
): Promise<{ text: string; logs: string[] }> {
  const logs: string[] = [];
  let finalText = '';
  for await (const msg of runRoleAgent(role, prompt, workDir, opts)) {
    if (msg.type === 'text') finalText += msg.content ?? '';
    if (msg.type === 'tool_result') {
      logs.push(`[${msg.name ?? 'tool'}] ${(msg.output ?? '').slice(0, 200)}`);
    }
  }
  return { text: finalText, logs };
}

async function runLint(
  cwd: string,
): Promise<{ lintOutput: string; lintOk: boolean }> {
  try {
    const pkgContent = await fs.readFile(join(cwd, 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgContent);
    if (!pkg.scripts?.lint) {
      return { lintOutput: 'No lint script found', lintOk: true };
    }

    // Detect package manager
    let pm = 'npm run';
    try {
      await fs.access(join(cwd, 'pnpm-lock.yaml'));
      pm = 'pnpm';
    } catch {
      try {
        await fs.access(join(cwd, 'yarn.lock'));
        pm = 'yarn';
      } catch {
        // default npm
      }
    }

    const { stdout, stderr } = await execAsync(`${pm} lint`, {
      cwd,
      timeout: 120_000,
    });
    return { lintOutput: stdout + stderr, lintOk: true };
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string };
    return {
      lintOutput: (error.stdout ?? '') + (error.stderr ?? ''),
      lintOk: false,
    };
  }
}

async function runTypeCheck(
  cwd: string,
): Promise<{ tscOutput: string; tscOk: boolean }> {
  try {
    await fs.access(join(cwd, 'tsconfig.json'));
  } catch {
    return { tscOutput: 'No tsconfig.json found', tscOk: true };
  }

  try {
    let pm = 'npx';
    try {
      await fs.access(join(cwd, 'pnpm-lock.yaml'));
      pm = 'pnpm exec';
    } catch {
      // default npx
    }

    const { stdout, stderr } = await execAsync(`${pm} tsc --noEmit`, {
      cwd,
      timeout: 120_000,
    });
    return { tscOutput: stdout + stderr, tscOk: true };
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string };
    return {
      tscOutput: (error.stdout ?? '') + (error.stderr ?? ''),
      tscOk: false,
    };
  }
}

// ============================================================================
// Review loop resume (for pipelines restored from disk)
// ============================================================================

async function resumeReviewLoop(
  issueId: string,
  config: LinearConfig,
): Promise<void> {
  const state = active.get(issueId);
  if (!state || state.status !== 'awaiting_review' || !state.prNumber) return;

  const abortController = new AbortController();
  state.abortController = abortController;

  try {
    const reviewStartTime = Date.now();
    let lastCheckTime = state.updatedAt;
    let consecutiveEmptyChecks = 0;

    while (state.reviewIterations < PR_REVIEW_MAX_FIX_ITERATIONS) {
      if (Date.now() - reviewStartTime > PR_REVIEW_WINDOW_MS) {
        state.logs.push(
          '[review-resume] 24h review window expired, finalizing',
        );
        break;
      }

      await sleep(PR_REVIEW_POLL_INTERVAL_MS, abortController.signal);
      if (abortController.signal.aborted) return;

      const { stdout: repoSlug } = await execAsync(
        'gh repo view --json nameWithOwner -q .nameWithOwner',
        { cwd: config.workspaceDir, timeout: 30_000 },
      );
      const repo = repoSlug.trim();
      const { stdout: commentsJson } = await execAsync(
        `gh api repos/${repo}/pulls/${state.prNumber}/comments --jq '[.[] | select(.created_at > "${lastCheckTime}")]'`,
        { cwd: config.workspaceDir, timeout: 30_000 },
      );
      const { stdout: reviewsJson } = await execAsync(
        `gh api repos/${repo}/pulls/${state.prNumber}/reviews --jq '[.[] | select(.submitted_at > "${lastCheckTime}")]'`,
        { cwd: config.workspaceDir, timeout: 30_000 },
      );

      lastCheckTime = new Date().toISOString();
      const newComments: GitHubComment[] = JSON.parse(commentsJson || '[]');
      const newReviews: GitHubReview[] = JSON.parse(reviewsJson || '[]');

      const approved = newReviews.some((r) => r.state === 'APPROVED');
      if (approved) {
        state.logs.push(
          '[review-resume] PR approved, proceeding to notification',
        );
        break;
      }

      if (newComments.length === 0 && newReviews.length === 0) {
        consecutiveEmptyChecks++;
        if (consecutiveEmptyChecks >= 6) {
          state.logs.push(
            '[review-resume] No review activity for 30 minutes, continuing to wait...',
          );
        }
        continue;
      }

      consecutiveEmptyChecks = 0;
      updateStatus(state, 'fixing_review');

      const feedbackComments = newComments.map((c) => ({
        author: c.user?.login ?? 'unknown',
        body: c.body,
        path: c.path,
        line: c.line,
      }));

      const modelConfig = getModelConfig();
      const fixPrompt = buildPRReviewFixPrompt(feedbackComments);
      const fixSession = createSession('execute');
      for await (const msg of runAgent(fixPrompt, {
        session: fixSession,
        workDir: config.workspaceDir,
        modelConfig,
      })) {
        state.logs.push(
          `[review-resume-fix-${state.reviewIterations}] ${msg.type}`,
        );
        if (abortController.signal.aborted) return;
      }

      const [resumeLint, resumeTsc] = await Promise.allSettled([
        runLint(config.workspaceDir),
        runTypeCheck(config.workspaceDir),
      ]);
      const resumeLintOk =
        resumeLint.status === 'fulfilled' && resumeLint.value.lintOk;
      const resumeTscOk =
        resumeTsc.status === 'fulfilled' && resumeTsc.value.tscOk;
      if (!resumeLintOk || !resumeTscOk) {
        state.logs.push(
          '[review-resume-fix] Warning: lint/typecheck failures after review fix',
        );
      }

      const { stdout: fixedFiles } = await execAsync(
        'git diff --name-only HEAD',
        { cwd: config.workspaceDir, timeout: 30_000 },
      );
      const filesToStage = fixedFiles.trim().split('\n').filter(Boolean);
      for (const file of filesToStage) {
        await execFileAsync('git', ['add', file], {
          cwd: config.workspaceDir,
          timeout: 30_000,
        });
      }
      await execFileAsync(
        'git',
        [
          'commit',
          '-m',
          `address review feedback (iteration ${state.reviewIterations + 1})`,
        ],
        { cwd: config.workspaceDir, timeout: 30_000 },
      );
      await execAsync('git push', {
        cwd: config.workspaceDir,
        timeout: 60_000,
      });

      await execFileAsync(
        'gh',
        [
          'pr',
          'comment',
          String(state.prNumber),
          '--body',
          `Addressed review feedback (iteration ${state.reviewIterations + 1})`,
        ],
        { cwd: config.workspaceDir, timeout: 30_000 },
      );

      state.reviewIterations++;
      updateStatus(state, 'awaiting_review');
      await persistState();
    }

    // Notify completion
    updateStatus(state, 'notifying');
    if (config.slackWebhookUrl) {
      await sendSlackNotification(config.slackWebhookUrl, {
        title: 'PR Review Loop Completed',
        issueId: state.issueIdentifier,
        issueTitle: state.issueTitle,
        prUrl: state.prUrl ?? '',
        summary: `Review loop completed after ${state.reviewIterations} iteration(s)`,
        branch: state.branch ?? '',
      }).catch((err) => {
        logger.error('Failed to send Slack notification', err);
      });
    }

    state.status = 'completed';
  } catch (err) {
    if (abortController.signal.aborted) return;
    state.status = 'failed';
    state.error = err instanceof Error ? err.message : String(err);
    logger.error(
      `Resume review loop failed for ${state.issueIdentifier}:`,
      err,
    );
  } finally {
    const now = new Date();
    state.completedAt = now.toISOString();
    state.durationMs = now.getTime() - new Date(state.startedAt).getTime();
    state.updatedAt = now.toISOString();
    state.abortController = undefined;
    await persistState();
  }
}

// ============================================================================
// Pipeline execution
// ============================================================================

async function runTicketPipeline(
  issue: LinearIssue,
  config: LinearConfig,
): Promise<void> {
  const abortController = new AbortController();
  const totalTimeout = setTimeout(
    () => abortController.abort(),
    PIPELINE_TOTAL_TIMEOUT_MS,
  );

  const state: InternalPipelineState = {
    issueId: issue.id,
    issueIdentifier: issue.identifier,
    issueTitle: issue.title,
    teamId: issue.team?.id,
    status: 'queued',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    logs: [],
    reviewIterations: 0,
    abortController,
  };
  active.set(issue.id, state);

  let effectiveWorkDir = config.workspaceDir;
  let baseRepoPath: string | null = null;
  let swarmTaskId: string | null = null;

  try {
    // ---- Step 1: Preflight ----
    updateStatus(state, 'preflight');

    try {
      await fs.access(config.workspaceDir);
    } catch {
      throw new Error(
        `Workspace directory does not exist: ${config.workspaceDir}`,
      );
    }

    const { stdout: gitRoot } = await execAsync(
      'git rev-parse --show-toplevel',
      { cwd: config.workspaceDir, timeout: 30_000 },
    );
    if (!gitRoot.trim()) throw new Error('Workspace is not a git repository');

    const { stdout: porcelain } = await execAsync('git status --porcelain', {
      cwd: config.workspaceDir,
      timeout: 30_000,
    });
    if (porcelain.trim()) {
      throw new Error(
        `Workspace has uncommitted changes. Clean the workspace before running the pipeline:\n${porcelain}`,
      );
    }

    // ---- Step 1b: Self-assign if not already assigned to agent ----
    await ensureAssignedToAgent(issue, config).catch((err) => {
      logger.warn(
        `Self-assign failed for ${issue.identifier}, continuing:`,
        err,
      );
    });

    // ---- Step 1c: Validate capabilities ----
    const caps = config.capabilities;
    requireCapability(caps, 'canCreateBranches', 'create branches');
    requireCapability(caps, 'canCreatePRs', 'create pull requests');

    // ---- Step 1d: Triage ----
    updateStatus(state, 'triaging');
    const classification = triageIssue(issue);
    const branchName = `${classification.branchPrefix}${issue.identifier.toLowerCase()}-${classification.scope}`;

    // ---- Step 2: Workspace Setup (worktree or direct branch) ----
    updateStatus(state, 'branching');

    // Gather ticket context early (needed for repo resolution)
    const [repoContext, ticketCtx] = await Promise.all([
      getRepoContext(config.workspaceDir),
      gatherTicketContext(issue.id).catch((err) => {
        logger.warn(
          `Failed to gather ticket context for ${issue.identifier}:`,
          err,
        );
        return undefined;
      }),
    ]);

    // Log context metrics
    if (ticketCtx) {
      logger.info(`Ticket context gathered for ${issue.identifier}:`, {
        comments: ticketCtx.comments.length,
        attachments: ticketCtx.attachments.length,
        relations: ticketCtx.relatedIssues.length,
        hasParent: !!ticketCtx.parent,
        children: ticketCtx.children.length,
      });
    }

    // Attempt repo resolution for worktree-based workflow
    const repoInfo = resolveRepoFromTicket(issue, ticketCtx, config);

    // Self-healing write-back: if resolved via fallback (not attachment),
    // write the repo attachment back to the issue for future deterministic resolution
    if (repoInfo && repoInfo.resolvedVia !== 'attachment') {
      createAttachment(
        issue.id,
        `https://github.com/${repoInfo.owner}/${repoInfo.repo}`,
        'Target Repository (auto-resolved)',
        {
          subtitle: `Resolved via ${repoInfo.resolvedVia}`,
          metadata: {
            owner: repoInfo.owner,
            repo: repoInfo.repo,
            resolvedVia: repoInfo.resolvedVia,
            resolvedAt: new Date().toISOString(),
          },
        },
      ).catch((err) => {
        logger.warn(
          `Failed to write-back repo attachment for ${issue.identifier}:`,
          err,
        );
      });
    }

    if (repoInfo) {
      try {
        logger.info(
          `Resolved repo: ${repoInfo.owner}/${repoInfo.repo} (via ${repoInfo.resolvedVia})`,
        );

        // Ensure base repo is cloned and up-to-date
        baseRepoPath = await ensureBaseRepo(
          repoInfo.owner,
          repoInfo.repo,
          config.githubToken,
        );

        // Determine base branch (repo-specific or default)
        const matchedMapping = config.repoMappings.find(
          (m) =>
            (!m.teamId || m.teamId === issue.team?.id) &&
            m.owner === repoInfo.owner &&
            m.repo === repoInfo.repo,
        );
        const baseBranch = matchedMapping?.baseBranch || config.defaultBranch;

        // Check if branch already exists
        const { stdout: existingBranch } = await execAsync(
          `git branch --list "${branchName}" && git ls-remote --heads origin "${branchName}"`,
          { cwd: baseRepoPath, timeout: 30_000 },
        );
        if (existingBranch.trim()) {
          throw new Error(
            `Branch "${branchName}" already exists locally or on remote`,
          );
        }

        // Create isolated worktree for this task
        effectiveWorkDir = await createTaskWorktree(
          baseRepoPath,
          branchName,
          baseBranch,
          issue.identifier,
        );

        // Install dependencies in worktree
        await installDependencies(effectiveWorkDir);

        // Initialize worktree for Claude Code agents
        await initializeWorktreeForClaude(
          baseRepoPath,
          effectiveWorkDir,
          issue.identifier,
        );

        logger.info(`Worktree ready: ${effectiveWorkDir}`);

        // Create Swarm Mode task metadata
        swarmTaskId = await createSwarmTask(issue, effectiveWorkDir);

        // Update shell aliases for navigation
        await updateShellAliases(dirname(effectiveWorkDir)).catch((err) =>
          logger.warn(`Failed to update aliases: ${err}`),
        );
      } catch (error) {
        logger.error(
          `Worktree setup failed, falling back to workspaceDir: ${error}`,
        );
        baseRepoPath = null;
        effectiveWorkDir = config.workspaceDir;
      }
    }

    // If no worktree was created, fall back to direct branching (original behavior)
    if (effectiveWorkDir === config.workspaceDir) {
      const { stdout: existingBranch } = await execAsync(
        `git branch --list "${branchName}" && git ls-remote --heads origin "${branchName}"`,
        { cwd: config.workspaceDir, timeout: 30_000 },
      );
      if (existingBranch.trim()) {
        throw new Error(
          `Branch "${branchName}" already exists locally or on remote`,
        );
      }

      const gitOpts = { cwd: config.workspaceDir, timeout: 30_000 };
      await execFileAsync('git', ['fetch', 'origin'], gitOpts);
      await execFileAsync('git', ['checkout', config.defaultBranch], gitOpts);
      await execFileAsync(
        'git',
        ['pull', 'origin', config.defaultBranch],
        gitOpts,
      );
      await execFileAsync('git', ['checkout', '-b', branchName], gitOpts);
    }

    state.branch = branchName;
    await addIssueComment(
      issue.id,
      `Started working on this issue (branch: \`${branchName}\`)`,
    ).catch(() => {});

    const signal = abortController.signal;
    const modelConfig = getModelConfig();
    const roleOpts: RunRoleAgentOptions = { signal, modelConfig };

    // ---- Initialize progress file ----
    await initializeOrchestrator(issue, effectiveWorkDir);

    // ---- Step 3a: Research Phase (graceful degradation) ----
    // If worktree was created, re-gather repo context from worktree
    const effectiveRepoContext = baseRepoPath
      ? await getRepoContext(effectiveWorkDir)
      : repoContext;

    updateStatus(state, 'researching');
    const researchPhaseStart = Date.now();
    const researchBlock = await runResearchPhase(
      issue,
      effectiveRepoContext,
      effectiveWorkDir,
      signal,
    ).catch((err) => {
      logger.warn('Research phase failed, continuing without research', {
        err: err instanceof Error ? err.message : String(err),
      });
      return '';
    });
    await recordPhaseCompletion(
      effectiveWorkDir,
      'researching',
      researchBlock ? 'Research completed' : 'Skipped',
      {
        durationMs: Date.now() - researchPhaseStart,
        status: researchBlock ? 'completed' : 'skipped',
      },
    );

    // ---- Resolve Figma designs ----
    let designCtx: DesignContext | undefined;
    try {
      const figmaToken = config.figmaToken;
      if (figmaToken) {
        const figmaRefs = resolveFigmaFromTicket(issue, ticketCtx);
        if (figmaRefs.length > 0) {
          const frames: DesignContext['frames'] = [];
          for (const ref of figmaRefs.slice(0, 3)) {
            const data = await fetchFigmaDesignData(ref, figmaToken);
            if (data) {
              frames.push({
                url: ref.url,
                name: data.name,
                spec: formatDesignData(data),
              });
            }
          }
          if (frames.length > 0) {
            designCtx = { frames };
            logger.info(
              `Resolved ${frames.length} Figma design(s) for ${issue.identifier}`,
            );
          }
        }
      }
    } catch (err) {
      logger.warn(
        'Figma design resolution failed, continuing without design context',
        err,
      );
    }

    const prompt = buildPromptForIssue(
      issue,
      classification,
      effectiveRepoContext,
      ticketCtx,
      designCtx,
      researchBlock || undefined,
    );

    // ---- Step 3b: Planning Phase (via role agent) ----
    updateStatus(state, 'implementing');
    const planPhaseStart = Date.now();

    // Read progress for context injection
    const progressCtx = await readProgress(effectiveWorkDir);
    const contextPrefix = progressCtx
      ? formatProgressForAgent(progressCtx)
      : undefined;

    const planResult = await drainRoleAgent(
      'planner',
      prompt,
      effectiveWorkDir,
      {
        ...roleOpts,
        contextPrefix,
      },
    );
    state.logs.push(...planResult.logs.map((l) => `[plan] ${l}`));

    // Extract planId from planning phase (fallback to legacy planning if role agent doesn't produce one)
    let planId: string | undefined;
    const planSession = createSession('plan');
    const planSignal = AbortSignal.any([
      abortController.signal,
      AbortSignal.timeout(PIPELINE_PHASE_TIMEOUT_MS),
    ]);
    planSignal.addEventListener(
      'abort',
      () => planSession.abortController.abort(),
      { once: true },
    );

    try {
      for await (const message of runPlanningPhase(
        prompt,
        planSession,
        undefined,
        modelConfig,
      )) {
        state.logs.push(
          `[plan] ${message.type}: ${JSON.stringify(message).slice(0, 200)}`,
        );
        if (message.type === 'plan' && message.plan?.id) {
          planId = message.plan.id;
        }
        if (planSignal.aborted) throw new Error('Pipeline aborted (timeout)');
      }
    } catch (err) {
      if (planSignal.aborted)
        throw new Error('Planning phase timed out or pipeline aborted');
      throw err;
    }

    if (!planId) throw new Error('Planning phase did not produce a plan');

    await recordPhaseCompletion(
      effectiveWorkDir,
      'planning',
      planResult.text.slice(0, 500),
      {
        durationMs: Date.now() - planPhaseStart,
      },
    );

    // ---- Step 3c: Confidence Gate ----
    updateStatus(state, 'awaiting_approval');
    const { proceed, confidence, approvalReason } = await runConfidenceGate(
      { id: planId },
      issue,
      {
        hasTests: !!effectiveRepoContext.packageJsonScripts?.test,
        claudeMdContent: null,
        packageJsonScripts: effectiveRepoContext.packageJsonScripts,
      },
      signal,
      undefined,
      config.requireApprovalFor,
      config.approvalAuthorizedNames,
    );

    if (!proceed) {
      const reason = approvalReason
        ? `Confidence gate rejected (${approvalReason})`
        : `Confidence gate rejected (score: ${confidence}/10)`;
      updateStatus(state, 'failed');
      state.error = reason;
      await recordPhaseCompletion(effectiveWorkDir, 'confidence_gate', reason, {
        status: 'failed',
      });
      return;
    }
    await recordPhaseCompletion(
      effectiveWorkDir,
      'confidence_gate',
      `Approved (score: ${confidence}/10)`,
    );

    // ---- Step 3d: Execution Phase (via role agent) ----
    const execPhaseStart = Date.now();

    // Re-read progress after planning for updated context
    const execProgressCtx = await readProgress(effectiveWorkDir);
    const _execContextPrefix = execProgressCtx
      ? formatProgressForAgent(execProgressCtx)
      : undefined;

    const execSession = createSession('execute');
    const execSignal = AbortSignal.any([
      abortController.signal,
      AbortSignal.timeout(PIPELINE_PHASE_TIMEOUT_MS),
    ]);
    execSignal.addEventListener(
      'abort',
      () => execSession.abortController.abort(),
      { once: true },
    );

    const sandboxConfig: SandboxConfig = {
      enabled: true,
      provider: 'codex',
    };

    try {
      for await (const message of runExecutionPhase(
        planId,
        execSession,
        prompt,
        effectiveWorkDir,
        undefined,
        modelConfig,
        sandboxConfig,
      )) {
        state.logs.push(
          `[exec] ${message.type}: ${JSON.stringify(message).slice(0, 200)}`,
        );
        if (execSignal.aborted) throw new Error('Pipeline aborted (timeout)');
      }
    } catch (err) {
      if (execSignal.aborted)
        throw new Error('Execution phase timed out or pipeline aborted');
      throw err;
    }

    await recordPhaseCompletion(
      effectiveWorkDir,
      'execution',
      'Implementation complete',
      {
        durationMs: Date.now() - execPhaseStart,
      },
    );
    await persistState();

    // ---- Step 4: Verification (retry loop, max 3) ----
    updateStatus(state, 'verifying');
    for (let attempt = 1; attempt <= 3; attempt++) {
      const [lintResult, tscResult] = await Promise.allSettled([
        runLint(effectiveWorkDir),
        runTypeCheck(effectiveWorkDir),
      ]);
      const lintOk =
        lintResult.status === 'fulfilled' && lintResult.value.lintOk;
      const tscOk = tscResult.status === 'fulfilled' && tscResult.value.tscOk;
      const lintOutput =
        lintResult.status === 'fulfilled'
          ? lintResult.value.lintOutput
          : (lintResult.reason?.message ?? '');
      const tscOutput =
        tscResult.status === 'fulfilled'
          ? tscResult.value.tscOutput
          : (tscResult.reason?.message ?? '');

      if (lintOk && tscOk) break;

      if (attempt === 3) {
        await addIssueComment(
          issue.id,
          'Pipeline failed: lint/tsc errors after 3 fix attempts',
        ).catch(() => {});
        throw new Error(
          `Verification failed after 3 attempts. Lint: ${lintOk}, TSC: ${tscOk}`,
        );
      }

      const fixPrompt = buildVerificationPrompt(lintOutput, tscOutput);
      const fixResult = await drainRoleAgent(
        'verifier',
        fixPrompt,
        effectiveWorkDir,
        roleOpts,
      );
      state.logs.push(...fixResult.logs.map((l) => `[fix-${attempt}] ${l}`));
    }

    // ---- Step 5: Self-Review ----
    updateStatus(state, 'self_reviewing');

    // Stage and commit agent's work
    const { stdout: implChanges } = await execAsync('git diff --name-only', {
      cwd: effectiveWorkDir,
      timeout: 30_000,
    });
    const { stdout: untrackedFiles } = await execAsync(
      'git ls-files --others --exclude-standard',
      { cwd: effectiveWorkDir, timeout: 30_000 },
    );
    const allImplFiles = [
      ...implChanges.trim().split('\n'),
      ...untrackedFiles.trim().split('\n'),
    ].filter(Boolean);

    const sensitivePatterns = [
      '.env',
      'credentials',
      '.secret',
      '.key',
      '.pem',
    ];
    const safeImplFiles = allImplFiles.filter(
      (f) => !sensitivePatterns.some((p) => f.toLowerCase().includes(p)),
    );
    for (const file of safeImplFiles) {
      await execFileAsync('git', ['add', file], {
        cwd: effectiveWorkDir,
        timeout: 30_000,
      });
    }
    const wipMsg = `wip: ${issue.title} (${issue.identifier})`;
    await execFileAsync('git', ['commit', '-m', wipMsg], {
      cwd: effectiveWorkDir,
      timeout: 30_000,
    });

    // Diff against default branch
    const diffMapping =
      baseRepoPath && repoInfo
        ? config.repoMappings.find(
            (m) =>
              (!m.teamId || m.teamId === issue.team?.id) &&
              m.owner === repoInfo.owner &&
              m.repo === repoInfo.repo,
          )
        : undefined;
    const diffBaseBranch = diffMapping?.baseBranch || config.defaultBranch;
    const { stdout: diffStat } = await execAsync(
      `git diff --stat origin/${diffBaseBranch}...HEAD`,
      { cwd: effectiveWorkDir, timeout: 30_000 },
    );
    const { stdout: diff } = await execAsync(
      `git diff origin/${diffBaseBranch}...HEAD`,
      { cwd: effectiveWorkDir, timeout: 60_000 },
    );

    const truncatedDiff =
      diff.length > 50000
        ? diff.slice(0, 50000) + '\n\n... [diff truncated] ...'
        : diff;

    // Run self-review via evaluator role agent (fresh session for no self-bias)
    const reviewPrompt = buildSelfReviewPrompt(truncatedDiff);
    const evalResult = await drainRoleAgent(
      'evaluator',
      reviewPrompt,
      effectiveWorkDir,
      roleOpts,
    );
    state.logs.push(...evalResult.logs.map((l) => `[self-review] ${l}`));
    await recordPhaseCompletion(
      effectiveWorkDir,
      'self_review',
      evalResult.text.slice(0, 500),
    );

    // Re-verify after self-review (parallel)
    const [postLintResult, postTscResult] = await Promise.allSettled([
      runLint(effectiveWorkDir),
      runTypeCheck(effectiveWorkDir),
    ]);
    const postReviewLintOk =
      postLintResult.status === 'fulfilled' && postLintResult.value.lintOk;
    const postReviewTscOk =
      postTscResult.status === 'fulfilled' && postTscResult.value.tscOk;
    if (!postReviewLintOk || !postReviewTscOk) {
      throw new Error('Self-review introduced verification failures');
    }

    // ---- Step 6: Create PR ----
    updateStatus(state, 'creating_pr');

    // Check for uncommitted changes from self-review
    const { stdout: postReviewChanges } = await execAsync(
      'git diff --name-only',
      { cwd: effectiveWorkDir, timeout: 30_000 },
    );
    const { stdout: postReviewUntracked } = await execAsync(
      'git ls-files --others --exclude-standard',
      { cwd: effectiveWorkDir, timeout: 30_000 },
    );
    const postReviewFiles = [
      ...postReviewChanges.trim().split('\n'),
      ...postReviewUntracked.trim().split('\n'),
    ].filter(Boolean);

    if (postReviewFiles.length > 0) {
      const safeFiles = postReviewFiles.filter(
        (f) => !sensitivePatterns.some((p) => f.toLowerCase().includes(p)),
      );
      for (const file of safeFiles) {
        await execFileAsync('git', ['add', file], {
          cwd: effectiveWorkDir,
          timeout: 30_000,
        });
      }
      await execAsync('git commit --amend --no-edit', {
        cwd: effectiveWorkDir,
        timeout: 30_000,
      });
    }

    // Rewrite commit message
    const commitMsg = `${classification.type}: ${issue.title} (${issue.identifier})`;
    await execFileAsync('git', ['commit', '--amend', '-m', commitMsg], {
      cwd: effectiveWorkDir,
      timeout: 30_000,
    });

    // Push
    await execAsync(`git push -u origin ${branchName}`, {
      cwd: effectiveWorkDir,
      timeout: 120_000,
    });

    // Create PR using execFile for safe argument handling
    const prBody = buildPRBody(issue, classification, diffStat);
    const { stdout: prOutput } = await execFileAsync(
      'gh',
      ['pr', 'create', '--title', commitMsg, '--body', prBody],
      { cwd: effectiveWorkDir, timeout: 60_000 },
    );

    const prUrl = prOutput.trim();
    const prNumber = parseInt(prUrl.split('/').pop() ?? '0', 10);
    state.prUrl = prUrl;
    state.prNumber = prNumber;

    await addIssueComment(issue.id, `Pull request created: ${prUrl}`).catch(
      () => {},
    );

    // Update progress with PR info
    const prProgress = await readProgress(effectiveWorkDir);
    if (prProgress) {
      prProgress.pr = { url: prUrl, number: prNumber, branch: branchName };
      await writeProgress(effectiveWorkDir, prProgress);
    }
    await recordPhaseCompletion(
      effectiveWorkDir,
      'creating_pr',
      `PR #${prNumber} created`,
    );

    // ---- Step 7a: CI Monitoring ----
    updateStatus(state, 'awaiting_ci');
    const ciResult = await runCIMonitorPhase(effectiveWorkDir, signal).catch(
      (err) => {
        logger.warn('CI monitoring failed, continuing', {
          err: err instanceof Error ? err.message : String(err),
        });
        return { passed: true } as { passed: boolean; fixPrompt?: string };
      },
    );

    if (!ciResult.passed && ciResult.fixPrompt) {
      // Attempt CI fix via ci_monitor role agent
      const ciFixResult = await drainRoleAgent(
        'ci_monitor',
        ciResult.fixPrompt,
        effectiveWorkDir,
        roleOpts,
      );
      state.logs.push(...ciFixResult.logs.map((l) => `[ci-fix] ${l}`));

      // Push CI fix and re-check
      await execAsync('git push', {
        cwd: effectiveWorkDir,
        timeout: 120_000,
      });

      const ciRecheck = await runCIMonitorPhase(effectiveWorkDir, signal).catch(
        () => ({ passed: false }) as { passed: boolean },
      );
      if (!ciRecheck.passed) {
        logger.warn('CI still failing after fix attempt, continuing to review');
      }
    }
    await recordPhaseCompletion(
      effectiveWorkDir,
      'ci_monitoring',
      ciResult.passed ? 'All checks passed' : 'CI fix attempted',
    );

    // ---- Step 7b: PR Review Loop ----
    updateStatus(state, 'awaiting_review');
    await persistState();

    const reviewStartTime = Date.now();
    let lastCheckTime = new Date().toISOString();
    let consecutiveEmptyChecks = 0;

    while (state.reviewIterations < PR_REVIEW_MAX_FIX_ITERATIONS) {
      if (Date.now() - reviewStartTime > PR_REVIEW_WINDOW_MS) {
        state.logs.push(
          '[review] 24h review window expired, proceeding to notification',
        );
        break;
      }

      await sleep(PR_REVIEW_POLL_INTERVAL_MS, abortController.signal);
      if (abortController.signal.aborted) throw new Error('Pipeline aborted');

      const { stdout: repoSlug } = await execAsync(
        'gh repo view --json nameWithOwner -q .nameWithOwner',
        { cwd: effectiveWorkDir, timeout: 30_000 },
      );
      const repo = repoSlug.trim();
      const { stdout: commentsJson } = await execAsync(
        `gh api repos/${repo}/pulls/${state.prNumber}/comments --jq '[.[] | select(.created_at > "${lastCheckTime}")]'`,
        { cwd: effectiveWorkDir, timeout: 30_000 },
      );
      const { stdout: reviewsJson } = await execAsync(
        `gh api repos/${repo}/pulls/${state.prNumber}/reviews --jq '[.[] | select(.submitted_at > "${lastCheckTime}")]'`,
        { cwd: effectiveWorkDir, timeout: 30_000 },
      );

      lastCheckTime = new Date().toISOString();
      const newComments: GitHubComment[] = JSON.parse(commentsJson || '[]');
      const newReviews: GitHubReview[] = JSON.parse(reviewsJson || '[]');

      const approved = newReviews.some((r) => r.state === 'APPROVED');
      if (approved) {
        state.logs.push('[review] PR approved, proceeding to notification');
        break;
      }

      if (newComments.length === 0 && newReviews.length === 0) {
        consecutiveEmptyChecks++;
        if (consecutiveEmptyChecks >= 6) {
          state.logs.push(
            '[review] No review activity for 30 minutes, continuing to wait...',
          );
        }
        continue;
      }

      consecutiveEmptyChecks = 0;
      updateStatus(state, 'fixing_review');

      const feedbackComments = newComments.map((c) => ({
        author: c.user?.login ?? 'unknown',
        body: c.body,
        path: c.path,
        line: c.line,
      }));

      const fixPrompt = buildPRReviewFixPrompt(feedbackComments);
      const fixSession = createSession('execute');
      for await (const msg of runAgent(fixPrompt, {
        session: fixSession,
        workDir: effectiveWorkDir,
        modelConfig,
      })) {
        state.logs.push(`[review-fix-${state.reviewIterations}] ${msg.type}`);
        if (abortController.signal.aborted) throw new Error('Pipeline aborted');
      }

      // Re-verify, stage, commit, push
      const [reviewFixLint, reviewFixTsc] = await Promise.allSettled([
        runLint(effectiveWorkDir),
        runTypeCheck(effectiveWorkDir),
      ]);
      const reviewFixLintOk =
        reviewFixLint.status === 'fulfilled' && reviewFixLint.value.lintOk;
      const reviewFixTscOk =
        reviewFixTsc.status === 'fulfilled' && reviewFixTsc.value.tscOk;
      if (!reviewFixLintOk || !reviewFixTscOk) {
        state.logs.push(
          '[review-fix] Warning: lint/typecheck failures after review fix',
        );
      }

      const { stdout: fixedFiles } = await execAsync(
        'git diff --name-only HEAD',
        { cwd: effectiveWorkDir, timeout: 30_000 },
      );
      const filesToStage = fixedFiles.trim().split('\n').filter(Boolean);
      for (const file of filesToStage) {
        await execFileAsync('git', ['add', file], {
          cwd: effectiveWorkDir,
          timeout: 30_000,
        });
      }
      await execFileAsync(
        'git',
        [
          'commit',
          '-m',
          `address review feedback (iteration ${state.reviewIterations + 1})`,
        ],
        { cwd: effectiveWorkDir, timeout: 30_000 },
      );
      await execAsync('git push', {
        cwd: effectiveWorkDir,
        timeout: 120_000,
      });

      await execFileAsync(
        'gh',
        [
          'pr',
          'comment',
          String(state.prNumber),
          '--body',
          `Addressed review feedback (iteration ${state.reviewIterations + 1})`,
        ],
        { cwd: effectiveWorkDir, timeout: 30_000 },
      );

      state.reviewIterations++;
      updateStatus(state, 'awaiting_review');
      await persistState();
    }

    // ---- Step 8: Slack Notification ----
    updateStatus(state, 'notifying');
    if (config.slackWebhookUrl) {
      await sendSlackNotification(config.slackWebhookUrl, {
        title: 'PR Ready for Review',
        issueId: issue.identifier,
        issueTitle: issue.title,
        prUrl: state.prUrl ?? '',
        summary: diffStat,
        branch: branchName,
      }).catch((err) => {
        logger.error('Failed to send Slack notification', err);
      });
    }

    // ---- Step 9: Update Linear ----
    try {
      const teamStates = await getTeamStates(issue.team.id);
      const inReviewState = teamStates.find(
        (s) =>
          s.name.toLowerCase().includes('review') ||
          s.name.toLowerCase().includes('in review'),
      );
      if (inReviewState) {
        await updateIssueState(issue.id, inReviewState.id);
      }
      await addIssueComment(
        issue.id,
        `PR is ready for human review: ${state.prUrl}`,
      );
    } catch (err) {
      logger.error('Failed to update Linear issue', err);
    }

    state.status = 'completed';
  } catch (err) {
    state.status = 'failed';
    state.error = err instanceof Error ? err.message : String(err);
    await addIssueComment(issue.id, `Pipeline failed: ${state.error}`).catch(
      () => {},
    );
  } finally {
    clearTimeout(totalTimeout);

    // Record cost to daily budget tracker
    if (effectiveWorkDir) {
      const finalProgress = await readProgress(effectiveWorkDir).catch(
        () => null,
      );
      if (finalProgress?.totalCostUsd) {
        await recordTicketCost(
          issue.id,
          issue.identifier,
          finalProgress.totalCostUsd,
        ).catch((err) => logger.warn(`Failed to record ticket cost: ${err}`));
      }
    }

    // Update Swarm Mode task status
    if (swarmTaskId) {
      await updateSwarmTask(swarmTaskId, {
        status: state.status === 'completed' ? 'completed' : 'failed',
      }).catch((err) => logger.warn(`Failed to update swarm task: ${err}`));
    }

    // Clean up worktree if created
    if (baseRepoPath && effectiveWorkDir !== config.workspaceDir) {
      await cleanupWorktree(baseRepoPath, effectiveWorkDir).catch((err) =>
        logger.warn(`Worktree cleanup failed: ${err}`),
      );
    }

    const now = new Date();
    state.completedAt = now.toISOString();
    state.durationMs = now.getTime() - new Date(state.startedAt).getTime();
    state.updatedAt = now.toISOString();
    state.abortController = undefined;
    await persistState();
    logger.info(
      `Pipeline for ${issue.identifier} finished: ${state.status} (${state.durationMs}ms)`,
    );
  }
}
