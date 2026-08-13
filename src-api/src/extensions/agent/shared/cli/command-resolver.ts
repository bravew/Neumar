/**
 * CLI Binary Resolution Utilities
 *
 * Resolves binary paths via PATH scanning with optional hint directories.
 */

import { existsSync } from 'fs';

import { resolveOnPath } from '@/shared/agent-runtimes/resolve';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('CLI');

/**
 * Resolve a binary path by scanning PATH and optional hint directories.
 * Returns the first found path or null.
 */
export function resolveBinaryPath(
  name: string,
  hints?: string[],
): string | null {
  // Check hint paths first
  if (hints) {
    for (const hint of hints) {
      if (existsSync(hint)) {
        logger.debug(`Found binary at hint path: ${hint}`);
        return hint;
      }
    }
  }

  const resolved = resolveOnPath(name);
  if (resolved) {
    logger.debug(`Resolved binary '${name}' at: ${resolved.path}`);
    return resolved.path;
  }

  logger.debug(`Binary '${name}' not found`);
  return null;
}

/**
 * Assert that a binary exists, throwing a descriptive error if not found.
 */
export function assertBinaryExists(name: string, hints?: string[]): string {
  const path = resolveBinaryPath(name, hints);
  if (!path) {
    throw new Error(
      `Binary '${name}' not found. Please ensure it is installed and available in your PATH.` +
        (hints?.length ? ` Also checked: ${hints.join(', ')}` : ''),
    );
  }
  return path;
}
