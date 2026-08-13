/**
 * Gemini Local CLI Adapter
 *
 * Integrates the Gemini CLI (local binary) as an agent provider.
 * Uses JSONL streaming output, supports session resume via --resume flag.
 * MCP tools available through the MCP shim layer.
 */

import { spawn } from 'child_process';
import crypto from 'crypto';

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
  PlanOptions,
} from '@/core/agent/types';

import { DEFAULT_WORK_DIR } from '@/config/constants';

import {
  createCancellableProcess,
  normalizeCwd,
  normalizeToAgentMessage,
  parseJsonlStream,
  resolveBinaryPath,
  runPreflight,
} from '@/extensions/agent/shared/cli';

import {
  AGENT_PROMPT_TOO_LARGE,
  validatePromptDeliveryBudget,
} from '@/shared/agent-runtimes';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('GeminiLocal');

const GEMINI_ARGV_PROMPT_DEF = {
  id: 'gemini-local',
  name: 'Gemini CLI',
  promptDelivery: 'argv' as const,
  windowsMaxPromptArgBytes: 30_000,
};

/** Hardcoded model aliases — no model discovery needed */
const GEMINI_MODEL_ALIASES: Record<string, string> = {
  auto: 'auto',
  pro: 'gemini-2.5-pro',
  flash: 'gemini-2.5-flash',
  'flash-lite': 'gemini-3.1-flash-lite',
};

const GEMINI_LOCAL_METADATA: AgentProviderMetadata = {
  type: 'gemini-local',
  name: 'Gemini CLI',
  version: '1.0.0',
  description:
    'Gemini CLI integration with JSONL streaming and session resume. Uses Google Gemini models via the local gemini binary.',
  configSchema: {
    type: 'object',
    properties: {
      model: {
        type: 'string',
        default: 'auto',
        description: 'Model alias: auto, pro, flash, flash-lite',
      },
      workDir: {
        type: 'string',
        default: DEFAULT_WORK_DIR,
        description: 'Working directory for file operations',
      },
    },
  },
  builtin: true,
  supportsPlan: true,
  supportsStreaming: true,
  supportsSandbox: false,
  supportedModels: Object.keys(GEMINI_MODEL_ALIASES),
  defaultModel: 'auto',
  tags: ['google', 'gemini', 'cli', 'local'],
  transport: 'cli',
  supportsMcp: 'shim',
  supportsSkills: 'none',
  supportsPlanMode: 'orchestrated',
  requiresBinary: true,
  supportsResume: true,
  supportsEnvironmentTest: true,
  supportsModelDiscovery: false,
};

/**
 * Resolve model alias to actual model ID.
 */
function resolveModel(model?: string): string {
  if (!model) return 'auto';
  return GEMINI_MODEL_ALIASES[model] || model;
}

/**
 * Gemini CLI Agent implementation.
 */
export class GeminiLocalAgent extends BaseAgent {
  readonly provider = 'gemini-local' as const;
  private currentProcess: ReturnType<typeof spawn> | null = null;

  constructor(config: AgentConfig) {
    super(config);
  }

  async *run(
    prompt: string,
    options?: AgentOptions,
  ): AsyncGenerator<AgentMessage> {
    const sessionId = options?.sessionId || crypto.randomUUID();
    yield { type: 'session', sessionId };

    yield* this.executeGemini(prompt, options);
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
    const planPrompt = `${PLANNING_INSTRUCTION}\n\n${prompt}`;
    yield* this.run(planPrompt, options);
  }

  async *execute(options: ExecuteOptions): AsyncGenerator<AgentMessage> {
    const plan = options.plan || this.getPlan(options.planId);
    if (!plan) {
      yield {
        type: 'error',
        content: `Plan not found: ${options.planId}`,
      };
      return;
    }

    const execPrompt = formatPlanForExecution(plan);
    yield* this.run(execPrompt, options);
  }

  async stop(sessionId: string): Promise<void> {
    if (this.currentProcess && this.currentProcess.exitCode === null) {
      this.currentProcess.kill('SIGTERM');
    }
    await super.stop(sessionId);
  }

  private async *executeGemini(
    prompt: string,
    options?: AgentOptions,
  ): AsyncGenerator<AgentMessage> {
    const model = resolveModel(this.config.model);
    const cwd = normalizeCwd(options?.cwd || this.config.workDir);

    const args = [prompt, '--output-format', 'stream-json'];

    if (model !== 'auto') {
      args.push('-m', model);
    }

    // Session resume support
    if (options?.sessionId) {
      args.push('--resume', options.sessionId);
    }

    const binaryPath = resolveBinaryPath('gemini');
    if (!binaryPath) {
      yield {
        type: 'error',
        content:
          'Gemini CLI not found. Please install it from https://ai.google.dev/gemini-api/docs/cli',
      };
      return;
    }

    const promptBudget = validatePromptDeliveryBudget(
      GEMINI_ARGV_PROMPT_DEF,
      binaryPath,
      args,
      prompt,
    );
    if (!promptBudget.ok) {
      yield {
        type: 'error',
        code: AGENT_PROMPT_TOO_LARGE,
        message: promptBudget.message,
        content: promptBudget.message,
      };
      return;
    }

    logger.info(`Spawning gemini: model=${model}, cwd=${cwd}`);

    const proc = spawn(binaryPath, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        HOME: process.env.HOME,
        PATH: process.env.PATH,
        GEMINI_API_KEY: process.env.GEMINI_API_KEY,
        GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
        GOOGLE_APPLICATION_CREDENTIALS:
          process.env.GOOGLE_APPLICATION_CREDENTIALS,
        TERM: process.env.TERM,
      },
    });

    this.currentProcess = proc;

    const { promise, cancel } = createCancellableProcess(
      proc,
      options?.abortController,
    );

    try {
      if (proc.stdout) {
        for await (const event of parseJsonlStream(proc.stdout)) {
          yield normalizeToAgentMessage(event, 'gemini-local');
        }
      }

      await promise;
    } catch (error) {
      if (error instanceof Error && error.message.includes('Timeout')) {
        cancel();
      }
      yield {
        type: 'error',
        content: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.currentProcess = null;
    }

    yield { type: 'done' };
  }
}

export function createGeminiLocalAgent(config: AgentConfig): GeminiLocalAgent {
  return new GeminiLocalAgent(config);
}

/**
 * Gemini Local adapter plugin definition
 */
export const geminiLocalPlugin: AgentPlugin = defineAgentPlugin({
  metadata: GEMINI_LOCAL_METADATA,
  factory: (config) => createGeminiLocalAgent(config),
  async testEnvironment(
    _config: AgentConfig,
  ): Promise<AdapterEnvironmentReport> {
    return runPreflight({
      binaryName: 'gemini',
      helloArgs: ['gemini', '--help'],
    });
  },
});
