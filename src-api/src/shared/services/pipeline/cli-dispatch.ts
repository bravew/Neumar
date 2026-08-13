/**
 * Pipeline CLI Dispatch
 *
 * Detects and spawns external CLI tools (claude, codex) for
 * true process isolation in the PGE evaluator pattern.
 *
 * Builds on ProcessAgent for security validation, env sanitization,
 * timeout enforcement, and abort signal wiring.
 */

import { exec, execFile } from 'child_process';
import { promisify } from 'util';

import { createLogger } from '@/shared/utils/logger';

import type { ProcessAgentConfig } from '../../../extensions/agent/process-agent/types';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const logger = createLogger('PipelineCLIDispatch');

// ============================================================================
// Types
// ============================================================================

export interface CliToolInfo {
  name: string;
  path: string;
}

export interface CliEvaluatorResult {
  text: string;
  exitCode: number;
}

// ============================================================================
// CLI Detection
// ============================================================================

let cachedCliTools: CliToolInfo[] | null = null;

/**
 * Detect available CLI tools on the system.
 * Result is cached for the process lifetime (CLI paths don't change).
 */
export async function detectCliTools(): Promise<CliToolInfo[]> {
  if (cachedCliTools) return cachedCliTools;

  const tools: CliToolInfo[] = [];
  for (const name of ['claude', 'codex']) {
    try {
      const { stdout } = await execAsync(`which ${name}`, { timeout: 5_000 });
      const path = stdout.trim();
      if (path) {
        tools.push({ name, path });
        logger.info(`Detected CLI tool: ${name} at ${path}`);
      }
    } catch {
      // Tool not found
    }
  }

  cachedCliTools = tools;
  return tools;
}

// ============================================================================
// ProcessAgent config builder
// ============================================================================

/**
 * Build a ProcessAgentConfig for spawning a CLI tool.
 */
export function createCliAgentConfig(
  tool: CliToolInfo,
  prompt: string,
  workDir: string,
  timeout = 120_000,
): ProcessAgentConfig {
  const args =
    tool.name === 'claude'
      ? ['-p', prompt, '--output-format', 'json']
      : ['-p', prompt]; // codex doesn't support --output-format

  return {
    command: tool.path,
    args,
    cwd: workDir,
    envAllowlist: ['ANTHROPIC_API_KEY', 'HOME', 'PATH', 'SHELL', 'USER'],
    parseMode: tool.name === 'claude' ? 'json' : 'line',
    timeout,
  };
}

// ============================================================================
// Evaluator dispatch
// ============================================================================

/**
 * Spawn a CLI evaluator for true fresh-context isolation.
 * Uses `claude -p` for a completely separate context window.
 *
 * Feature-gated: only use when enableCliDispatch is true.
 */
export async function spawnCliEvaluator(
  prompt: string,
  workDir: string,
  signal?: AbortSignal,
): Promise<CliEvaluatorResult> {
  const tools = await detectCliTools();
  const claude = tools.find((t) => t.name === 'claude');

  if (!claude) {
    throw new Error(
      'Claude CLI not found — install claude-code or disable CLI dispatch',
    );
  }

  logger.info('Spawning CLI evaluator', {
    tool: claude.name,
    workDir,
    promptLength: prompt.length,
  });

  const config = createCliAgentConfig(claude, prompt, workDir);

  try {
    // Use execFile (not exec) to avoid shell injection — args are passed as array
    const { stdout, stderr } = await execFileAsync(
      config.command,
      config.args,
      {
        cwd: config.cwd,
        timeout: config.timeout,
        env: Object.fromEntries(
          config.envAllowlist
            .filter((k) => process.env[k])
            .map((k) => [k, process.env[k]!]),
        ),
        signal,
      },
    );

    return { text: stdout + stderr, exitCode: 0 };
  } catch (err) {
    const error = err as { code?: number; stdout?: string; stderr?: string };
    return {
      text: (error.stdout ?? '') + (error.stderr ?? ''),
      exitCode: error.code ?? 1,
    };
  }
}
