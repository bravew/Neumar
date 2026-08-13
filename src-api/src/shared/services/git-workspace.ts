/**
 * Git Workspace Manager
 *
 * Manages git worktrees for task isolation and base repository cache.
 * Supports concurrent task execution without git conflicts.
 */

import { exec } from 'child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs';
import { copyFile, readdir, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { basename, dirname, join } from 'path';
import { promisify } from 'util';

import { APP_DIR_NAME } from '@/config/constants';

import { createLogger } from '@/shared/utils/logger';

const execAsync = promisify(exec);
const logger = createLogger('GitWorkspace');

// ============================================================================
// Constants
// ============================================================================

/** Base directory for cached repos */
const REPOS_DIR = join(homedir(), APP_DIR_NAME, 'repos');

/** Base directory for task session worktrees */
const SESSIONS_DIR = join(homedir(), APP_DIR_NAME, 'sessions');

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate branch name to prevent command injection.
 * Allows: alphanumeric, dots, hyphens, slashes, underscores.
 * Rejects: `..` sequences, spaces, shell metacharacters.
 */
function isValidBranchName(branch: string): boolean {
  return /^[\w./-]+$/.test(branch) && !branch.includes('..');
}

/**
 * Validate repo owner/name to prevent path traversal.
 * Allows: alphanumeric, dots, hyphens, underscores.
 * Rejects: `..` sequences, slashes, spaces.
 */
function isValidRepoIdentifier(identifier: string): boolean {
  return /^[\w.-]+$/.test(identifier) && !identifier.includes('..');
}

// ============================================================================
// Base Repository Management
// ============================================================================

/**
 * Ensure base repo exists in cache and is up-to-date.
 * Location: ~/{APP_DIR_NAME}/repos/{owner}/{repo}
 *
 * - If repo doesn't exist: full clone with optional auth
 * - If exists: git fetch --all --prune
 * - Validates .git directory integrity after operations
 */
export async function ensureBaseRepo(
  owner: string,
  repo: string,
  githubToken?: string,
): Promise<string> {
  if (!isValidRepoIdentifier(owner) || !isValidRepoIdentifier(repo)) {
    throw new Error(`Invalid repo identifier: ${owner}/${repo}`);
  }

  const baseRepoDir = join(REPOS_DIR, owner, repo);
  const gitDir = join(baseRepoDir, '.git');

  if (existsSync(gitDir)) {
    try {
      logger.info(`Fetching latest for base repo: ${owner}/${repo}`);
      await execAsync('git fetch --all --prune --tags', {
        cwd: baseRepoDir,
        timeout: 120_000,
      });
      return baseRepoDir;
    } catch (error) {
      logger.warn(`Fetch failed for ${owner}/${repo}, will re-clone: ${error}`);
      rmSync(baseRepoDir, { recursive: true, force: true });
    }
  }

  // Clone repo
  logger.info(`Cloning base repo: ${owner}/${repo}`);
  const parentDir = dirname(baseRepoDir);
  mkdirSync(parentDir, { recursive: true });

  const cloneUrl = githubToken
    ? `https://x-access-token:${githubToken}@github.com/${owner}/${repo}.git`
    : `https://github.com/${owner}/${repo}.git`;

  try {
    // Use -- to separate URL from positional args for safety
    await execAsync(`git clone -- "${cloneUrl}" "${repo}"`, {
      cwd: parentDir,
      timeout: 300_000,
    });
  } catch (error) {
    // Log sanitized message only — error object may contain token in cmd/stderr
    const message = error instanceof Error ? error.message : 'unknown error';
    logger.error(`Failed to clone ${owner}/${repo}: ${message}`);
    throw new Error(`Failed to clone repository: ${owner}/${repo}`);
  }

  if (!existsSync(gitDir)) {
    throw new Error(`Clone validation failed: .git directory not found`);
  }

  logger.info(`Base repo ready: ${owner}/${repo}`);
  return baseRepoDir;
}

// ============================================================================
// Worktree Management
// ============================================================================

/**
 * Create git worktree for a task with dedicated branch.
 * Location: ~/{APP_DIR_NAME}/sessions/{issueId}/{repoName}
 *
 * Uses `git worktree add` to create an isolated working directory.
 * Does NOT checkout/pull on the base repo (avoids race conditions
 * when multiple tasks target the same repo concurrently).
 * Instead, creates the worktree from `origin/{baseBranch}`.
 */
export async function createTaskWorktree(
  baseRepoPath: string,
  branchName: string,
  baseBranch: string,
  issueIdentifier: string,
): Promise<string> {
  if (!isValidBranchName(baseBranch)) {
    throw new Error(`Invalid base branch name: ${baseBranch}`);
  }
  if (!isValidBranchName(branchName)) {
    throw new Error(`Invalid branch name: ${branchName}`);
  }

  const repoName = basename(baseRepoPath);
  const sessionPath = join(SESSIONS_DIR, issueIdentifier.toLowerCase());
  const worktreePath = join(sessionPath, repoName);

  logger.info(`Creating worktree: ${issueIdentifier} (branch: ${branchName})`);

  // Clean up existing worktree if present (from failed previous run)
  if (existsSync(worktreePath)) {
    logger.warn(`Worktree already exists, cleaning up: ${worktreePath}`);
    try {
      await execAsync(`git worktree remove "${worktreePath}" --force`, {
        cwd: baseRepoPath,
      });
    } catch {
      // Force remove directory if git worktree remove fails
    }
    rmSync(worktreePath, { recursive: true, force: true });
    await execAsync('git worktree prune', { cwd: baseRepoPath }).catch(
      () => {},
    );
  }

  mkdirSync(sessionPath, { recursive: true });

  try {
    // Fetch latest from remote (safe for concurrent access — fetch is lock-free)
    await execAsync(`git fetch origin ${baseBranch}`, {
      cwd: baseRepoPath,
      timeout: 60_000,
    });

    // Create worktree from origin/{baseBranch} without touching the base repo's HEAD
    // This avoids race conditions when multiple tasks target the same repo
    await execAsync(
      `git worktree add "${worktreePath}" -b "${branchName}" "origin/${baseBranch}"`,
      { cwd: baseRepoPath, timeout: 30_000 },
    );

    logger.info(`Worktree created: ${worktreePath}`);
    return worktreePath;
  } catch (error) {
    logger.error(`Failed to create worktree: ${error}`);
    rmSync(worktreePath, { recursive: true, force: true });
    throw new Error(
      `Failed to create worktree for ${issueIdentifier}: ${error}`,
    );
  }
}

// ============================================================================
// Worktree Runtime Isolation
// ============================================================================

export interface WorktreeRuntimeConfig {
  /** Port offset to avoid collisions between concurrent worktrees */
  portOffset: number;
  /** Additional environment variable overrides */
  envOverrides: Record<string, string>;
}

/** Atomic counter for port allocation (wraps at 100) */
let worktreeIndex = 0;
const PORT_OFFSET_BASE = 100;

/**
 * Create an isolated worktree with runtime env configuration.
 * Wraps createTaskWorktree + writes .env.local with PORT_OFFSET.
 */
export async function createTaskWorktreeIsolated(
  baseRepoPath: string,
  branchName: string,
  baseBranch: string,
  issueIdentifier: string,
): Promise<{ worktreePath: string; runtimeConfig: WorktreeRuntimeConfig }> {
  const worktreePath = await createTaskWorktree(
    baseRepoPath,
    branchName,
    baseBranch,
    issueIdentifier,
  );

  const index = worktreeIndex++ % 100;
  const portOffset = PORT_OFFSET_BASE + index;

  const envOverrides: Record<string, string> = {
    PORT_OFFSET: String(portOffset),
    WORKTREE_ISOLATION: '1',
    WORKTREE_INDEX: String(index),
  };

  // Write .env.local for dev servers in the worktree
  const envLines = Object.entries(envOverrides)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  await writeFile(join(worktreePath, '.env.local'), envLines + '\n');

  logger.info(`Worktree isolated: ${worktreePath} (portOffset: ${portOffset})`);

  return {
    worktreePath,
    runtimeConfig: { portOffset, envOverrides },
  };
}

/**
 * Install dependencies in worktree.
 * Detects package manager from lockfile: pnpm > npm > yarn.
 */
export async function installDependencies(worktreePath: string): Promise<void> {
  if (!existsSync(join(worktreePath, 'package.json'))) {
    logger.info('No package.json found, skipping dependency installation');
    return;
  }

  let installCommand: string;

  if (existsSync(join(worktreePath, 'pnpm-lock.yaml'))) {
    installCommand = 'pnpm install --frozen-lockfile';
  } else if (existsSync(join(worktreePath, 'package-lock.json'))) {
    installCommand = 'npm ci';
  } else if (existsSync(join(worktreePath, 'yarn.lock'))) {
    installCommand = 'yarn install --frozen-lockfile';
  } else {
    logger.warn('No lockfile found, using npm install');
    installCommand = 'npm install';
  }

  logger.info(`Installing dependencies: ${installCommand}`);

  try {
    await execAsync(installCommand, {
      cwd: worktreePath,
      timeout: 300_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    logger.info('Dependencies installed');
  } catch (error) {
    logger.error(`Dependency installation failed: ${error}`);
    throw new Error('Failed to install dependencies');
  }
}

/**
 * Remove worktree and clean up session directory.
 * Safe to call multiple times (idempotent).
 */
export async function cleanupWorktree(
  baseRepoPath: string,
  worktreePath: string,
): Promise<void> {
  logger.info(`Cleaning up worktree: ${worktreePath}`);

  try {
    await execAsync(`git worktree remove "${worktreePath}" --force`, {
      cwd: baseRepoPath,
    });
  } catch {
    // Continue with manual cleanup
  }

  await execAsync('git worktree prune', { cwd: baseRepoPath }).catch(() => {});

  if (existsSync(worktreePath)) {
    rmSync(worktreePath, { recursive: true, force: true });
  }

  // Remove parent session directory if empty
  const sessionDir = dirname(worktreePath);
  try {
    const files = await readdir(sessionDir);
    if (files.length === 0) {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  } catch {
    // Session directory may not exist
  }
}

/**
 * List all worktrees for a base repo.
 * Returns array of worktree paths.
 */
export async function listActiveWorktrees(
  baseRepoPath: string,
): Promise<string[]> {
  try {
    const { stdout } = await execAsync('git worktree list --porcelain', {
      cwd: baseRepoPath,
      timeout: 10_000,
    });

    return stdout
      .split('\n')
      .filter((line) => line.startsWith('worktree '))
      .map((line) => line.replace('worktree ', ''));
  } catch {
    return [];
  }
}

// ============================================================================
// Pre-fetch
// ============================================================================

/**
 * Fetch latest changes for all base repos in the cache.
 * Called on pipeline startup and before processing ticket batches.
 * Errors are logged but never block pipeline execution.
 */
export async function refreshBaseRepos(): Promise<void> {
  if (!existsSync(REPOS_DIR)) {
    logger.info('No base repos to refresh');
    return;
  }

  const owners = readdirSync(REPOS_DIR);

  for (const owner of owners) {
    const ownerPath = join(REPOS_DIR, owner);
    if (!statSync(ownerPath).isDirectory()) continue;

    const repos = readdirSync(ownerPath);

    for (const repo of repos) {
      const repoPath = join(ownerPath, repo);
      if (!existsSync(join(repoPath, '.git'))) continue;

      try {
        logger.info(`Refreshing base repo: ${owner}/${repo}`);
        await execAsync('git fetch --all --prune --tags', {
          cwd: repoPath,
          timeout: 120_000,
        });
      } catch (error) {
        logger.warn(`Failed to refresh ${owner}/${repo}: ${error}`);
      }
    }
  }
}

// ============================================================================
// Claude Code Integration
// ============================================================================

/**
 * Initialize worktree for Claude Code agent.
 * Copies CLAUDE.md if present and creates a context file
 * to orient the agent to the task.
 */
export async function initializeWorktreeForClaude(
  baseRepoPath: string,
  worktreePath: string,
  issueId: string,
): Promise<void> {
  // Copy CLAUDE.md to worktree if not already present
  const rootClaudeMd = join(baseRepoPath, 'CLAUDE.md');
  const worktreeClaudeMd = join(worktreePath, 'CLAUDE.md');

  if (existsSync(rootClaudeMd) && !existsSync(worktreeClaudeMd)) {
    await copyFile(rootClaudeMd, worktreeClaudeMd);
  }

  // Create worktree-specific context directory
  const contextDir = join(worktreePath, APP_DIR_NAME);
  if (!existsSync(contextDir)) {
    mkdirSync(contextDir, { recursive: true });
  }

  // Create context file
  const contextFile = join(contextDir, 'context.md');
  const contextContent = `# Worktree Context

This worktree is dedicated to: **${issueId}**

## Worktree Info
- Created: ${new Date().toISOString()}
- Purpose: Isolated workspace for Linear ticket ${issueId}
- Base repo: ${baseRepoPath}

## Guidelines
- All changes should be committed to the task branch
- This worktree will be cleaned up after task completion
- Do not modify files outside this worktree
`;

  await writeFile(contextFile, contextContent);

  logger.info(`Initialized worktree for Claude Code: ${issueId}`);
}

/**
 * Ensure analysis worktree exists for repo exploration.
 * Analysis worktrees are persistent and read-only.
 */
export async function ensureAnalysisWorktree(
  baseRepoPath: string,
  baseBranch: string,
): Promise<string> {
  if (!isValidBranchName(baseBranch)) {
    throw new Error(`Invalid base branch name: ${baseBranch}`);
  }

  const analysisPath = join(baseRepoPath, 'analysis');

  if (existsSync(analysisPath)) {
    try {
      await execAsync(`git pull origin "${baseBranch}"`, {
        cwd: analysisPath,
        timeout: 60_000,
      });
      logger.info(`Updated analysis worktree: ${analysisPath}`);
    } catch (error) {
      logger.warn(`Failed to update analysis worktree: ${error}`);
    }
    return analysisPath;
  }

  // Create new analysis worktree
  await execAsync(`git worktree add analysis "origin/${baseBranch}"`, {
    cwd: baseRepoPath,
    timeout: 30_000,
  });

  logger.info(`Created analysis worktree: ${analysisPath}`);
  return analysisPath;
}
