import { spawn } from 'node:child_process';

import {
  BaseAgent,
  formatPlanForExecution,
  isConversationalPrompt,
  PLANNING_INSTRUCTION,
} from '@/core/agent/base';
import { defineAgentPlugin } from '@/core/agent/plugin';
import type { AgentPlugin, AgentProviderMetadata } from '@/core/agent/plugin';
import type {
  AdapterEnvironmentReport,
  AgentConfig,
  AgentMessage,
  AgentOptions,
  ExecuteOptions,
  ImageAttachment,
  PlanOptions,
} from '@/core/agent/types';

import { DEFAULT_WORK_DIR } from '@/config/constants';

import { validateCwd } from '@/extensions/agent/process-agent/security';
import {
  parseJsonlStream,
  resolveBinaryPath,
  runPreflight,
} from '@/extensions/agent/shared/cli';

import { getSetting } from '@/shared/db/operations';
import { createLogger } from '@/shared/utils/logger';

import {
  buildPiAbortCommand,
  buildPiExtensionUiResponse,
  buildPiPromptCommand,
  buildPiRpcArgs,
  isRecord,
  mapPiRpcEvent,
} from './rpc';

const logger = createLogger('PiLocal');

const PI_LOCAL_METADATA: AgentProviderMetadata = {
  type: 'pi-local',
  name: 'Pi (Local)',
  version: '1.0.0',
  description: 'Pi CLI agent running locally through pi RPC mode.',
  configSchema: {
    type: 'object',
    properties: {
      model: {
        type: 'string',
        default: 'default',
        description: 'Pi model id, for example anthropic/claude-sonnet-5.',
      },
      reasoning: {
        type: 'string',
        default: 'default',
        description:
          'Pi thinking level: off, minimal, low, medium, high, xhigh.',
      },
      workDir: {
        type: 'string',
        default: DEFAULT_WORK_DIR,
        description: 'Working directory for file operations.',
      },
    },
  },
  builtin: true,
  supportsPlan: true,
  supportsStreaming: true,
  supportsSandbox: false,
  transport: 'cli',
  supportsMcp: 'native',
  supportsSkills: 'none',
  supportsPlanMode: 'orchestrated',
  requiresBinary: true,
  requiresApiKey: false,
  supportsEnvironmentTest: true,
  supportsModelDiscovery: true,
  supportedModels: [
    'default',
    'anthropic/claude-sonnet-5',
    'anthropic/claude-opus-4-8',
    'anthropic/claude-sonnet-4-6',
    'anthropic/claude-opus-4-7',
    'openai/gpt-5.5',
    'google/gemini-2.5-pro',
  ],
  defaultModel: 'default',
  tags: ['pi', 'cli', 'local', 'rpc'],
};

type PiLocalProviderConfig = {
  binaryPath?: string;
  reasoning?: string;
  extraAllowedDirs?: string[];
};

function detectBinary(binaryPath?: string): string | null {
  return binaryPath || process.env['PI_PATH'] || resolveBinaryPath('pi');
}

function imagePayloads(
  images: ImageAttachment[] | undefined,
): Array<{ type: 'image'; data: string; mimeType: string }> {
  return (images ?? [])
    .filter(
      (image) =>
        typeof image.data === 'string' &&
        image.data.length > 0 &&
        typeof image.mimeType === 'string' &&
        image.mimeType.startsWith('image/'),
    )
    .slice(0, 10)
    .map((image) => ({
      type: 'image' as const,
      data: image.data,
      mimeType: image.mimeType,
    }));
}

export class PiLocalAgent extends BaseAgent {
  readonly provider = 'pi-local' as const;
  private currentProcess: ReturnType<typeof spawn> | null = null;

