/**
 * Pipeline Orchestrator
 *
 * High-level coordinator for the multi-agent pipeline.
 * Wraps the existing runTicketPipeline with:
 * - Pre-pipeline: web research phase
 * - Confidence-gated execution with Linear approval
 * - Post-pipeline: CI monitoring
 *
 * Designed to be called instead of runTicketPipeline in processQueue().
 * Falls back gracefully: if any new phase fails, the existing pipeline
 * behavior is preserved.
 */

import { createLogger } from '@/shared/utils/logger';

import { addIssueComment, createIssue } from '../linear';
import type { LinearIssue } from '../linear';
import {
  allChecksPassed,
  buildCIFixPrompt,
  getFailedChecks,
  waitForCIChecks,
} from './ci';
import {
  evaluatePlanConfidence,
  formatPlanForLinear,
  waitForApproval,
} from './confidence';
import {
  createInitialProgress,
  recordPhaseCompletion,
  writeProgress,
} from './progress';
import type { RepoInfo } from './prompts';
import { conductResearch, formatResearchBlock } from './research';

const logger = createLogger('PipelineOrchestrator');

// ============================================================================
// Types
// ============================================================================

export interface OrchestratorOptions {
  /** Confidence threshold (1-10) below which human approval is required. Default: 8 */
  confidenceThreshold?: number;
  /** Enable web research before planning. Default: true */
  enableResearch?: boolean;
  /** Enable CI monitoring after PR creation. Default: true */
  enableCIMonitoring?: boolean;
  /** Max budget in USD for the entire pipeline. Default: 10 */
  maxBudgetUsd?: number;
  /** Max evaluator iterations. Default: 5 */
  maxEvaluatorIterations?: number;
  /** Max CI fix attempts. Default: 2 */
  maxCIFixAttempts?: number;
}

const DEFAULT_OPTIONS: Required<OrchestratorOptions> = {
  confidenceThreshold: 8,
  enableResearch: true,
  enableCIMonitoring: true,
  maxBudgetUsd: 10,
  maxEvaluatorIterations: 5,
  maxCIFixAttempts: 2,
};

// ============================================================================
// Pre-pipeline phases (called before existing runTicketPipeline)
// ============================================================================

/**
 * Run the web research phase.
 * Returns a formatted research block for prompt injection, or empty string.
 */
export async function runResearchPhase(
  issue: LinearIssue,
  repoCtx: {
    packageJsonScripts: Record<string, string>;
    directoryStructure: string;
    packageManager: 'pnpm' | 'npm' | 'yarn';
  },
  worktreePath: string,
  signal?: AbortSignal,
): Promise<string> {
  try {
    const findings = await conductResearch(issue, repoCtx, signal);

    if (worktreePath) {
      await recordPhaseCompletion(
        worktreePath,
        'researching',
        `Found ${findings.bestPractices.length} practices, ${findings.relevantDocs.length} docs for [${findings.techStack.join(', ')}]`,
        { durationMs: findings.totalLatencyMs },
      );
    }

    if (findings.bestPractices.length > 0) {
      await addIssueComment(
        issue.id,
        `**Research**: Found ${findings.bestPractices.length} best practices for ${findings.techStack.join(', ')}.`,
      ).catch(() => {});
    }

    return formatResearchBlock(findings);
  } catch (err) {
    logger.warn('Research phase failed, continuing without research', { err });
    return '';
  }
}

/**
 * Check if an issue matches any requireApprovalFor categories.
 * Matches against issue labels and title keywords.
 */
function matchesApprovalCategories(
  issue: LinearIssue,
  categories: string[],
): string | null {
  if (categories.length === 0) return null;

  const labelsLower = issue.labels.map((l) => l.toLowerCase());
  const titleLower = issue.title.toLowerCase();
  const descLower = (issue.description ?? '').toLowerCase();

  for (const category of categories) {
    const cat = category.toLowerCase();
    if (
      labelsLower.some((l) => l.includes(cat)) ||
      titleLower.includes(cat) ||
      descLower.includes(cat)
    ) {
      return category;
    }
  }
  return null;
}

/**
 * Evaluate plan confidence and gate execution if below threshold.
 * Posts the plan to Linear and waits for approval if needed.
 *
 * Also forces approval for issues matching `requireApprovalFor` categories
 * (e.g., "security", "database", "infra", "api-breaking") regardless of score.
 *
 * @returns true if execution should proceed, false if rejected/timeout
 */
