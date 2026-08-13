/**
 * Git Worktree Management
 *
 * Creates and manages git worktrees for agent workspace isolation.
 * Each agent can work in an isolated worktree to prevent dirty files
 * from failed experiments in the main working directory.
 *
 * Limitations:
 * - Worktrees share the same .git directory — locks can cause issues
 *   with concurrent worktrees. Limit to 1 worktree per repo at a time.
 * - All paths are shell-escaped via execFile to prevent command injection.
 */

import { execFile as execFileCb } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('Worktree');
const execFile = promisify(execFileCb);

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
  bare: boolean;
}

/**
 * Sanitize a branch name to prevent path traversal and invalid git ref names.
 * Only allows alphanumeric, hyphens, and underscores.
 */
function sanitizeBranchName(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!sanitized) throw new Error('Branch name is empty after sanitization');
  return sanitized;
}

/**
 * Check whether a directory is inside a git repository.
 */
async function isGitRepo(dirPath: string): Promise<boolean> {
  try {
    const { stdout } = await execFile('git', [
      '-C',
      dirPath,
      'rev-parse',
      '--is-inside-work-tree',
    ]);
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Create a new git worktree with an isolated branch.
 *
 * @param repoPath - Root of the git repository
 * @param branchName - Name for the new branch in the worktree
 * @returns Path to the worktree directory and the branch name
 */
export async function createWorktree(
  repoPath: string,
  branchName: string,
): Promise<{ worktreePath: string; branch: string }> {
  if (!(await isGitRepo(repoPath))) {
    throw new Error(`Not a git repository: ${repoPath}`);
  }

  const safeBranch = sanitizeBranchName(branchName);
  const worktreePath = join(tmpdir(), `neumar-worktree-${safeBranch}`);
  logger.info(`Creating worktree at ${worktreePath} (branch: ${safeBranch})`);

  await execFile('git', [
    '-C',
    repoPath,
    'worktree',
    'add',
    worktreePath,
    '-b',
    safeBranch,
  ]);
  logger.info(`Worktree created: ${worktreePath}`);

  return { worktreePath, branch: safeBranch };
}

/**
 * Remove a git worktree and optionally delete its branch.
 *
 * @param repoPath - Root of the git repository
 * @param worktreePath - Path to the worktree to remove
 * @param deleteBranch - Whether to also delete the branch (default: true)
 */
export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  deleteBranch = true,
): Promise<void> {
  logger.info(`Removing worktree: ${worktreePath}`);

  // Extract branch name from worktree before removal
  let branchName: string | undefined;
  if (deleteBranch) {
    try {
      const { stdout } = await execFile('git', [
        '-C',
        worktreePath,
        'rev-parse',
        '--abbrev-ref',
        'HEAD',
      ]);
      branchName = stdout.trim();
    } catch {
      logger.warn('Could not determine worktree branch name');
    }
  }

  await execFile('git', [
    '-C',
    repoPath,
    'worktree',
    'remove',
    worktreePath,
    '--force',
  ]);
  logger.info(`Worktree removed: ${worktreePath}`);

  if (deleteBranch && branchName && branchName !== 'HEAD') {
    try {
      await execFile('git', ['-C', repoPath, 'branch', '-D', branchName]);
      logger.info(`Branch deleted: ${branchName}`);
    } catch (err) {
      logger.warn(`Failed to delete branch ${branchName}:`, err);
    }
  }
}

/**
 * Merge a worktree branch into a target branch.
 *
 * @param repoPath - Root of the git repository
 * @param branchName - The worktree branch to merge
 * @param targetBranch - The branch to merge into (default: 'main')
 * @returns Merge result output
 */
export async function mergeWorktree(
  repoPath: string,
  branchName: string,
  targetBranch = 'main',
): Promise<string> {
  logger.info(`Merging ${branchName} into ${targetBranch}`);

  // Save current branch
  const { stdout: currentBranch } = await execFile('git', [
    '-C',
    repoPath,
    'rev-parse',
    '--abbrev-ref',
    'HEAD',
  ]);

  try {
    await execFile('git', ['-C', repoPath, 'checkout', targetBranch]);
    const { stdout } = await execFile('git', [
      '-C',
      repoPath,
      'merge',
      branchName,
    ]);
    logger.info(`Merge complete: ${branchName} → ${targetBranch}`);
    return stdout;
  } finally {
    // Restore original branch if different
    const restoreBranch = currentBranch.trim();
    if (restoreBranch !== targetBranch) {
      try {
        await execFile('git', ['-C', repoPath, 'checkout', restoreBranch]);
      } catch {
        // Best effort — may fail if merge left conflicts
      }
    }
  }
}

/**
 * List all worktrees for a repository.
 */
export async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  const { stdout } = await execFile('git', [
    '-C',
    repoPath,
    'worktree',
    'list',
    '--porcelain',
  ]);
  const worktrees: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> = {};

  for (const line of stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current.path) worktrees.push(current as WorktreeInfo);
      current = {
        path: line.slice('worktree '.length),
        branch: '',
        head: '',
        bare: false,
      };
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length);
    } else if (line.startsWith('branch ')) {
      // branch refs/heads/branch-name → branch-name
      current.branch = line.slice('branch '.length).replace('refs/heads/', '');
    } else if (line === 'bare') {
      current.bare = true;
    }
  }
  if (current.path) worktrees.push(current as WorktreeInfo);

  return worktrees;
}

/**
 * Check whether a worktree has uncommitted changes.
 */
export async function hasChanges(worktreePath: string): Promise<boolean> {
  const { stdout } = await execFile('git', [
    '-C',
    worktreePath,
    'status',
    '--porcelain',
  ]);
  return stdout.trim().length > 0;
}
