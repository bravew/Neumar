/**
 * OpenCode Local Agent Adapter
 *
 * Runs the OpenCode CLI agent locally. Extends BaseAgent with binary detection,
 * auth sync from Neumar settings, and Tauri-compatible config generation.
 */

import { spawn } from 'node:child_process';

import {
  ASK_USER_QUESTION_INSTRUCTION,
  AskUserQuestionStreamFilter,
} from '@/core/agent/ask-user-question';
import { BaseAgent } from '@/core/agent/base';
import { defineAgentPlugin } from '@/core/agent/plugin';
import type { AgentProviderMetadata } from '@/core/agent/plugin';
import type {
  AgentConfig,
  AgentMessage,
  AgentOptions,
  AgentProvider,
} from '@/core/agent/types';

import { validateCwd } from '@/extensions/agent/process-agent/security';
import { resolveBinaryPath } from '@/extensions/agent/shared/cli/command-resolver';

import { getSetting } from '@/shared/db/operations';
import { createLogger } from '@/shared/utils/logger';

import {
  extractOpenCodeErrorText,
  parseOpenCodeOutputLine,
  shouldFailEmptyOpenCodeRun,
} from './output';
import type { OpenCodeLocalConfig } from './types';

const logger = createLogger('OpenCodeLocal');

const OPENCODE_HINTS = ['/usr/local/bin/opencode', '/usr/bin/opencode'];
const OPENCODE_NON_INTERACTIVE_ARGS = ['--non-interactive'] as const;

const OPENCODE_LOCAL_METADATA: AgentProviderMetadata = {
  type: 'opencode-local',
  name: 'OpenCode (Local)',
  description: 'OpenCode CLI agent running locally',
  builtin: true,
  supportsPlan: false,
  supportsStreaming: true,
  supportsSandbox: false,
  transport: 'cli',
  supportsMcp: 'none',
  supportsSkills: 'none',
  supportsPlanMode: 'orchestrated',
  requiresBinary: true,
  requiresApiKey: false,
};

/**
 * Detect the opencode binary path.
 * Priority: env var → system which → common paths
 */
function detectBinary(configPath?: string): string | null {
  if (configPath) return configPath;

  const envPath = process.env['OPENCODE_PATH'];
  if (envPath) return envPath;

  return resolveBinaryPath('opencode', OPENCODE_HINTS);
}

export function buildOpenCodeStdinInvocation(prompt: string) {
  return {
    args: [...OPENCODE_NON_INTERACTIVE_ARGS],
    stdin: `${ASK_USER_QUESTION_INSTRUCTION}\n\n${prompt}`,
  };
}

export class OpenCodeLocalAgent extends BaseAgent {
  readonly provider: AgentProvider = 'opencode-local' as AgentProvider;
  private localConfig: OpenCodeLocalConfig;

  constructor(config: AgentConfig) {
    super(config);
    const providerConfig = (config.providerConfig ??
      {}) as Partial<OpenCodeLocalConfig>;
    this.localConfig = {
      binaryPath: providerConfig.binaryPath,
      configDir: providerConfig.configDir,
      syncAuth: providerConfig.syncAuth ?? true,
      tauriCompatMode: providerConfig.tauriCompatMode ?? true,
    };
  }