export async function runConfidenceGate(
  plan:
    | {
        id: string;
        goal?: string;
        steps?: Array<{ description: string; status?: string }>;
      }
    | undefined,
  issue: LinearIssue,
  repoCtx: {
    hasTests: boolean;
    claudeMdContent: string | null;
    packageJsonScripts: Record<string, string>;
  },
  signal: AbortSignal,
  threshold = DEFAULT_OPTIONS.confidenceThreshold,
  requireApprovalFor: string[] = [],
  approvalAuthorizedNames: string[] = [],
): Promise<{ proceed: boolean; confidence: number; approvalReason?: string }> {
  const evaluation = evaluatePlanConfidence(plan, issue, repoCtx);

  logger.info('Plan confidence evaluated', {
    issue: issue.identifier,
    score: evaluation.score,
    threshold,
    risks: evaluation.risks.length,
    unknowns: evaluation.unknowns.length,
  });

  // Check for forced approval categories
  const matchedCategory = matchesApprovalCategories(issue, requireApprovalFor);

  // Post plan to Linear regardless of confidence
  const planComment = formatPlanForLinear(plan, evaluation, issue.identifier);
  const categoryNote = matchedCategory
    ? `\n\n> ⚠️ **Requires human approval** — issue matches category: \`${matchedCategory}\``
    : '';
  await addIssueComment(issue.id, planComment + categoryNote).catch(() => {});

  // Force approval for matching categories regardless of confidence score
  if (matchedCategory) {
    logger.info('Forced approval required for category', {
      issue: issue.identifier,
      category: matchedCategory,
      score: evaluation.score,
    });
    const approved = await waitForApproval(
      issue.id,
      signal,
      undefined,
      approvalAuthorizedNames.length > 0 ? approvalAuthorizedNames : undefined,
    );
    return {
      proceed: approved,
      confidence: evaluation.score,
      approvalReason: `category:${matchedCategory}`,
    };
  }

  if (evaluation.score >= threshold) {
    logger.info('Confidence above threshold, auto-proceeding', {
      issue: issue.identifier,
      score: evaluation.score,
    });
    return { proceed: true, confidence: evaluation.score };
  }

  // Below threshold: wait for human approval
  logger.info('Confidence below threshold, waiting for approval', {
    issue: issue.identifier,
    score: evaluation.score,
    threshold,
  });

  const approved = await waitForApproval(
    issue.id,
    signal,
    undefined,
    approvalAuthorizedNames.length > 0 ? approvalAuthorizedNames : undefined,
  );
  return {
    proceed: approved,
    confidence: evaluation.score,
    approvalReason: `score:${evaluation.score}<${threshold}`,
  };
}

/**
 * Run a single CI check cycle after PR creation.
 * Returns pass/fail and a fix prompt if checks failed.
 * Caller is responsible for the retry loop (run fix agent, then call again).
 */
export async function runCIMonitorPhase(
  workDir: string,
  signal: AbortSignal,
): Promise<{ passed: boolean; fixPrompt?: string }> {
  const results = await waitForCIChecks(workDir, signal);

  if (results.length === 0) {
    logger.info('No CI checks found, skipping CI monitoring');
    return { passed: true };
  }

  if (allChecksPassed(results)) {
    logger.info('All CI checks passed');
    return { passed: true };
  }

  const failed = getFailedChecks(results);
  logger.warn('CI checks failed', { failed: failed.length });
  return { passed: false, fixPrompt: buildCIFixPrompt(failed) };
}

/**
 * Initialize the orchestrator progress file for a new pipeline run.
 */
export async function initializeOrchestrator(
  issue: LinearIssue,
  worktreePath: string,
): Promise<void> {
  const progress = createInitialProgress(
    issue.id,
    issue.identifier,
    issue.title,
  );
  await writeProgress(worktreePath, progress);
}

/**
 * Get the merged orchestrator options with defaults.
 */
export function resolveOptions(
  opts?: OrchestratorOptions,
): Required<OrchestratorOptions> {
  return { ...DEFAULT_OPTIONS, ...opts };
}

// ============================================================================
// Multi-repo decomposition
// ============================================================================

const MAX_SUB_ISSUES = 5;

/**
 * Decompose a multi-repo issue into per-repo sub-issues on Linear.
 * Creates child issues under the parent, each scoped to a single repo.
 * Returns the created sub-issues for parallel pipeline execution.
 *
 * Capped at MAX_SUB_ISSUES to prevent runaway decomposition.
 */
export async function decomposeMultiRepoIssue(
  parentIssue: LinearIssue,
  repos: RepoInfo[],
): Promise<LinearIssue[]> {
  if (repos.length <= 1) return [];

  const capped = repos.slice(0, MAX_SUB_ISSUES);
  logger.info('Decomposing multi-repo issue', {
    parent: parentIssue.identifier,
    repos: capped.map((r) => `${r.owner}/${r.repo}`),
  });

  const results = await Promise.allSettled(
    capped.map((repo) =>
      createIssue({
        teamId: parentIssue.team.id,
        title: `[${repo.repo}] ${parentIssue.title}`,
        description: [
          `Sub-task of ${parentIssue.identifier}: ${parentIssue.title}`,
          '',
          `**Target repo**: ${repo.owner}/${repo.repo}`,
          '',
          parentIssue.description ?? '',
        ].join('\n'),
        parentId: parentIssue.id,
        priority: parentIssue.priority,
      }),
    ),
  );

  const subIssues: LinearIssue[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    const repo = capped[i]!;
    if (result.status === 'fulfilled') {
      subIssues.push(result.value);
      logger.info(
        `Created sub-issue ${result.value.identifier} for ${repo.owner}/${repo.repo}`,
      );
    } else {
      logger.error(
        `Failed to create sub-issue for ${repo.owner}/${repo.repo}`,
        { err: result.reason },
      );
    }
  }

  if (subIssues.length > 0) {
    await addIssueComment(
      parentIssue.id,
      `Decomposed into ${subIssues.length} sub-issue(s): ${subIssues.map((s) => s.identifier).join(', ')}`,
    ).catch(() => {});
  }

  return subIssues;
}
