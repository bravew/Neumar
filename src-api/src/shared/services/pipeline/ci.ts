/**
 * Pipeline CI/CD Integration
 *
 * Monitors GitHub Actions check runs after PR creation.
 * Polls for completion, extracts failure logs, and builds
 * fix prompts for the verifier/ci_monitor agent.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

import { createLogger } from '@/shared/utils/logger';
import { sleep } from '@/shared/utils/sleep';

const execAsync = promisify(exec);
const logger = createLogger('PipelineCI');

// ============================================================================
// Types
// ============================================================================

export interface CICheckResult {
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion:
    | 'success'
    | 'failure'
    | 'neutral'
    | 'cancelled'
    | 'timed_out'
    | 'skipped'
    | null;
  outputSummary?: string;
  outputText?: string;
  detailsUrl?: string;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Wait for all CI check runs to complete on the current HEAD commit.
 * Polls every 60 seconds until all checks finish or timeout.
 *
 * @param workDir - Git working directory (worktree path)
 * @param signal - Abort signal for cancellation
 * @param timeoutMs - Max wait time (default: 15 minutes)
 * @returns Array of completed check results
 */
export async function waitForCIChecks(
  workDir: string,
  signal: AbortSignal,
  timeoutMs = 15 * 60_000,
): Promise<CICheckResult[]> {
  const startTime = Date.now();
  const pollIntervalMs = 60_000;

  logger.info('Waiting for CI checks', { workDir, timeoutMs });

  // Get the current HEAD SHA
  const { stdout: sha } = await execAsync('git rev-parse HEAD', {
    cwd: workDir,
    timeout: 10_000,
  });
  const commitSha = sha.trim();

  // Get repo slug
  const { stdout: repoSlug } = await execAsync(
    'gh repo view --json nameWithOwner -q .nameWithOwner',
    { cwd: workDir, timeout: 15_000 },
  );
  const repo = repoSlug.trim();

  while (Date.now() - startTime < timeoutMs) {
    if (signal.aborted) return [];

    try {
      const { stdout: checksJson } = await execAsync(
        `gh api repos/${repo}/commits/${commitSha}/check-runs --jq '.check_runs | [.[] | {name, status, conclusion, output: {summary: .output.summary, text: .output.text}, details_url: .details_url}]'`,
        { cwd: workDir, timeout: 30_000 },
      );

      const rawChecks = JSON.parse(checksJson || '[]') as Array<{
        name: string;
        status: string;
        conclusion: string | null;
        output?: { summary?: string; text?: string };
        details_url?: string;
      }>;

      if (rawChecks.length === 0) {
        logger.debug('No check runs found yet, waiting...', { commitSha });
        await sleep(pollIntervalMs, signal);
        continue;
      }

      const allCompleted = rawChecks.every((c) => c.status === 'completed');

      if (allCompleted) {
        const results: CICheckResult[] = rawChecks.map((c) => ({
          name: c.name,
          status: c.status as CICheckResult['status'],
          conclusion: c.conclusion as CICheckResult['conclusion'],
          outputSummary: c.output?.summary?.slice(0, 500),
          outputText: c.output?.text?.slice(0, 2000),
          detailsUrl: c.details_url,
        }));

        const failed = results.filter((r) => r.conclusion === 'failure');
        logger.info('CI checks completed', {
          total: results.length,
          passed: results.filter((r) => r.conclusion === 'success').length,
          failed: failed.length,
        });

        return results;
      }

      const pending = rawChecks.filter((c) => c.status !== 'completed');
      logger.debug('CI checks still running', {
        pending: pending.map((c) => c.name),
      });
    } catch (err) {
      logger.warn('Failed to poll CI checks', { err });
    }

    await sleep(pollIntervalMs, signal);
  }

  logger.warn('CI check timeout reached', { timeoutMs });
  return [];
}

/**
 * Build a prompt for the CI fix agent based on failed checks.
 */
export function buildCIFixPrompt(failedChecks: CICheckResult[]): string {
  const lines: string[] = [
    'The following CI checks have failed. Diagnose and fix each issue:',
    '',
  ];

  for (const check of failedChecks) {
    lines.push(`## Failed: ${check.name}`);
    if (check.outputSummary) {
      lines.push(`Summary: ${check.outputSummary}`);
    }
    if (check.outputText) {
      lines.push('```', check.outputText, '```');
    }
    if (check.detailsUrl) {
      lines.push(`Details: ${check.detailsUrl}`);
    }
    lines.push('');
  }

  lines.push(
    'Instructions:',
    '1. Read the error output carefully',
    '2. Identify the root cause (not just the symptom)',
    '3. Fix the issue in the source code',
    '4. Run the failing check locally to verify the fix',
    '5. Stage, commit, and push the fix',
    '',
  );

  return lines.join('\n');
}

/**
 * Check if all CI results passed.
 */
export function allChecksPassed(results: CICheckResult[]): boolean {
  return (
    results.length > 0 &&
    results.every(
      (r) =>
        r.conclusion === 'success' ||
        r.conclusion === 'neutral' ||
        r.conclusion === 'skipped',
    )
  );
}

/**
 * Get only the failed checks from results.
 */
export function getFailedChecks(results: CICheckResult[]): CICheckResult[] {
  return results.filter((r) => r.conclusion === 'failure');
}
