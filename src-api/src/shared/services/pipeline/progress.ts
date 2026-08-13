/**
 * Pipeline Progress File
 *
 * Implements Anthropic's claude-progress.txt pattern for state persistence
 * across agent handoffs. Each pipeline agent reads this file to understand
 * what prior agents accomplished, then writes its own results back.
 *
 * Stored at {worktreePath}/.pipeline-progress.json
 */

import fs from 'fs/promises';
import { join } from 'path';

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('PipelineProgress');

const PROGRESS_FILENAME = '.pipeline-progress.json';

// ============================================================================
// Types
// ============================================================================

export interface PhaseRecord {
  phase: string;
  status: 'completed' | 'failed' | 'skipped';
  summary: string;
  timestamp: string;
  durationMs?: number;
  artifacts?: string[];
  costUsd?: number;
}

export interface PipelineProgress {
  /** Linear issue ID */
  issueId: string;
  /** Linear issue identifier (e.g., ENG-123) */
  issueIdentifier: string;
  /** Issue title */
  issueTitle: string;
  /** Current pipeline phase */
  currentPhase: string;
  /** Completed phase records */
  completedPhases: PhaseRecord[];
  /** Triage classification result */
  classification?: {
    type: string;
    complexity: string;
    branchName: string;
  };
  /** Serialized implementation plan (markdown) */
  plan?: string;
  /** Plan confidence score (1-10) */
  confidence?: number;
  /** Condensed web research findings */
  researchFindings?: string;
  /** Evaluator feedback from each cycle */
  evaluatorFeedback?: string[];
  /** Current blockers or risks */
  blockers?: string[];
  /** Cumulative cost tracking */
  totalCostUsd?: number;
  /** Repository info */
  repo?: {
    owner: string;
    name: string;
    baseBranch: string;
  };
  /** PR info (populated after PR creation) */
  pr?: {
    url: string;
    number: number;
    branch: string;
  };
  /** Pipeline start time */
  startedAt: string;
  /** Last update time */
  updatedAt: string;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Read progress file from a worktree. Returns null if not found.
 */
export async function readProgress(
  worktreePath: string,
): Promise<PipelineProgress | null> {
  const filePath = join(worktreePath, PROGRESS_FILENAME);
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data) as PipelineProgress;
  } catch {
    return null;
  }
}

/**
 * Write progress file to a worktree. Creates or overwrites.
 */
export async function writeProgress(
  worktreePath: string,
  progress: PipelineProgress,
): Promise<void> {
  const filePath = join(worktreePath, PROGRESS_FILENAME);
  progress.updatedAt = new Date().toISOString();
  try {
    await fs.writeFile(filePath, JSON.stringify(progress, null, 2));
  } catch (err) {
    logger.error('Failed to write progress file', { filePath, err });
  }
}

/**
 * Initialize a new progress file for a pipeline run.
 */
export function createInitialProgress(
  issueId: string,
  issueIdentifier: string,
  issueTitle: string,
): PipelineProgress {
  return {
    issueId,
    issueIdentifier,
    issueTitle,
    currentPhase: 'queued',
    completedPhases: [],
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Record a completed phase in the progress file.
 */
export async function recordPhaseCompletion(
  worktreePath: string,
  phase: string,
  summary: string,
  opts?: {
    status?: 'completed' | 'failed' | 'skipped';
    durationMs?: number;
    artifacts?: string[];
    costUsd?: number;
  },
): Promise<void> {
  const progress = await readProgress(worktreePath);
  if (!progress) {
    logger.warn('No progress file found, skipping phase record', {
      worktreePath,
      phase,
    });
    return;
  }

  const record: PhaseRecord = {
    phase,
    status: opts?.status ?? 'completed',
    summary,
    timestamp: new Date().toISOString(),
    durationMs: opts?.durationMs,
    artifacts: opts?.artifacts,
    costUsd: opts?.costUsd,
  };

  progress.completedPhases.push(record);
  progress.currentPhase = phase;

  if (opts?.costUsd) {
    progress.totalCostUsd = (progress.totalCostUsd ?? 0) + opts.costUsd;
  }

  await writeProgress(worktreePath, progress);
}

/**
 * Format progress as a concise text block for agent context injection.
 * This is what agents read at session start to understand prior work.
 */
export function formatProgressForAgent(progress: PipelineProgress): string {
  const lines: string[] = [
    `## Pipeline Progress for ${progress.issueIdentifier}: ${progress.issueTitle}`,
    `Current phase: ${progress.currentPhase}`,
    `Started: ${progress.startedAt}`,
    '',
  ];

  if (progress.classification) {
    lines.push(
      `### Classification`,
      `Type: ${progress.classification.type} | Complexity: ${progress.classification.complexity}`,
      `Branch: ${progress.classification.branchName}`,
      '',
    );
  }

  if (progress.researchFindings) {
    lines.push(`### Research Findings`, progress.researchFindings, '');
  }

  if (progress.plan) {
    lines.push(
      `### Implementation Plan (confidence: ${progress.confidence ?? '?'}/10)`,
      progress.plan,
      '',
    );
  }

  if (progress.completedPhases.length > 0) {
    lines.push(`### Completed Phases`);
    for (const p of progress.completedPhases) {
      const cost = p.costUsd ? ` ($${p.costUsd.toFixed(3)})` : '';
      const duration = p.durationMs
        ? ` (${Math.round(p.durationMs / 1000)}s)`
        : '';
      lines.push(`- [${p.status}] ${p.phase}: ${p.summary}${duration}${cost}`);
    }
    lines.push('');
  }

  if (progress.evaluatorFeedback?.length) {
    lines.push(`### Evaluator Feedback`);
    for (const fb of progress.evaluatorFeedback) {
      lines.push(`- ${fb}`);
    }
    lines.push('');
  }

  if (progress.blockers?.length) {
    lines.push(`### Blockers`);
    for (const b of progress.blockers) {
      lines.push(`- ${b}`);
    }
    lines.push('');
  }

  if (progress.pr) {
    lines.push(
      `### PR`,
      `${progress.pr.url} (branch: ${progress.pr.branch})`,
      '',
    );
  }

  return lines.join('\n');
}

/**
 * Clean up progress file after pipeline completes.
 * Optionally keeps the file for post-mortem analysis.
 */
export async function cleanupProgress(
  worktreePath: string,
  keep = false,
): Promise<void> {
  if (keep) return;
  const filePath = join(worktreePath, PROGRESS_FILENAME);
  try {
    await fs.unlink(filePath);
  } catch {
    // File may not exist, that's fine
  }
}
