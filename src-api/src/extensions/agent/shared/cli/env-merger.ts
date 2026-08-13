/**
 * Environment Variable Merging Utilities
 */

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('CLI');

/** Default patterns for redacting sensitive env vars */
const DEFAULT_REDACT_PATTERNS = [
  /api[_-]?key/i,
  /secret/i,
  /token/i,
  /password/i,
  /credential/i,
  /auth/i,
];

/**
 * Merge base environment with overrides.
 */
export function mergeEnv(
  base: NodeJS.ProcessEnv,
  overrides: Record<string, string>,
  redactKeys?: string[],
): NodeJS.ProcessEnv {
  const merged = { ...base, ...overrides };

  if (redactKeys) {
    const redacted = redactForLog(overrides);
    logger.debug(`Merged env with overrides: ${JSON.stringify(redacted)}`);
  }

  return merged;
}

/**
 * Redact sensitive values from env vars for logging.
 */
export function redactForLog(
  env: Record<string, string>,
  patterns?: RegExp[],
): Record<string, string> {
  const effectivePatterns = patterns || DEFAULT_REDACT_PATTERNS;
  const redacted: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    const isSensitive = effectivePatterns.some((p) => p.test(key));
    redacted[key] = isSensitive ? '***REDACTED***' : value;
  }

  return redacted;
}
