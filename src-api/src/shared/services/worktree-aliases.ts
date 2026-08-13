/**
 * Worktree Shell Aliases
 *
 * Generates shell aliases for quick worktree navigation.
 * Development worktrees: za, zb, zc, zd, ze
 * Analysis worktrees: zxa, zxb, zxc
 */

import { existsSync } from 'fs';
import { readdir, stat, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';

import { APP_DISPLAY_NAME } from '@/config/branding';
import { APP_DIR_NAME } from '@/config/constants';

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('WorktreeAliases');

const LETTERS = ['a', 'b', 'c', 'd', 'e'];

/**
 * Generate shell aliases for active worktrees.
 */
export async function generateWorktreeAliases(
  sessionsDir: string,
): Promise<string> {
  const aliases: string[] = [
    `# ${APP_DISPLAY_NAME} Worktree Aliases (auto-generated)`,
    '# Development worktrees: za, zb, zc, zd, ze',
    '# Analysis worktrees: zxa, zxb, zxc',
    '',
  ];

  // Development worktrees
  if (existsSync(sessionsDir)) {
    const sessions = await readdir(sessionsDir);
    let i = 0;

    for (const session of sessions) {
      if (i >= 5) break;

      const sessionPath = join(sessionsDir, session);
      const stats = await stat(sessionPath);

      if (stats.isDirectory()) {
        aliases.push(`alias z${LETTERS[i]}="cd '${sessionPath}'"`);
        i++;
      }
    }
  }

  aliases.push('');

  // Analysis worktrees
  const baseRepoDir = join(homedir(), APP_DIR_NAME, 'repos');
  if (existsSync(baseRepoDir)) {
    const owners = await readdir(baseRepoDir);
    let i = 0;

    for (const owner of owners) {
      const ownerPath = join(baseRepoDir, owner);
      const ownerStats = await stat(ownerPath);
      if (!ownerStats.isDirectory()) continue;

      const repos = await readdir(ownerPath);

      for (const repo of repos) {
        if (i >= 3) break;

        const analysisPath = join(ownerPath, repo, 'analysis');
        if (existsSync(analysisPath)) {
          aliases.push(`alias zx${LETTERS[i]}="cd '${analysisPath}'"`);
          i++;
        }
      }
    }
  }

  return aliases.join('\n');
}

/**
 * Write aliases to app data directory worktree-aliases.sh.
 */
export async function updateShellAliases(sessionsDir: string): Promise<void> {
  const aliasContent = await generateWorktreeAliases(sessionsDir);

  const aliasFile = join(homedir(), APP_DIR_NAME, 'worktree-aliases.sh');
  await writeFile(aliasFile, aliasContent);

  logger.info(`Updated worktree aliases: ${aliasFile}`);
}
