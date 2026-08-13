/**
 * Standard Environment Test Harness
 */

import { execFileSync } from 'child_process';

import type { AdapterEnvironmentReport } from '@/core/agent/types';

import { createLogger } from '@/shared/utils/logger';

import { resolveBinaryPath } from './command-resolver';

const logger = createLogger('CLI');

export interface PreflightConfig {
  /** Binary name to check */
  binaryName: string;
  /** Environment variable for auth validation */
  authEnvVar?: string;
  /** Hello probe: binary name + args array (e.g., ['gemini', '--help']) */
  helloArgs?: string[];
  /** Optional hint paths for binary resolution */
  binaryHints?: string[];
}

/**
 * Run a standard preflight check for a CLI adapter.
 */
export async function runPreflight(
  config: PreflightConfig,
): Promise<AdapterEnvironmentReport> {
  const errors: string[] = [];

  // Step 1: Check binary
  const binaryPath = resolveBinaryPath(config.binaryName, config.binaryHints);
  const binaryFound = binaryPath !== null;
  if (!binaryFound) {
    errors.push(`Binary '${config.binaryName}' not found in PATH`);
  }

  // Step 2: Check auth
  let authValid = true;
  if (config.authEnvVar) {
    authValid = !!process.env[config.authEnvVar];
    if (!authValid) {
      errors.push(`Environment variable '${config.authEnvVar}' is not set`);
    }
  }

  // Step 3: Hello probe
  let helloProbeOk = false;
  if (binaryFound && config.helloArgs && config.helloArgs.length > 0) {
    try {
      const [helloBin, ...args] = config.helloArgs as [string, ...string[]];
      execFileSync(helloBin, args, {
        encoding: 'utf-8',
        stdio: 'pipe',
        timeout: 10000,
      });
      helloProbeOk = true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`Hello probe failed: ${msg.slice(0, 200)}`);
    }
  } else if (binaryFound && !config.helloArgs) {
    // No probe configured; assume OK if binary found
    helloProbeOk = true;
  }

  const healthy = binaryFound && authValid && helloProbeOk;

  logger.info(
    `Preflight for '${config.binaryName}': healthy=${healthy}, binary=${binaryFound}, auth=${authValid}, probe=${helloProbeOk}`,
  );

  return {
    healthy,
    binaryFound,
    authValid,
    helloProbeOk,
    errors,
  };
}
