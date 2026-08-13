/**
 * Pipeline Repo Config Discovery
 *
 * Pre-reads target repo configuration before agent execution.
 * This lightweight read informs prompt construction and role behavior
 * (the SDK will also discover CLAUDE.md at runtime via cwd).
 */

import { existsSync } from 'fs';
import fs from 'fs/promises';
import { join } from 'path';

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('PipelineRepoConfig');

// ============================================================================
// Types
// ============================================================================

export interface RepoConfig {
  /** Content of CLAUDE.md (top-level conventions) */
  claudeMd?: string;
  /** Whether the repo has a test suite */
  hasTests: boolean;
  /** Detected test command (e.g., "pnpm test") */
  testCommand?: string;
  /** Detected lint command */
  lintCommand?: string;
  /** Key conventions extracted from CLAUDE.md or config */
  conventions: string[];
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Discover repo configuration from a worktree path.
 * Reads CLAUDE.md, package.json scripts, and common config files.
 */
export async function discoverRepoConfig(
  worktreePath: string,
): Promise<RepoConfig> {
  const config: RepoConfig = {
    hasTests: false,
    conventions: [],
  };

  // Read CLAUDE.md
  try {
    config.claudeMd = await fs.readFile(
      join(worktreePath, 'CLAUDE.md'),
      'utf-8',
    );
    // Extract key conventions (lines starting with - under ## Conventions or ## Rules)
    const conventionLines = config.claudeMd
      .split('\n')
      .filter((l) => l.startsWith('- **') || l.startsWith('- `'))
      .slice(0, 20);
    config.conventions = conventionLines;
  } catch {
    // No CLAUDE.md
  }

  // Read package.json for scripts
  try {
    const pkgContent = await fs.readFile(
      join(worktreePath, 'package.json'),
      'utf-8',
    );
    const pkg = JSON.parse(pkgContent);
    const scripts = pkg.scripts ?? {};
    const pm = detectPackageManager(worktreePath);

    if (scripts.test) {
      config.hasTests = true;
      config.testCommand = pm + ' test';
    } else if (scripts['test:fast']) {
      config.hasTests = true;
      config.testCommand = pm + ' test:fast';
    }

    if (scripts.lint) {
      config.lintCommand = pm + ' lint';
    } else if (scripts.validate) {
      config.lintCommand = pm + ' validate';
    }
  } catch {
    // No package.json
  }

  logger.info('Repo config discovered', {
    hasCLAUDEmd: !!config.claudeMd,
    hasTests: config.hasTests,
    conventions: config.conventions.length,
  });

  return config;
}

function detectPackageManager(worktreePath: string): string {
  if (existsSync(join(worktreePath, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(worktreePath, 'yarn.lock'))) return 'yarn';
  return 'npm run';
}