  async *run(
    prompt: string,
    options?: AgentOptions,
  ): AsyncGenerator<AgentMessage> {
    const session = this.createSession('executing');
    yield { type: 'session', sessionId: session.id };

    const binaryPath = detectBinary(this.localConfig.binaryPath);
    if (!binaryPath) {
      yield {
        type: 'error',
        message:
          'OpenCode binary not found. Install opencode or set OPENCODE_PATH.',
      };
      yield { type: 'done' };
      this.sessions.delete(session.id);
      return;
    }

    const workspaceRoot = getSetting('workDir') ?? process.cwd();
    let cwd: string;
    try {
      cwd = validateCwd(options?.cwd ?? workspaceRoot, workspaceRoot);
    } catch (err) {
      yield { type: 'error', message: String(err) };
      yield { type: 'done' };
      this.sessions.delete(session.id);
      return;
    }

    // Build env — sync auth keys if enabled (never log sensitive values)
    const env: Record<string, string> = {
      PATH: process.env['PATH'] ?? '',
      HOME: process.env['HOME'] ?? '',
    };

    if (this.localConfig.syncAuth) {
      const apiKey = getSetting('anthropic_api_key');
      if (apiKey) {
        env['ANTHROPIC_API_KEY'] = apiKey;
      }
    }

    try {
      // Prepend the shared AskUserQuestion protocol — OpenCode CLI has no
      // native AskUserQuestion tool, so we route clarifying-question turns
      // through the same fenced JSON block + synthetic tool_use bridge that
      // the Codex and HTTP adapters use. See `@/core/agent/ask-user-question`.
      const invocation = buildOpenCodeStdinInvocation(prompt);

      const proc = spawn(binaryPath, invocation.args, {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      proc.stdin.on('error', (err) => {
        logger.warn('OpenCode stdin write failed', { error: err.message });
      });
      proc.stdin.end(invocation.stdin);

      const timeoutMs = 300_000; // 5 minutes
      const timeoutId = setTimeout(() => proc.kill('SIGTERM'), timeoutMs);

      // Wire abort
      if (options?.abortController) {
        options.abortController.signal.addEventListener('abort', () =>
          proc.kill('SIGTERM'),
        );
      }
      session.abortController.signal.addEventListener('abort', () =>
        proc.kill('SIGTERM'),
      );

      // Register exit-code promise BEFORE draining streams to avoid missing the
      // 'close' event if the process exits quickly (EventEmitter does not replay events).
      const exitCodePromise = new Promise<number | null>((resolve) => {
        proc.on('close', (code) => resolve(code));
        proc.on('error', (err) => {
          logger.error('OpenCode process error', { error: err.message });
          resolve(null);
        });
      });

      // Drain stderr concurrently with stdout to prevent OS pipe buffer deadlock.
      // If stderr fills (~64 KB) while we're blocked reading stdout, both sides stall.
      const stderrChunks: string[] = [];
      const stderrDone = (async () => {
        for await (const chunk of proc.stderr) {
          stderrChunks.push(String(chunk));
        }
      })();

      let stdoutBuffer = '';
      let emittedText = false;
      let emittedError = false;
      const askFilter = new AskUserQuestionStreamFilter();

      function* routeMessage(
        msg: ReturnType<typeof parseOpenCodeOutputLine>,
      ): Generator<NonNullable<ReturnType<typeof parseOpenCodeOutputLine>>> {
        if (!msg) return;
        if (msg.type === 'text' && typeof msg.content === 'string') {
          // Stream text through the AskUserQuestion filter so a fenced
          // `neuma:ask_user_question` block is rewritten into a synthetic
          // tool_use event instead of leaking through as raw markdown.
          for (const evt of askFilter.pushChunk(msg.content + '\n')) {
            yield evt;
          }
        } else {
          for (const evt of askFilter.flush()) yield evt;
          yield msg;
        }
      }

      for await (const chunk of proc.stdout) {
        stdoutBuffer += String(chunk);
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() ?? '';
        for (const line of lines) {
          const message = parseOpenCodeOutputLine(line);
          if (!message) continue;
          if (message.type === 'error') emittedError = true;
          if (message.type === 'text' && message.content?.trim()) {
            emittedText = true;
          }
          for (const evt of routeMessage(message)) yield evt;
        }
      }

      if (stdoutBuffer.trim()) {
        const message = parseOpenCodeOutputLine(stdoutBuffer);
        if (message) {
          if (message.type === 'error') emittedError = true;
          if (message.type === 'text' && message.content?.trim()) {
            emittedText = true;
          }
          for (const evt of routeMessage(message)) yield evt;
        }
      }

      // Drain anything still buffered in the AskUserQuestion filter so
      // trailing prose (or an unterminated fence) is surfaced rather than
      // silently dropped.
      for (const evt of askFilter.flush()) yield evt;

      await stderrDone;
      const stderr = stderrChunks.join('');

      const exitCode = await exitCodePromise;

      clearTimeout(timeoutId);

      if (exitCode !== 0 && exitCode !== null) {
        const framedError = extractOpenCodeErrorText(stderr);
        yield {
          type: 'error',
          message:
            framedError || stderr || `OpenCode exited with code ${exitCode}`,
        };
      } else if (
        shouldFailEmptyOpenCodeRun(exitCode, emittedText, emittedError)
      ) {
        yield {
          type: 'error',
          message: 'OpenCode completed without producing output.',
        };
      }

      yield { type: 'done' };
    } catch (err) {
      logger.error('OpenCode agent error', { error: err });
      yield { type: 'error', message: String(err) };
      yield { type: 'done' };
    } finally {
      this.sessions.delete(session.id);
    }
  }

  async *plan(): AsyncGenerator<AgentMessage> {
    yield {
      type: 'error',
      message: 'Planning not supported for opencode-local',
    };
    yield { type: 'done' };
  }

  async *execute(): AsyncGenerator<AgentMessage> {
    yield {
      type: 'error',
      message: 'Execute not supported for opencode-local — use run()',
    };
    yield { type: 'done' };
  }
}

export function createOpenCodeLocalAgent(
  config: AgentConfig,
): OpenCodeLocalAgent {
  return new OpenCodeLocalAgent(config);
}

export const openCodeLocalPlugin = defineAgentPlugin({
  metadata: OPENCODE_LOCAL_METADATA,
  factory: (config) => createOpenCodeLocalAgent(config),
  async testEnvironment() {
    const binaryPath = detectBinary();
    return {
      healthy: !!binaryPath,
      binaryFound: !!binaryPath,
      authValid: true,
      helloProbeOk: false,
      errors: binaryPath ? [] : ['OpenCode binary not found'],
    };
  },
});
