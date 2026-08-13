/**
 * Process Agent Adapter
 *
 * Executes arbitrary CLI commands as agent actions.
 * Extends BaseAgent with security validation, env allowlist, and subprocess spawning.
 */

import { spawn } from 'node:child_process';

import { BaseAgent } from '@/core/agent/base';
import { defineAgentPlugin } from '@/core/agent/plugin';
import type { AgentProviderMetadata } from '@/core/agent/plugin';
import type {
  AgentConfig,
  AgentMessage,
  AgentOptions,
  AgentProvider,
} from '@/core/agent/types';

import { getSetting } from '@/shared/db/operations';
import { recordSecurityEvent } from '@/shared/security/audit';
import { createLogger } from '@/shared/utils/logger';

import { createSandboxSpawnPlan } from './sandbox';
import {
  sanitizeEnv,
  validateArg,
  validateCommand,
  validateCwd,
} from './security';
import type { ProcessAgentConfig } from './types';

const logger = createLogger('ProcessAgent');

const DEFAULT_TIMEOUT_MS = 120_000;

const PROCESS_AGENT_METADATA: AgentProviderMetadata = {
  type: 'process-agent',
  name: 'Process Agent',
  description: 'Execute arbitrary CLI commands as agent actions',
  builtin: true,
  supportsPlan: false,
  supportsStreaming: true,
  // Phase 7: process agent participates in the sandbox control plane via
  // createSandboxSpawnPlan(). Hard isolation is host-dependent (macOS today),
  // and the per-run spawn plan reports the actual enforcement level.
  supportsSandbox: true,
  transport: 'process',
  supportsMcp: 'none',
  supportsSkills: 'none',
  supportsPlanMode: 'none',
  requiresBinary: true,
  requiresApiKey: false,
};

export class ProcessAgent extends BaseAgent {
  readonly provider: AgentProvider = 'process-agent' as AgentProvider;
  private processConfig: ProcessAgentConfig;

  constructor(config: AgentConfig) {
    super(config);
    const providerConfig = (config.providerConfig ??
      {}) as Partial<ProcessAgentConfig>;
    this.processConfig = {
      command: providerConfig.command ?? '',
      args: providerConfig.args ?? [],
      cwd: providerConfig.cwd,
      envAllowlist: providerConfig.envAllowlist ?? [
        'PATH',
        'HOME',
        'USER',
        'LANG',
      ],
      parseMode: providerConfig.parseMode ?? 'streaming',
      timeout: providerConfig.timeout ?? DEFAULT_TIMEOUT_MS,
      sandboxProfile:
        providerConfig.sandboxProfile ?? config.sandboxProfile ?? undefined,
    };
  }

