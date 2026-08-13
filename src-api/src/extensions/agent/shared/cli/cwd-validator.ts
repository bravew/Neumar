/**
 * Working Directory Validation Utilities
 */

import { existsSync, statSync } from 'fs';
import { isAbsolute } from 'path';

import { getSetting } from '@/shared/db/operations';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('CLI');

/**
 * Validate that a directory path is absolute, exists, and is a directory.
 * Returns the validated path or throws a descriptive error.
 */
export function validateCwd(dir: string): string {
  if (!isAbsolute(dir)) {
    throw new Error(`Working directory must be an absolute path, got: ${dir}`);
  }
  if (!existsSync(dir)) {
    throw new Error(`Working directory does not exist: ${dir}`);
  }
  const stat = statSync(dir);
  if (!stat.isDirectory()) {
    throw new Error(`Working directory path is not a directory: ${dir}`);
  }
  return dir;
}

/**
 * Normalize and validate working directory, falling back to workDir setting.
 */
export function normalizeCwd(dir?: string): string {
  const resolved =
    dir || (getSetting('workDir') as string | null) || process.cwd();
  logger.debug(`Normalized CWD: ${resolved}`);
  return validateCwd(resolved);
}
