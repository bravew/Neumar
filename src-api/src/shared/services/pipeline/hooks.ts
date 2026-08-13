/**
 * Pipeline Phase-Transition Hooks
 *
 * Fires side effects at each pipeline phase transition:
 * 1. Updates Linear issue workflow state
 * 2. Posts concise status comments on the Linear issue
 *
 * All operations are fire-and-forget to avoid blocking the pipeline.
 */

import {
  formatMessage,
  getPipelineMessages,
  type PipelineLocale,
} from '@/config/locale/pipeline';

import { createLogger } from '@/shared/utils/logger';

import { addIssueComment, getTeamStates, updateIssueState } from '../linear';
import { createMemory } from '../memory/store';
import type { PipelineStatus } from './pipeline';

const logger = createLogger('PipelineHooks');

// ============================================================================
// Types
// ============================================================================

export interface PipelinePhaseContext {
  issueId: string;
  issueIdentifier: string;
  issueTitle: string;
  teamId: string;
  previousStatus: PipelineStatus;
  newStatus: PipelineStatus;
  branch?: string;
  prUrl?: string;
  prNumber?: number;
  error?: string;
  confidence?: number;
  planSummary?: string;
  locale?: PipelineLocale | string;
}

// ============================================================================
// State name -> Linear workflow state mapping
// ============================================================================

/** Map pipeline phases to Linear workflow state names. */
const PHASE_TO_LINEAR_STATE: Record<string, string> = {
  triaging: 'In Progress',
  branching: 'In Progress',
  researching: 'In Progress',
  implementing: 'In Progress',
  verifying: 'In Progress',
  evaluating: 'In Progress',
  self_reviewing: 'In Progress',
  creating_pr: 'In Review',
  awaiting_ci: 'In Review',
  awaiting_approval: 'In Review',
  awaiting_review: 'In Review',
  fixing_review: 'In Review',
  fixing_ci: 'In Review',
  completed: 'Done',
};

function buildPhaseComment(
  phase: PipelineStatus,
  ctx: PipelinePhaseContext,
): string | null {
  const m = getPipelineMessages(ctx.locale);

  switch (phase) {
    case 'triaging':
      return `🔍 ${formatMessage(m.triaging, { issueIdentifier: ctx.issueIdentifier })}`;
    case 'branching':
      return ctx.branch
        ? `🌿 ${formatMessage(m.branchCreated, { branch: ctx.branch })}`
        : `🌿 ${m.settingUpWorkspace}`;
    case 'researching':
      return `📚 ${m.researching}`;
    case 'implementing':
      return `⚙️ ${m.implementing}`;
    case 'awaiting_approval':
      return ctx.confidence !== undefined
        ? `📋 ${formatMessage(m.awaitingApprovalWithScore, { confidence: ctx.confidence })}\n\n${ctx.planSummary ?? ''}`
        : `📋 ${m.awaitingApproval}`;
    case 'creating_pr':
      return `📝 ${m.creatingPr}`;
    case 'awaiting_review':
      return ctx.prUrl
        ? `🔗 ${formatMessage(m.awaitingReviewWithUrl, { prUrl: ctx.prUrl })}`
        : `🔗 ${m.awaitingReview}`;
    case 'awaiting_ci':
      return `🏗️ ${m.awaitingCi}`;
    case 'completed':
      return `✅ ${m.completed}`;
    case 'failed':
      return `❌ ${formatMessage(m.failed, { error: ctx.error ?? 'unknown error' })}`;
    default:
      return null;
  }
}

// ============================================================================
// Team state cache (avoids repeated API calls within a pipeline run)
// ============================================================================

const teamStateCache = new Map<string, Map<string, string>>();
const TEAM_STATE_CACHE_TTL_MS = 600_000; // 10 minutes
let teamStateCacheTime = 0;

async function resolveStateId(
  teamId: string,
  stateName: string,
): Promise<string | null> {
  if (!teamId) return null;

  // Check cache freshness
  if (Date.now() - teamStateCacheTime > TEAM_STATE_CACHE_TTL_MS) {
    teamStateCache.clear();
    teamStateCacheTime = Date.now();
  }

  let stateMap = teamStateCache.get(teamId);
  if (!stateMap) {
    try {
      const states = await getTeamStates(teamId);
      stateMap = new Map(states.map((s) => [s.name, s.id]));
      teamStateCache.set(teamId, stateMap);
    } catch (err) {
      logger.warn('Failed to fetch team states', { teamId, err });
      return null;
    }
  }

  return stateMap.get(stateName) ?? null;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Fire phase-transition side effects (fire-and-forget).
 * Call this from pipeline.ts updateStatus().
 */
export async function onPhaseTransition(
  ctx: PipelinePhaseContext,
): Promise<void> {
  const tasks: Promise<void>[] = [];

  // 1. Update Linear workflow state
  const targetStateName = PHASE_TO_LINEAR_STATE[ctx.newStatus];
  if (targetStateName && ctx.teamId) {
    const previousStateName = PHASE_TO_LINEAR_STATE[ctx.previousStatus];
    // Only update if the Linear state actually changes
    if (targetStateName !== previousStateName) {
      tasks.push(
        resolveStateId(ctx.teamId, targetStateName)
          .then((stateId) => {
            if (stateId) {
              return updateIssueState(ctx.issueId, stateId);
            }
          })
          .catch((err) =>
            logger.warn('Failed to update Linear state', {
              issueId: ctx.issueIdentifier,
              targetState: targetStateName,
              err,
            }),
          ),
      );
    }
  }

  // 2. Post phase comment (i18n-aware)
  const comment = buildPhaseComment(ctx.newStatus, ctx);
  if (comment) {
    tasks.push(
      addIssueComment(ctx.issueId, comment).catch((err) =>
        logger.warn('Failed to post phase comment', {
          issueId: ctx.issueIdentifier,
          phase: ctx.newStatus,
          err,
        }),
      ),
    );
  }

  // 3. Knowledge capture (fire-and-forget, never blocks pipeline)
  try {
    if (ctx.newStatus === 'completed') {
      createMemory({
        content: `Pipeline succeeded for ${ctx.issueIdentifier}: ${ctx.issueTitle}`,
        category: 'fact',
        memoryType: 'semantic',
        scopeType: 'project',
        importance: 0.6,
        metadata: {
          source: 'pipeline',
          issueId: ctx.issueId,
          phase: 'completed',
        },
      });
    } else if (ctx.newStatus === 'failed' && ctx.error) {
      createMemory({
        content: `Pipeline failed for ${ctx.issueIdentifier}: ${ctx.error}`,
        category: 'correction',
        memoryType: 'procedural',
        scopeType: 'project',
        importance: 0.8,
        metadata: { source: 'pipeline', issueId: ctx.issueId, phase: 'failed' },
      });
    }
  } catch (err) {
    logger.warn('Knowledge capture failed', { err });
  }

  await Promise.allSettled(tasks);
}

/**
 * Clear the team state cache (e.g., on config change).
 */
export function clearTeamStateCache(): void {
  teamStateCache.clear();
  teamStateCacheTime = 0;
}