  async *run(
    prompt: string,
    options?: AgentOptions,
  ): AsyncGenerator<AgentMessage> {
    const session = this.createSession('executing');
    yield { type: 'session', sessionId: session.id };

    const command = this.processConfig.command;
    if (!command) {
      yield {
        type: 'error',
        message:
          'process-agent requires a configured command; the prompt cannot be used as an executable',
      };
      yield { type: 'done' };
      this.sessions.delete(session.id);
      return;
    }
    const args = this.processConfig.args;

    // Validate command
    const validation = validateCommand(command);
    if (!validation.valid) {
      yield { type: 'error', message: validation.reason ?? 'Invalid command' };
      yield { type: 'done' };
      this.sessions.delete(session.id);
      return;
    }

    // Validate each arg for shell metacharacters
    for (const arg of args) {
      const argValidation = validateArg(arg);
      if (!argValidation.valid) {
        yield {
          type: 'error',
          message: argValidation.reason ?? 'Invalid argument',
        };
        yield { type: 'done' };
        this.sessions.delete(session.id);
        return;
      }
    }

    // Validate and resolve cwd
    const workspaceRoot = getSetting('workDir') ?? process.cwd();
    let cwd: string;
    try {
      cwd = validateCwd(
        this.processConfig.cwd ?? options?.cwd ?? workspaceRoot,
        workspaceRoot,
      );
    } catch (err) {
      yield { type: 'error', message: String(err) };
      yield { type: 'done' };
      this.sessions.delete(session.id);
      return;
    }

    // Build sanitized env
    const env = sanitizeEnv(this.processConfig.envAllowlist);

    const timeout = this.processConfig.timeout ?? DEFAULT_TIMEOUT_MS;
    let cleanupSandbox: (() => void) | undefined;

    try {
      const spawnPlan = createSandboxSpawnPlan({
        command,
        args,
        cwd,
        workspaceRoot,
        sessionId: session.id,
        env,
        profile: this.processConfig.sandboxProfile,
      });
      cleanupSandbox = spawnPlan.cleanup;

      if (spawnPlan.reducedIsolation) {
        logger.warn('Process agent using reduced isolation', {
          sessionId: session.id,
          reason: spawnPlan.reason,
          enforcement: spawnPlan.enforcement,
        });
        recordSecurityEvent({
          sessionId: session.id,
          eventType: 'sandbox.reduced_isolation',
          severity: spawnPlan.enforcement === 'none' ? 'warn' : 'info',
          source: 'ProcessAgent',
          action:
            spawnPlan.enforcement === 'none'
              ? 'allow_unsandboxed'
              : 'allow_reduced',
          redactedSnippet: spawnPlan.reason,
          metadata: {
            mode: spawnPlan.mode,
            enforcement: spawnPlan.enforcement,
            platform: process.platform,
            command,
          },
        });
        yield {
          type: 'system',
          subtype: 'security',
          content: `Process sandbox reduced isolation: ${spawnPlan.reason}`,
          isProgress: true,
        };
      }

      const proc = spawn(spawnPlan.command, spawnPlan.args, spawnPlan.options);
      if (!proc.stdout || !proc.stderr) {
        throw new Error('Sandboxed process did not expose stdout/stderr pipes');
      }
      const stdoutStream = proc.stdout;
      const stderrStream = proc.stderr;

      const timeoutId = setTimeout(() => {
        proc.kill('SIGTERM');
      }, timeout);

      // Wire abort controller
      if (options?.abortController) {
        options.abortController.signal.addEventListener('abort', () => {
          proc.kill('SIGTERM');
        });
      }
      session.abortController.signal.addEventListener('abort', () => {
        proc.kill('SIGTERM');
      });

      let stdout = '';

      // Register exit-code promise BEFORE draining streams to avoid missing the
      // 'close' event if the process exits quickly (EventEmitter does not replay events).
      const exitCodePromise = new Promise<number | null>((resolve) => {
        proc.on('close', (code) => resolve(code));
        proc.on('error', (err) => {
          logger.error('Process error', { error: err.message });
          resolve(null);
        });
      });

      // Drain stderr concurrently with stdout to prevent OS pipe buffer deadlock.
      // If stderr fills (~64 KB) while we're blocked reading stdout, both sides stall.
      const stderrChunks: string[] = [];
      const stderrDone = (async () => {
        for await (const chunk of stderrStream) {
          stderrChunks.push(String(chunk));
        }
      })();

      if (this.processConfig.parseMode === 'streaming') {
        // Streaming: yield chunks as they arrive
        for await (const chunk of stdoutStream) {
          const text = String(chunk);
          stdout += text;
          yield { type: 'text', content: text };
        }
      } else if (this.processConfig.parseMode === 'line') {
        // Line: buffer and yield per line
        let buffer = '';
        for await (const chunk of stdoutStream) {
          const text = String(chunk);
          stdout += text;
          buffer += text;
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            yield { type: 'text', content: line };
          }
        }
        if (buffer.length > 0) {
          yield { type: 'text', content: buffer };
        }
      } else {
        // JSON: buffer all, then parse
        for await (const chunk of stdoutStream) {
          stdout += String(chunk);
        }
      }

      await stderrDone;
      const stderr = stderrChunks.join('');

      const exitCode = await exitCodePromise;

      clearTimeout(timeoutId);
      if (exitCode !== 0 && exitCode !== null) {
        yield {
          type: 'error',
          message: stderr || `Process exited with code ${exitCode}`,
        };
      } else if (this.processConfig.parseMode === 'json') {
        try {
          const parsed = JSON.parse(stdout);
          yield { type: 'result', content: JSON.stringify(parsed) };
        } catch {
          yield { type: 'result', content: stdout };
        }
      } else {
        yield { type: 'result', content: stdout };
      }

      yield { type: 'done' };
    } catch (err) {
      logger.error('Process agent error', { error: err });
      yield { type: 'error', message: String(err) };
      yield { type: 'done' };
    } finally {
      cleanupSandbox?.();
      this.sessions.delete(session.id);
    }
  }

  async *plan(): AsyncGenerator<AgentMessage> {
    yield {
      type: 'error',
      message: 'Planning not supported for process-agent',
    };
    yield { type: 'done' };
  }

  async *execute(): AsyncGenerator<AgentMessage> {
    yield {
      type: 'error',
      message: 'Execute not supported for process-agent — use run()',
    };
    yield { type: 'done' };
  }
}

export function createProcessAgent(config: AgentConfig): ProcessAgent {
  return new ProcessAgent(config);
}

export const processAgentPlugin = defineAgentPlugin({
  metadata: PROCESS_AGENT_METADATA,
  factory: (config) => createProcessAgent(config),
  async testEnvironment() {
    return {
      healthy: true,
      binaryFound: true,
      authValid: true,
      helloProbeOk: true,
      errors: [],
    };
  },
});
