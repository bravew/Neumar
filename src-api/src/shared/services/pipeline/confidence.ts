/**
 * Pipeline Confidence Evaluation & Approval Gate
 *
 * Evaluates plan confidence (1-10) using heuristics.
 * If confidence < threshold, pauses pipeline and waits for human approval
 * via Linear comment (polls for "approved"/"proceed"/"lgtm" or "reject"/"cancel").
 *
 * Industry standard: enterprise systems gate at 85% (~8.5/10).
 * We use 8/10 as default threshold.
 */

import { createLogger } from '@/shared/utils/logger';
import { sleep } from '@/shared/utils/sleep';

import { getIssueComments } from '../linear';
import type { RepoContext } from './prompts';

const logger = createLogger('PipelineConfidence');

// ============================================================================
// Types
// ============================================================================

export interface ConfidenceEvaluation {
  /** Overall confidence score (1-10) */
  score: number;
  /** Human-readable reasoning for the score */
  reasoning: string;
  /** Identified risks */
  risks: string[];
  /** Unknowns that lower confidence */
  unknowns: string[];
}

interface PlanLike {
  id: string;
  goal?: string;
  steps?: Array<{ description: string; status?: string }>;
}

interface IssueLike {
  identifier: string;
  title: string;
  description: string | null;
  labels: string[];
}

type RepoContextLike = Pick<
  RepoContext,
  'hasTests' | 'claudeMdContent' | 'packageJsonScripts'
>;

// ============================================================================
// Confidence scoring heuristics
// ============================================================================

const APPROVAL_KEYWORDS = [
  'approved',
  'approve',
  'proceed',
  'lgtm',
  'go ahead',
  'ship it',
];
const REJECTION_KEYWORDS = [
  'reject',
  'rejected',
  'cancel',
  'cancelled',
  'stop',
  'abort',
];

/**
 * Evaluate plan confidence using heuristics.
 * Returns a score from 1-10 with reasoning.
 */
export function evaluatePlanConfidence(
  plan: PlanLike | undefined,
  issue: IssueLike,
  repoCtx: RepoContextLike,
): ConfidenceEvaluation {
  let score = 7; // Base score
  const risks: string[] = [];
  const unknowns: string[] = [];
  const reasons: string[] = ['Base score: 7'];

  // --- Positive signals ---

  // Tests exist in the repo
  if (repoCtx.hasTests) {
    score += 1;
    reasons.push('+1: repo has tests (can verify changes)');
  }

  // CLAUDE.md provides conventions
  if (repoCtx.claudeMdContent) {
    score += 0.5;
    reasons.push('+0.5: CLAUDE.md present (conventions documented)');
  }

  // Issue has clear description with acceptance criteria
  if (issue.description && issue.description.length > 100) {
    score += 0.5;
    reasons.push('+0.5: detailed issue description (>100 chars)');
  }

  // Lint/test scripts available
  if (
    repoCtx.packageJsonScripts['lint'] ||
    repoCtx.packageJsonScripts['test']
  ) {
    score += 0.5;
    reasons.push('+0.5: lint/test scripts available');
  }

  // --- Negative signals ---

  // Plan has too many steps (complex change)
  const stepCount = plan?.steps?.length ?? 0;
  if (stepCount > 20) {
    score -= 2;
    risks.push('Plan has >20 steps — high complexity');
    reasons.push('-2: >20 plan steps');
  } else if (stepCount > 10) {
    score -= 1;
    risks.push('Plan has >10 steps — moderate complexity');
    reasons.push('-1: >10 plan steps');
  }

  // No plan at all
  if (!plan || stepCount === 0) {
    score -= 2;
    unknowns.push('No structured plan generated');
    reasons.push('-2: no plan or empty plan');
  }

  // Vague issue description
  if (!issue.description || issue.description.length < 30) {
    score -= 1;
    unknowns.push('Issue description is too brief or missing');
    reasons.push('-1: vague/missing description');
  }

  // No tests in repo (can't verify)
  if (!repoCtx.hasTests) {
    risks.push('No tests in repo — changes cannot be verified automatically');
  }

  // Clamp to [1, 10]
  score = Math.max(1, Math.min(10, Math.round(score * 10) / 10));

  return {
    score,
    reasoning: reasons.join('; '),
    risks,
    unknowns,
  };
}