  async *run(
    prompt: string,
    options?: AgentOptions,
  ): AsyncGenerator<AgentMessage> {
    const session = this.createSession('executing');
    yield { type: 'session', sessionId: session.id };

    const providerConfig = (this.config.providerConfig ??
      {}) as PiLocalProviderConfig;
    const binaryPath = detectBinary(providerConfig.binaryPath);
    if (!binaryPath) {
      yield {
        type: 'error',
        message: 'Pi binary not found. Install pi or set PI_PATH.',
      };
      yield { type: 'done' };
      this.sessions.delete(session.id);
      return;
    }

    const workspaceRoot = getSetting('workDir') ?? process.cwd();
    let cwd: string;
    try {
      cwd = validateCwd(
        options?.cwd ?? this.config.workDir ?? workspaceRoot,
        workspaceRoot,
      );
    } catch (error) {
      yield { type: 'error', message: String(error) };
      yield { type: 'done' };
      this.sessions.delete(session.id);
      return;
    }

    const model = this.config.model?.trim() || 'default';
    const reasoning = providerConfig.reasoning?.trim() || 'default';
    const args = buildPiRpcArgs({
      model,
      reasoning,
      extraAllowedDirs: providerConfig.extraAllowedDirs,
    });
    const fullPrompt = this.buildPromptWithContext(prompt, options);

    try {
      const child = spawn(binaryPath, args, {
        cwd,
        env: {
          ...process.env,
          PATH: process.env['PATH'] ?? '',
          HOME: process.env['HOME'] ?? '',
          TERM: process.env['TERM'] ?? 'xterm-256color',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.currentProcess = child;

      if (!child.stdin || !child.stdout || !child.stderr) {
        throw new Error('Pi process did not expose stdio pipes');
      }

      let nextRpcId = 1;
      let fatalError: string | null = null;
      let terminal = false;
      let sentFirstToken = false;
      let producedOutput = false;
      let emittedFatalError = false;
      let aborted = false;

      const sendAbort = () => {
        if (terminal || child.killed) return;
        aborted = true;
        try {
          child.stdin?.write(buildPiAbortCommand(nextRpcId++));
        } catch {
          // Best-effort protocol abort; SIGTERM fallback below owns teardown.
        }
        setTimeout(() => {
          if (!child.killed && child.exitCode === null) child.kill('SIGTERM');
        }, 5000);
      };

      options?.abortController?.signal.addEventListener('abort', sendAbort, {
        once: true,
      });
      session.abortController.signal.addEventListener('abort', sendAbort, {
        once: true,
      });
      if (
        options?.abortController?.signal.aborted ||
        session.abortController.signal.aborted
      ) {
        sendAbort();
      }

      yield {
        type: 'system',
        content:
          model === 'default' ? 'pi initializing' : `pi initializing ${model}`,
        model: model === 'default' ? undefined : model,
        isProgress: true,
      };

      child.stdin.write(
        buildPiPromptCommand(
          nextRpcId++,
          fullPrompt,
          imagePayloads(options?.images),
          { parentSession: options?.resumeSessionId },
        ),
      );

      const exitCodePromise = new Promise<number | null>((resolve) => {
        child.on('close', (code) => resolve(code));
        child.on('error', (error) => {
          logger.error('Pi process error', { error: error.message });
          fatalError = error.message;
          resolve(null);
        });
      });

      const STDERR_MAX_BYTES = 64 * 1024;
      const stderrChunks: string[] = [];
      let stderrBytes = 0;
      let stderrTruncated = false;
      const stderrDone = (async () => {
        for await (const chunk of child.stderr!) {
          if (stderrBytes >= STDERR_MAX_BYTES) {
            stderrTruncated = true;
            continue;
          }
          const text = String(chunk);
          const remaining = STDERR_MAX_BYTES - stderrBytes;
          if (text.length > remaining) {
            stderrChunks.push(text.slice(0, remaining));
            stderrBytes = STDERR_MAX_BYTES;
            stderrTruncated = true;
          } else {
            stderrChunks.push(text);
            stderrBytes += text.length;
          }
        }
      })();

      for await (const raw of parseJsonlStream(child.stdout)) {
        if (!isRecord(raw)) continue;

        if (raw.type === 'extension_ui_request') {
          const response = buildPiExtensionUiResponse(raw);
          if (response) child.stdin.write(response);
          continue;
        }

        if (raw.type === 'response') {
          if (raw.success === false) {
            fatalError = `Pi prompt rejected: ${String(raw.error ?? 'unknown error')}`;
            child.kill('SIGTERM');
            break;
          }
          continue;
        }

        const mapped = mapPiRpcEvent(raw, {
          runStartedAt: session.createdAt.getTime(),
          sentFirstToken,
        });
        sentFirstToken = mapped.sentFirstToken;
        for (const message of mapped.messages) {
          if (
            message.type === 'text' ||
            message.type === 'thinking' ||
            message.type === 'tool_use' ||
            message.type === 'tool_result'
          ) {
            producedOutput = true;
          }
          if (message.type === 'error') {
            fatalError = message.message ?? message.content ?? 'Pi agent error';
            emittedFatalError = true;
          }
          yield message;
        }

        if (mapped.terminal) {
          terminal = true;
          child.stdin.end();
          setTimeout(
            () => {
              if (!child.killed && child.exitCode === null)
                child.kill('SIGTERM');
            },
            Number(process.env['PI_GRACEFUL_SHUTDOWN_MS']) || 5000,
          );
          break;
        }
      }

      await stderrDone;
      const exitCode = await exitCodePromise;
      const stderr =
        stderrChunks.join('') +
        (stderrTruncated ? '\n…(stderr truncated)' : '');

      if (fatalError) {
        if (!emittedFatalError) {
          yield { type: 'error', message: fatalError };
        }
      } else if (aborted || session.abortController.signal.aborted) {
        yield { type: 'done' };
        return;
      } else if (exitCode !== 0 && exitCode !== null) {
        yield {
          type: 'error',
          message: stderr || `Pi exited with code ${exitCode}`,
        };
      } else if (!producedOutput) {
        yield {
          type: 'error',
          message: 'Pi completed without producing output.',
        };
      }

      yield { type: 'done' };
    } catch (error) {
      logger.error('Pi local agent error', { error });
      yield { type: 'error', message: String(error) };
      yield { type: 'done' };
    } finally {
      this.currentProcess = null;
      this.sessions.delete(session.id);
    }
  }

  async *plan(
    prompt: string,
    options?: PlanOptions,
  ): AsyncGenerator<AgentMessage> {
    if (isConversationalPrompt(prompt)) {
      yield { type: 'direct_answer' };
      yield* this.run(prompt, options);
      return;
    }
    yield* this.run(`${PLANNING_INSTRUCTION}\n\n${prompt}`, options);
  }

  async *execute(options: ExecuteOptions): AsyncGenerator<AgentMessage> {
    const plan = options.plan || this.getPlan(options.planId);
    if (!plan) {
      yield { type: 'error', message: `Plan not found: ${options.planId}` };
      yield { type: 'done' };
      return;
    }
    yield* this.run(formatPlanForExecution(plan), options);
  }

  async stop(sessionId: string): Promise<void> {
    if (this.currentProcess && this.currentProcess.exitCode === null) {
      this.currentProcess.kill('SIGTERM');
    }
    await super.stop(sessionId);
  }
}

export function createPiLocalAgent(config: AgentConfig): PiLocalAgent {
  return new PiLocalAgent(config);
}

export const piLocalPlugin: AgentPlugin = defineAgentPlugin({
  metadata: PI_LOCAL_METADATA,
  factory: (config) => createPiLocalAgent(config),
  async testEnvironment(
    _config: AgentConfig,
  ): Promise<AdapterEnvironmentReport> {
    return runPreflight({
      binaryName: 'pi',
      helloArgs: ['pi', '--version'],
    });
  },
});
