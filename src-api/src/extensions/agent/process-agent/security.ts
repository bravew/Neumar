/**
 * Process Agent Security
 *
 * Validation for command execution: command blocklist, env allowlist, path sandboxing.
 */

import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('ProcessAgentSecurity');

/**
 * Commands that are never allowed.
 * Includes shell interpreters (which could run arbitrary code) and privilege-escalation tools.
 * Note: process-agent uses spawn() without shell:true, so the OS executes the binary directly.
 * Legitimate automation tools (e.g. python, node, curl) are intentionally NOT blocked here —
 * the env allowlist and CWD containment provide workspace isolation.
 */
const BLOCKED_COMMANDS = new Set([
  // Destructive system commands
  'shutdown',
  'reboot',
  'mkfs',
  'dd',
  'init',
  'systemctl',
  // Shell interpreters — would allow arbitrary code execution
  'bash',
  'sh',
  'zsh',
  'ksh',
  'fish',
  'dash',
  'csh',
  'tcsh',
  // Privilege escalation
  'sudo',
  'su',
  'doas',
  // Network pivoting / reverse shell tools
  'nc',
  'ncat',
  'netcat',
  'socat',
]);

/** Shell metacharacters that indicate injection attempts */
const SHELL_METACHAR_RE = /[;&|><`$(){}]/;

/**
 * Validate a command for safe execution.
 */
export function validateCommand(command: string): {
  valid: boolean;
  reason?: string;
} {
  if (!command || command.trim().length === 0) {
    return { valid: false, reason: 'Command is empty' };
  }

  const baseName = command.split('/').pop() ?? command;

  if (BLOCKED_COMMANDS.has(baseName)) {
    return {
      valid: false,
      reason: `Command "${baseName}" is blocked for safety`,
    };
  }

  if (SHELL_METACHAR_RE.test(command)) {
    return { valid: false, reason: 'Command contains shell metacharacters' };
  }

  return { valid: true };
}

/**
 * Validate a single argument for safe execution.
 * Rejects arguments containing shell metacharacters.
 */
export function validateArg(arg: string): { valid: boolean; reason?: string } {
  if (SHELL_METACHAR_RE.test(arg)) {
    return {
      valid: false,
      reason: `Argument contains shell metacharacters: ${arg}`,
    };
  }
  return { valid: true };
}

/**
 * Build a sanitized environment object from an allowlist.
 * Only env vars in the allowlist are passed through.
 */
export function sanitizeEnv(envAllowlist: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of envAllowlist) {
    const value = process.env[key];
    if (value !== undefined) {
      result[key] = value;
    }
  }
  logger.debug('Sanitized env', {
    allowedKeys: envAllowlist.length,
    resolvedKeys: Object.keys(result).length,
  });
  return result;
}

/**
 * Validate and resolve a working directory against the workspace root.
 * Rejects paths outside the workspace boundary.
 */
export function validateCwd(cwd: string, workspaceRoot: string): string {
  const resolved = resolve(cwd);
  const resolvedRoot = resolve(workspaceRoot);

  let realPath: string;
  try {
    realPath = realpathSync(resolved);
  } catch {
    // If the path doesn't exist yet, use the resolved path
    realPath = resolved;
  }

  let realRoot: string;
  try {
    realRoot = realpathSync(resolvedRoot);
  } catch {
    realRoot = resolvedRoot;
  }

  if (realPath !== realRoot && !realPath.startsWith(realRoot + '/')) {
    throw new Error(
      `Working directory "${cwd}" resolves outside workspace root "${workspaceRoot}"`,
    );
  }

  return realPath;
}