/**
 * Format the plan and confidence evaluation as a Linear comment.
 */
export function formatPlanForLinear(
  plan: PlanLike | undefined,
  confidence: ConfidenceEvaluation,
  issueIdentifier: string,
): string {
  const lines: string[] = [
    `## Implementation Plan for ${issueIdentifier}`,
    '',
    `**Confidence: ${confidence.score}/10**`,
    `> ${confidence.reasoning}`,
    '',
  ];

  if (plan?.goal) {
    lines.push(`### Goal`, plan.goal, '');
  }

  if (plan?.steps?.length) {
    lines.push(`### Steps (${plan.steps.length})`);
    for (let i = 0; i < plan.steps.length; i++) {
      lines.push(`${i + 1}. ${plan.steps[i]!.description}`);
    }
    lines.push('');
  }

  if (confidence.risks.length > 0) {
    lines.push(`### Risks`);
    for (const risk of confidence.risks) {
      lines.push(`- ⚠️ ${risk}`);
    }
    lines.push('');
  }

  if (confidence.unknowns.length > 0) {
    lines.push(`### Unknowns`);
    for (const unknown of confidence.unknowns) {
      lines.push(`- ❓ ${unknown}`);
    }
    lines.push('');
  }

  if (confidence.score < 8) {
    lines.push(
      '---',
      '**Action required**: Confidence is below threshold (8/10).',
      'Reply **"approved"** to proceed with implementation, or **"reject"** to cancel.',
      '',
    );
  }

  return lines.join('\n');
}

/**
 * Wait for human approval via Linear comments.
 * Polls every 2 minutes for approval/rejection keywords.
 *
 * @param approvedByNames - If provided, only comments from these users (by display name) are accepted.
 *                          If empty/undefined, any commenter can approve.
 * @returns true if approved, false if rejected or timeout
 */
export async function waitForApproval(
  issueId: string,
  signal: AbortSignal,
  timeoutMs = 4 * 3600_000, // 4 hours default
  approvedByNames?: string[],
): Promise<boolean> {
  const startTime = Date.now();
  const pollIntervalMs = 120_000; // 2 minutes
  const checkAfter = new Date().toISOString(); // Only check comments after this time

  logger.info('Waiting for human approval on Linear', { issueId, timeoutMs });

  while (Date.now() - startTime < timeoutMs) {
    if (signal.aborted) return false;

    await sleep(pollIntervalMs, signal);
    if (signal.aborted) return false;

    try {
      const comments = await getIssueComments(issueId);

      // Check only new comments (after we posted the plan)
      const newComments = comments.filter(
        (c) => new Date(c.createdAt).toISOString() > checkAfter,
      );

      for (const comment of newComments) {
        const body = comment.body.toLowerCase().trim();

        // If approvedByNames is set, only accept comments from authorized users
        if (approvedByNames && approvedByNames.length > 0) {
          const isAuthorized = approvedByNames.some(
            (name) => name.toLowerCase() === comment.user.toLowerCase(),
          );
          if (!isAuthorized) {
            logger.debug('Ignoring approval comment from unauthorized user', {
              issueId,
              user: comment.user,
            });
            continue;
          }
        }

        if (APPROVAL_KEYWORDS.some((kw) => body.includes(kw))) {
          logger.info('Plan approved via Linear comment', {
            issueId,
            by: comment.user,
          });
          return true;
        }

        if (REJECTION_KEYWORDS.some((kw) => body.includes(kw))) {
          logger.info('Plan rejected via Linear comment', {
            issueId,
            by: comment.user,
          });
          return false;
        }
      }
    } catch (err) {
      logger.warn('Failed to poll Linear comments for approval', {
        issueId,
        err,
      });
    }
  }

  logger.warn('Approval timeout reached', { issueId, timeoutMs });
  return false;
}
